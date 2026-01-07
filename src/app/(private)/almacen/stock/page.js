// src/app/dashboard/DashboardStockPro.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, query, where } from "firebase/firestore";
import dayjs from "dayjs";

/* ====== Constantes ====== */
const TIPOS = ["ONT", "MESH", "FONO", "BOX"];
const COLORS = { ONT: "#1f77b4", MESH: "#2ca02c", FONO: "#ff7f0e", BOX: "#9467bd" };

/* ====== Helpers ====== */
const isUid = (v) => typeof v === "string" && v.length >= 10 && !v.includes(" ");
const resolveName = (idOrName, usersIdx) => {
  if (!idOrName) return "";
  if (typeof idOrName === "object") {
    const cand = idOrName?.id || idOrName?.uid || idOrName?.userId || idOrName?.value;
    return cand ? (usersIdx.get(cand) || cand) : "";
  }
  return isUid(idOrName) ? (usersIdx.get(idOrName) || idOrName) : idOrName;
};
const toLabelTipo = (rc) =>
  !rc ? "" : rc.includes("resi") ? "RESIDENCIAL" : rc.includes("condo") ? "CONDOMINIO" : rc.toUpperCase();
const escapeHtml = (s = "") =>
  String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmt = (n) => new Intl.NumberFormat("es-PE").format(Number(n || 0));
function pickAnyField(obj, keys) { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k]; }

/** Excluir ubicaciones: robo / pérdida / avería / garantía (con o sin tilde) */
const isExcludedUbicacion = (v) => {
  const s = String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // sin acentos
    .toLowerCase();
  return ["robo", "perdida", "averia", "garantia"].some((w) => s.includes(w));
};

/** Determina técnico(s) para una fila */
function tecnicoDeEquipo(eq, meta, usersIdx){
  if (Array.isArray(eq?.tecnicos) && eq.tecnicos.length){
    const lista = eq.tecnicos.map((t)=>resolveName(t, usersIdx)).map((t)=>(t||"").trim()).filter(Boolean);
    const unicos = Array.from(new Set(lista));
    if (unicos.length) return unicos.join(", ");
  }
  const cand = pickAnyField(eq, [
    "tecnicoNombre","tecnico_name","tecnico","tecnico1",
    "tecnico_uid","tecnicoUid","tecnicoId","tecnico_id",
    "asignadoA","asignado_a","asignado","responsable",
    "user","userId","user_uid"
  ]);
  const resolved = resolveName(cand, usersIdx);
  if (resolved) return resolved.trim();

  const listaMeta = [
    ...(Array.isArray(meta?.tecnicos)? meta.tecnicos: []),
    ...(Array.isArray(meta?.tecnicosIds)? meta.tecnicosIds: []),
  ].map((t)=>resolveName(t, usersIdx)).map((t)=>(t||"").trim()).filter(Boolean);
  const unicosMeta = Array.from(new Set(listaMeta));
  return unicosMeta.length===1 ? unicosMeta[0] : "—";
}

/* ====== Componente ====== */
export default function DashboardStockPro(){
  const [equipos, setEquipos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  // filtros
  const [busqueda, setBusqueda] = useState("");
  const [tipoCuadrilla, setTipoCuadrilla] = useState("todas");
  const [coordinadorFiltro, setCoordinadorFiltro] = useState("todos");
  const [soloConStock, setSoloConStock] = useState(true);
  const [equipoFiltro, setEquipoFiltro] = useState("todos");
  const [seleccionDetalle, setSeleccionDetalle] = useState(null);

  // búsqueda para series en almacén
  const [busquedaSerie, setBusquedaSerie] = useState("");

  useEffect(()=>{ (async ()=>{
  const [snapCq, snapUs, snapCampo, snapAlmacen] = await Promise.all([
    getDocs(collection(db,"cuadrillas")),
    getDocs(collection(db,"usuarios")),
    getDocs(query(collection(db,"equipos"), where("estado","==","campo"))),
    getDocs(query(collection(db,"equipos"), where("estado","==","almacen"))),
  ]);

  // cuadrillas / usuarios igual
  setCuadrillas(snapCq.docs.map(d=>({id:d.id,...d.data()})));
  setUsuarios(snapUs.docs.map(d=>{
    const x=d.data();
    return {id:d.id, uid:x.uid||d.id, nombres:x.nombres||x.nombre||"", apellidos:x.apellidos||""};
  }));

  // equipos: une ambos (misma lógica final: equipos contiene lo que necesitas)
  const campo = snapCampo.docs.map(d=>({id:d.id,...d.data()}));
  const almacen = snapAlmacen.docs.map(d=>({id:d.id,...d.data()}));
  setEquipos([...campo, ...almacen]);
})(); },[]);


  /* índices */
  const usuariosIdx = useMemo(()=>{ const m=new Map(); for (const u of usuarios) m.set(u.uid||u.id, `${u.nombres||""} ${u.apellidos||""}`.trim()); return m; },[usuarios]);

  const metaPorNombre = useMemo(()=>{ const m=new Map();
    for (const c of cuadrillas){
      m.set(c.nombre,{ 
        r_c:(c.r_c||c.tipo||c.tipo_cuadrilla||"").toLowerCase(),
        tecnicos:Array.isArray(c.tecnicos)?c.tecnicos:[],
        tecnicosIds:Array.isArray(c.tecnicosIds)?c.tecnicosIds:[],
        gestor:c.gestor||c.gestorNombre||"", 
        coordinador:c.coordinador||c.coordinadorNombre||"" 
      });
    } 
    return m;
  },[cuadrillas]);

  /* Opciones de coordinador */
  const coordinadoresOptions = useMemo(()=>{
    const set = new Set();
    for (const c of cuadrillas){
      const nombre = resolveName(c.coordinador || c.coordinadorNombre, usuariosIdx)?.trim();
      if (nombre) set.add(nombre);
    }
    return ["todos", ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  }, [cuadrillas, usuariosIdx]);

  /* KPIs desde equipos (en almacén, excluyendo ubicaciones no contables) */
  const kpiAlmacen = useMemo(()=> TIPOS.map(tipo=>({
    tipo,
    cantidad: equipos.filter(eq =>
      eq.estado==="almacen" &&
      eq.equipo===tipo &&
      !isExcludedUbicacion(eq.ubicacion)
    ).length
  })),[equipos]);

  const kpiCampo = useMemo(()=> TIPOS.map(tipo=>({
    tipo, cantidad: equipos.filter(eq => eq.estado==="campo" && eq.equipo===tipo).length
  })),[equipos]);

  /* Campo por cuadrilla -> datos para la tabla (se mantiene igual) */
  const resumenCampoPorCuadrilla = useMemo(()=>{
    const acc = new Map();
    for (const eq of equipos){
      if (eq.estado!=="campo") continue;
      const key = eq.ubicacion || "—";
      if (!acc.has(key)) acc.set(key,{nombre:key, ONT:0,MESH:0,FONO:0,BOX:0,total:0,r_c:"", coordinadorName:""});
      const row = acc.get(key);
      if (TIPOS.includes(eq.equipo)){ row[eq.equipo]++; row.total++; }
    }
    for (const row of acc.values()){
      const meta = metaPorNombre.get(row.nombre);
      row.r_c = meta?.r_c || "";
      const tipoTxt = toLabelTipo(row.r_c);
      row.nombreLabel = tipoTxt ? `${row.nombre}\n${tipoTxt}` : row.nombre;
      row.coordinadorName = resolveName(meta?.coordinador, usuariosIdx) || "—";
    }

    let data = Array.from(acc.values());

    if (busqueda.trim()){
      const q=busqueda.toLowerCase(); 
      data = data.filter(d=> d.nombre.toLowerCase().includes(q));
    }
    if (tipoCuadrilla!=="todas") data = data.filter(d=> d.r_c.includes(tipoCuadrilla));
    if (coordinadorFiltro!=="todos") data = data.filter(d => d.coordinadorName === coordinadorFiltro);

    if (equipoFiltro!=="todos"){
      data = data.map(d=>({...d, totalTipo:d[equipoFiltro]}))
                 .filter(d=> soloConStock ? d.totalTipo>0 : true)
                 .sort((a,b)=> (b.totalTipo||0)-(a.totalTipo||0) || a.nombre.localeCompare(b.nombre));
    } else {
      if (soloConStock) data = data.filter(d=> d.total>0);
      data.sort((a,b)=> b.total-a.total || a.nombre.localeCompare(b.nombre));
    }
    return data;
  },[equipos, metaPorNombre, busqueda, tipoCuadrilla, coordinadorFiltro, soloConStock, equipoFiltro, usuariosIdx]);

  /* Detalle por cuadrilla (campo) */
  const detalleSeleccion = useMemo(()=>{
    if (!seleccionDetalle) return {rows:[], tecnicos:[], gestor:"", coordinador:""};
    const meta = metaPorNombre.get(seleccionDetalle) || {};
    const tecnicosCab = [
      ...(Array.isArray(meta.tecnicos)?meta.tecnicos:[]),
      ...(Array.isArray(meta.tecnicosIds)?meta.tecnicosIds:[]),
    ].map(t=>resolveName(t, usuariosIdx)).map(t=>(t||"").trim()).filter(Boolean);
    const tecnicosUnicos = Array.from(new Set(tecnicosCab));
    const gestor = (resolveName(meta.gestor, usuariosIdx) || "—").trim();
    const coordinador = (resolveName(meta.coordinador, usuariosIdx) || "—").trim();

    const rows = equipos.filter(eq=> eq.estado==="campo" && (eq.ubicacion||"")===seleccionDetalle)
      .map(eq=>{
        const guia = eq.guia_despacho ?? eq.guiaDespacho ?? eq.guia ?? (typeof eq.guia?.numero==="string" ? eq.guia.numero: undefined) ?? "—";
        const tecnico = tecnicoDeEquipo(eq, meta, usuariosIdx);
        return {
          id:eq.id, SN:eq.SN||"—", equipo:eq.equipo||"—",
          fechaDespacho: eq.f_despacho?.seconds ? dayjs(eq.f_despacho.seconds*1000).format("DD/MM/YYYY") : "—",
          guiaDespacho: guia||"—", tecnico
        };
      })
      .sort((a,b)=> a.equipo.localeCompare(b.equipo) || a.SN.localeCompare(b.SN));

    return { rows, tecnicos:tecnicosUnicos, gestor, coordinador };
  },[seleccionDetalle, equipos, metaPorNombre, usuariosIdx]);

  /* Series en almacén (EXCLUYENDO robo/perdida/averia/garantia) */
  const seriesAlmacen = useMemo(() => {
  const totales = { ONT:0, MESH:0, FONO:0, BOX:0 };
  const q = busquedaSerie.trim().toLowerCase();
  const filtrar = !!q;

  const rows = [];
  for (const eq of equipos) {
    if (eq.estado !== "almacen") continue;
    if (isExcludedUbicacion(eq.ubicacion)) continue;
    if (equipoFiltro !== "todos" && eq.equipo !== equipoFiltro) continue;

    if (filtrar) {
      const sn = String(eq.SN||"").toLowerCase();
      const des = String(eq.descripcion||"").toLowerCase();
      const guia = String(eq.guia_ingreso||eq.guiaIngreso||eq.guia?.numero||"").toLowerCase();
      if (!sn.includes(q) && !des.includes(q) && !guia.includes(q)) continue;
    }

    if (TIPOS.includes(eq.equipo)) totales[eq.equipo]++;

    rows.push({
      id: eq.id,
      SN: eq.SN || "—",
      equipo: eq.equipo || "—",
      fechaIngreso: eq.f_ingreso?.seconds
        ? dayjs(eq.f_ingreso.seconds*1000).format("DD/MM/YYYY")
        : (typeof eq.f_ingreso === "string" ? eq.f_ingreso : "—"),
      guiaIngreso: eq.guia_ingreso ?? eq.guiaIngreso ?? (typeof eq.guia?.numero === "string" ? eq.guia.numero : undefined) ?? "—",
    });
  }

  rows.sort((a,b)=> a.equipo.localeCompare(b.equipo) || a.SN.localeCompare(b.SN));
  const total = rows.length;
  return { rows, totales, total };
}, [equipos, equipoFiltro, busquedaSerie]);


  /* ---- Botón Limpiar filtros ---- */
  const filtersDirty = useMemo(
    () => !!(busqueda.trim() || equipoFiltro!=="todos" || tipoCuadrilla!=="todas" || coordinadorFiltro!=="todos" || !soloConStock || busquedaSerie.trim()),
    [busqueda, equipoFiltro, tipoCuadrilla, coordinadorFiltro, soloConStock, busquedaSerie]
  );
  const clearFilters = () => {
    setBusqueda("");
    setEquipoFiltro("todos");
    setTipoCuadrilla("todas");
    setCoordinadorFiltro("todos");
    setSoloConStock(true);
    setBusquedaSerie("");
    setSeleccionDetalle(null);
  };

  /* Export a Excel (HTML) genérico */
  const exportExcelTable = (headers, rows, filename) => {
    const thead = "<tr>"+headers.map(h=>`<th style="text-align:left;border:1px solid #ccc;padding:4px">${escapeHtml(h)}</th>`).join("")+"</tr>";
    const tbody = rows.map(r=>{
      const tds = headers.map(h => {
        const key = h;
        const v = r[key] ?? r[h] ?? "";
        return `<td style="border:1px solid #ccc;padding:4px">${escapeHtml(String(v))}</td>`;
      }).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    const html = `<html><head><meta charset="utf-8"/></head><body><table>${thead}${tbody}</table></body></html>`;
    const blob = new Blob(["\uFEFF"+html], {type:"application/vnd.ms-excel"});
    const url = URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`${filename}.xls`; a.click();
    URL.revokeObjectURL(url);
  };

  /* UI */
  const ChipTipo = ({r_c})=>{
    const txt = r_c ? r_c.charAt(0).toUpperCase()+r_c.slice(1) : "—";
    const tone = r_c?.includes("resi") ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : r_c?.includes("condo") ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                : "bg-gray-50 text-gray-600 ring-gray-200";
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>{txt}</span>;
  };

  return (
    <div className="p-6 space-y-8">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h1 className="text-2xl md:text-3xl font-bold">📦 Stock por Cuadrilla</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden md:flex items-center gap-3 text-xs mr-2">
            {TIPOS.map(t=>(
              <span key={t} className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded" style={{backgroundColor:COLORS[t]}}/>{t}
              </span>
            ))}
          </div>

          <input
            value={busqueda}
            onChange={e=>setBusqueda(e.target.value)}
            placeholder="Buscar cuadrilla…"
            className="rounded-xl border px-3 py-2 text-sm"
          />

          <select
            value={equipoFiltro}
            onChange={e=>setEquipoFiltro(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
            title="Equipo"
          >
            <option value="todos">Todos los equipos</option>
            {TIPOS.map(t=><option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={tipoCuadrilla}
            onChange={e=>setTipoCuadrilla(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
            title="Tipo de cuadrilla"
          >
            <option value="todas">Todas</option>
            <option value="residencial">Residencial</option>
            <option value="condominio">Condominio</option>
          </select>

          <select
            value={coordinadorFiltro}
            onChange={(e)=>setCoordinadorFiltro(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
            title="Coordinador"
          >
            {coordinadoresOptions.map(opt => (
              <option key={opt} value={opt}>
                {opt === "todos" ? "Todos los coordinadores" : opt}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloConStock} onChange={e=>setSoloConStock(e.target.checked)}/>
            Solo con stock
          </label>

          {/* Botón Limpiar filtros */}
          <button
            onClick={clearFilters}
            disabled={!filtersDirty}
            className={`rounded-xl border px-3 py-2 text-sm ${filtersDirty ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}
            title="Restablecer filtros a valores por defecto"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpiAlmacen.map(k=>(
          <div key={`alm-${k.tipo}`} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase text-gray-500">{k.tipo}</div>
            <div className="text-2xl font-semibold">{k.cantidad}</div>
            <div className="text-[11px] text-gray-400">En almacén</div>
          </div>
        ))}
        {kpiCampo.map(k=>(
          <div key={`cam-${k.tipo}`} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase text-gray-500">{k.tipo}</div>
            <div className="text-2xl font-semibold">{k.cantidad}</div>
            <div className="text-[11px] text-gray-400">En campo</div>
          </div>
        ))}
      </section>

      {/* Tabla ejecutiva (campo) */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Resumen por cuadrilla</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="text-left">
                <th className="p-2">Cuadrilla</th>
                <th className="p-2 text-right">ONT</th>
                <th className="p-2 text-right">MESH</th>
                <th className="p-2 text-right">FONO</th>
                <th className="p-2 text-right">BOX</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Coordinador</th>
                <th className="p-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {resumenCampoPorCuadrilla.map(row=>(
                <tr key={row.nombre} className="border-t hover:bg-gray-50">
                  <td className="p-2 font-medium">{row.nombre}</td>
                  <td className="p-2 text-right">{row.ONT}</td>
                  <td className="p-2 text-right">{row.MESH}</td>
                  <td className="p-2 text-right">{row.FONO}</td>
                  <td className="p-2 text-right">{row.BOX}</td>
                  <td className="p-2 text-right font-semibold">{equipoFiltro==="todos"?row.total:row[equipoFiltro]}</td>
                  <td className="p-2"><ChipTipo r_c={row.r_c}/></td>
                  <td className="p-2">{row.coordinadorName || "—"}</td>
                  <td className="p-2">
                    <button onClick={()=>setSeleccionDetalle(row.nombre)} className="rounded-xl border px-3 py-1 text-xs hover:bg-gray-100">Ver detalle</button>
                  </td>
                </tr>
              ))}
              {resumenCampoPorCuadrilla.length===0 && (
                <tr><td className="p-4 text-center text-gray-500" colSpan={9}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detalle por cuadrilla (campo) */}
      {seleccionDetalle && (
        <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold">Detalle de equipos — {seleccionDetalle}</h3>
              <p className="text-xs text-gray-500">
                Técnicos: {detalleSeleccion.tecnicos.length ? detalleSeleccion.tecnicos.join(", ") : "—"}
                {" · "}Gestor: {detalleSeleccion.gestor || "—"}
                {" · "}Coordinador: {detalleSeleccion.coordinador || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={()=>exportExcelTable(
                  ["SN","Equipo","FechaDespacho","GuiaDespacho","Tecnico"],
                  detalleSeleccion.rows.map(r=>({
                    SN:r.SN, Equipo:r.equipo, FechaDespacho:r.fechaDespacho, GuiaDespacho:r.guiaDespacho, Tecnico:r.tecnico
                  })),
                  `detalle_${seleccionDetalle.replace(/\s+/g,"_")}`
                )}
                className="rounded-xl border px-3 py-1 text-xs hover:bg-gray-100"
              >
                Exportar Excel
              </button>
              <button onClick={()=>setSeleccionDetalle(null)} className="text-sm text-gray-600 hover:underline">Cerrar</button>
            </div>
          </div>

          <div className="overflow-auto mt-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="p-2">SN</th>
                  <th className="p-2">Equipo</th>
                  <th className="p-2">Fecha despacho</th>
                  <th className="p-2">Guía de despacho</th>
                  <th className="p-2">Técnico</th>
                </tr>
              </thead>
              <tbody>
                {detalleSeleccion.rows.map(it=>(
                  <tr key={it.id} className="border-t hover:bg-gray-50">
                    <td className="p-2">{it.SN}</td>
                    <td className="p-2">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1"
                        style={{color:"white",backgroundColor:COLORS[it.equipo]||"#111827",borderColor:"transparent"}}
                      >
                        {it.equipo}
                      </span>
                    </td>
                    <td className="p-2">{it.fechaDespacho}</td>
                    <td className="p-2">{it.guiaDespacho}</td>
                    <td className="p-2">{it.tecnico}</td>
                  </tr>
                ))}
                {detalleSeleccion.rows.length===0 && (
                  <tr><td className="p-4 text-center text-gray-500" colSpan={5}>Sin equipos.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Series en almacén (excluye robo/perdida/averia/garantia) */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <h2 className="text-lg font-semibold">Series en almacén</h2>
          <div className="flex items-center gap-2 text-xs">
            {TIPOS.map(t=>(
              <span key={`badge-${t}`} className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded" style={{backgroundColor:COLORS[t]}}/> {t}: {fmt(seriesAlmacen.totales[t]||0)}
              </span>
            ))}
            <span className="ml-3 text-gray-500">Total: {fmt(seriesAlmacen.total)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <input
            value={busquedaSerie}
            onChange={(e)=>setBusquedaSerie(e.target.value)}
            placeholder="Buscar por SN / guía / descripción…"
            className="rounded-xl border px-3 py-2 text-sm w-full md:w-96"
          />
          <button
            onClick={()=>exportExcelTable(
              ["SN","Equipo","FechaIngreso","GuiaIngreso"],
              seriesAlmacen.rows.map(r=>({
                SN:r.SN, Equipo:r.equipo, FechaIngreso:r.fechaIngreso, GuiaIngreso:r.guiaIngreso
              })),
              `series_almacen_${equipoFiltro === "todos" ? "todos" : equipoFiltro}`
            )}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-100"
          >
            Exportar Excel
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-2">SN</th>
                <th className="p-2">Equipo</th>
                <th className="p-2">Fecha ingreso</th>
                <th className="p-2">Guía de ingreso</th>
              </tr>
            </thead>
            <tbody>
              {seriesAlmacen.rows.map(it=>(
                <tr key={it.id} className="border-t hover:bg-gray-50">
                  <td className="p-2">{it.SN}</td>
                  <td className="p-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1"
                      style={{color:"white",backgroundColor:COLORS[it.equipo]||"#111827",borderColor:"transparent"}}
                    >
                      {it.equipo}
                    </span>
                  </td>
                  <td className="p-2">{it.fechaIngreso}</td>
                  <td className="p-2">{it.guiaIngreso}</td>
                </tr>
              ))}
              {seriesAlmacen.rows.length === 0 && (
                <tr><td className="p-4 text-center text-gray-500" colSpan={4}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-[11px] text-gray-500">Actualizado: {dayjs().format("DD/MM/YYYY HH:mm")}</footer>
    </div>
  );
}
