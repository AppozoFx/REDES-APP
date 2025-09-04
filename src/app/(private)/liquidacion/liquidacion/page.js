"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/es";
import toast from "react-hot-toast";
import Select from "react-select";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { Input } from "@/app/components/ui/input";

/* =========================
   Config dayjs
========================= */
dayjs.extend(customParseFormat);
dayjs.locale("es");

/* =========================
   Helpers
========================= */
const cls = (...x) => x.filter(Boolean).join(" ");
const parseIntSafe = (v) => {
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? 0 : n;
};
const valorONulo = (v) => (v !== undefined && v !== "" ? v : null);

const useDebounce = (value, delay = 350) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
};

const convertirAFecha = (valor) => {
  if (!valor) return null;
  if (typeof valor?.toDate === "function") return valor.toDate();
  const parseada = dayjs(valor, "D [de] MMMM [de] YYYY, h:mm:ss A [UTC-5]", "es", true);
  return parseada.isValid() ? parseada.toDate() : new Date(valor);
};

const formatearFecha = (fecha) => (fecha ? dayjs(fecha).format("DD/MM/YYYY") : "-");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resaltarPlanHTML = (planTexto) => {
  if (!planTexto) return "-";
  const palabras = [
    { texto: "INTERNETGAMER", color: "bg-green-300", tip: "Paquete especial para gamers" },
    { texto: "KIT WIFI PRO (EN VENTA)", color: "bg-blue-300", tip: "Incluye Kit Wifi Pro en venta" },
    { texto: "SERVICIO CABLEADO DE MESH", color: "bg-purple-300", tip: "Servicio adicional de cableado para MESH" },
  ];
  let out = planTexto;
  palabras.forEach(({ texto, color, tip }) => {
    const rx = new RegExp(escapeRegExp(texto), "gi");
    const span = `<span class='px-1 ${color} font-bold rounded cursor-help' title='${tip}'>${texto}</span>`;
    out = out.replace(rx, span);
  });
  return out;
};

/* =========================
   Componente principal
========================= */
export default function LiquidacionesPage() {
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [ediciones, setEdiciones] = useState({});
  const [guardandoFila, setGuardandoFila] = useState(null);

  const [sort, setSort] = useState({ key: "fechaInstalacion", dir: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [filtros, setFiltros] = useState({
    mes: dayjs().format("YYYY-MM"),
    dia: "",
    cuadrilla: [],
    tipoCuadrilla: [],
    busqueda: "",
    filtrarPlanGamer: false,
    filtrarKitWifiPro: false,
    filtrarCableadoMesh: false,
    filtrarObservacion: false,
    cat5eFiltro: "",
    residencialCondominio: [],
  });

  const debouncedBusqueda = useDebounce(filtros.busqueda);

  /* ===== Sticky offsets / mediciones ===== */
  const kpiRef = useRef(null);
  const theadRef = useRef(null);
  const [theadTop, setTheadTop] = useState(0);    // distancia desde el top
  const [theadH, setTheadH] = useState(0);        // alto del thead
  const [headPinned, setHeadPinned] = useState(false); // ¿el thead ya está “pegado”?

  useEffect(() => {
    const recalc = () => {
      const kpiH = kpiRef.current?.getBoundingClientRect().height || 0;
      setTheadTop(kpiH); // solo la altura real del bloque sticky que está arriba
      const thH = theadRef.current?.getBoundingClientRect().height || 0;
      setTheadH(thH);

      // detectar si el thead ya está pegado
      if (theadRef.current) {
        const currentTop = theadRef.current.getBoundingClientRect().top;
        setHeadPinned(currentTop <= kpiH + 0.5);
      }
    };

    recalc();
    window.addEventListener("resize", recalc, { passive: true });
    window.addEventListener("scroll", recalc, { passive: true });

    const ro = new ResizeObserver(recalc);
    if (kpiRef.current) ro.observe(kpiRef.current);
    if (theadRef.current) ro.observe(theadRef.current);

    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc);
      ro.disconnect();
    };
  }, []);

  /* =========================
     Datos base
  ========================= */
  useEffect(() => {
    obtenerLiquidaciones();
  }, [filtros.mes]);

  const obtenerLiquidaciones = async () => {
    setCargando(true);
    try {
      const ref = collection(db, "liquidacion_instalaciones");
      const snapshot = await getDocs(ref);
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLiquidaciones(data);
    } catch (e) {
      console.error(e);
      toast.error("Error al obtener las liquidaciones");
    } finally {
      setCargando(false);
      setPage(1);
    }
  };

  /* =========================
     Opciones select
  ========================= */
  const opcionesCuadrilla = useMemo(() => {
    return [...new Set(liquidaciones.map((l) => l.cuadrillaNombre).filter(Boolean))].map((c) => ({
      value: c,
      label: c,
    }));
  }, [liquidaciones]);

  const opcionesTipoCuadrilla = useMemo(() => {
    return [...new Set(liquidaciones.map((l) => l.tipoCuadrilla).filter(Boolean))].map((t) => ({
      value: t,
      label: t,
    }));
  }, [liquidaciones]);

  /* =========================
     Filtro + Orden
  ========================= */
  const liquidacionesFiltradas = useMemo(() => {
    const deb = (debouncedBusqueda || "").trim().toLowerCase();

    const base = liquidaciones.filter((l) => {
      const f = convertirAFecha(l.fechaInstalacion);
      if (!f) return false;
      const fD = dayjs(f);

      const coincideMes = fD.format("YYYY-MM") === filtros.mes;
      const coincideDia = filtros.dia ? fD.format("YYYY-MM-DD") === filtros.dia : true;

      const coincideCuadrilla =
        filtros.cuadrilla.length > 0 ? filtros.cuadrilla.includes(l.cuadrillaNombre) : true;

      const coincideTipoCuadrilla =
        filtros.tipoCuadrilla.length > 0 ? filtros.tipoCuadrilla.includes(l.tipoCuadrilla) : true;

      const coincideTipoZona =
        filtros.residencialCondominio.length > 0
          ? filtros.residencialCondominio.includes(l.residencialCondominio?.toUpperCase())
          : true;

      const coincideBusqueda = deb
        ? (l.codigoCliente || "").toString().toLowerCase().includes(deb) ||
          (l.cliente || "").toLowerCase().includes(deb)
        : true;

      const cumplePlanGamer = !filtros.filtrarPlanGamer || l.planGamer !== "";
      const cumpleKitWifiPro = !filtros.filtrarKitWifiPro || l.kitWifiPro !== "";
      const cumpleCableado = !filtros.filtrarCableadoMesh || l.servicioCableadoMesh !== "";

      const cumpleCat5e =
        filtros.cat5eFiltro !== ""
          ? parseIntSafe(l.cat5e) === parseInt(String(filtros.cat5eFiltro), 10)
          : true;

      const cumpleObservacion =
        !filtros.filtrarObservacion || (l.observacion && l.observacion.trim() !== "");

      return (
        coincideMes &&
        coincideDia &&
        coincideCuadrilla &&
        coincideTipoCuadrilla &&
        coincideTipoZona &&
        coincideBusqueda &&
        cumplePlanGamer &&
        cumpleKitWifiPro &&
        cumpleCableado &&
        cumpleCat5e &&
        cumpleObservacion
      );
    });

    const sorted = [...base].sort((a, b) => {
      const k = sort.key;
      let va = a[k];
      let vb = b[k];

      if (k === "fechaInstalacion") {
        va = convertirAFecha(va)?.getTime() ?? 0;
        vb = convertirAFecha(vb)?.getTime() ?? 0;
      }

      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();

      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [liquidaciones, filtros, debouncedBusqueda, sort]);

  /* =========================
     KPIs
  ========================= */
  const kpis = useMemo(() => {
    const total = liquidacionesFiltradas.length;
    const countArray = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).length : 0);

    const totalONT = liquidacionesFiltradas.filter((l) => l.snONT).length;
    const totalMESH = liquidacionesFiltradas.reduce((acc, l) => acc + countArray(l.snMESH), 0);
    const totalBOX = liquidacionesFiltradas.reduce((acc, l) => acc + countArray(l.snBOX), 0);
    const totalFONO = liquidacionesFiltradas.filter((l) => l.snFONO).length;

    const totalGamer = liquidacionesFiltradas.filter((l) => !!l.planGamer).length;
    const totalWifiPro = liquidacionesFiltradas.filter((l) => !!l.kitWifiPro).length;
    const totalCableado = liquidacionesFiltradas.filter((l) => !!l.servicioCableadoMesh).length;

    const totalCat5e = liquidacionesFiltradas.reduce((acc, l) => acc + parseIntSafe(l.cat5e), 0);
    const totalCat6 = liquidacionesFiltradas.reduce((acc, l) => acc + parseIntSafe(l.cat6), 0);

    return {
      total,
      totalONT,
      totalMESH,
      totalBOX,
      totalFONO,
      totalGamer,
      totalWifiPro,
      totalCableado,
      totalCat5e,
      totalCat6,
      totalUTP: totalCat5e + totalCat6,
    };
  }, [liquidacionesFiltradas]);

  /* =========================
     Paginación
  ========================= */
  const totalPages = Math.max(1, Math.ceil(liquidacionesFiltradas.length / pageSize));
  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return liquidacionesFiltradas.slice(start, start + pageSize);
  }, [liquidacionesFiltradas, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  /* =========================
     Eventos UI
  ========================= */
  const setSortKey = (key) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  };

  const handleFiltroInput = (e) => {
    const { name, value } = e.target;
    setFiltros((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const limpiarFiltros = () => {
    setFiltros({
      mes: dayjs().format("YYYY-MM"),
      dia: "",
      cuadrilla: [],
      tipoCuadrilla: [],
      busqueda: "",
      filtrarPlanGamer: false,
      filtrarKitWifiPro: false,
      filtrarCableadoMesh: false,
      filtrarObservacion: false,
      cat5eFiltro: "",
      residencialCondominio: [],
    });
    setPage(1);
  };

  const handleEdicionChange = (id, campo, valor) => {
    setEdiciones((prev) => ({
      ...prev,
      [id]: { ...prev[id], [campo]: valor },
    }));
  };

  const guardarFila = async (row) => {
    const cambios = ediciones[row.id];
    if (!cambios) {
      toast.error("No hay cambios para guardar");
      return;
    }
    try {
      setGuardandoFila(row.id);
      await updateDoc(doc(db, "liquidacion_instalaciones", row.id), cambios);
      toast.success("Cambios guardados");
      await obtenerLiquidaciones();
      setEdiciones((prev) => {
        const cp = { ...prev };
        delete cp[row.id];
        return cp;
      });
    } catch (e) {
      console.error(e);
      toast.error("Error al guardar cambios");
    } finally {
      setGuardandoFila(null);
    }
  };

  /* =========================
     Exportar Excel
  ========================= */
  const handleExportarExcel = () => {
    let maxMesh = 0;
    let maxBox = 0;
    liquidacionesFiltradas.forEach((l) => {
      const m = Array.isArray(l.snMESH) ? l.snMESH.filter(Boolean) : [];
      const b = Array.isArray(l.snBOX) ? l.snBOX.filter(Boolean) : [];
      maxMesh = Math.max(maxMesh, m.length);
      maxBox = Math.max(maxBox, b.length);
    });

    const dataExportar = liquidacionesFiltradas.map((l) => {
      const fecha = convertirAFecha(l.fechaInstalacion);
      const cat5 = parseIntSafe(l.cat5e);
      const cat6 = parseIntSafe(l.cat6);
      const puntos = cat5 + cat6;

      const snMESH = Array.isArray(l.snMESH) ? l.snMESH.filter(Boolean) : [];
      const snBOX = Array.isArray(l.snBOX) ? l.snBOX.filter(Boolean) : [];

      const meshCols = {};
      for (let i = 0; i < maxMesh; i++) meshCols[`SN_MESH_${i + 1}`] = valorONulo(snMESH[i]);

      const boxCols = {};
      for (let i = 0; i < maxBox; i++) boxCols[`SN_BOX_${i + 1}`] = valorONulo(snBOX[i]);

      return {
        FechaInstalacion: formatearFecha(fecha),
        TipoCuadrilla: valorONulo(l.tipoCuadrilla),
        TipoServicio: valorONulo(l.tipoServicio),
        Cuadrilla: valorONulo(l.cuadrillaNombre),
        CodigoCliente: valorONulo(l.codigoCliente),
        documento: valorONulo(l.documento),
        Cliente: valorONulo(l.cliente),
        Direccion: valorONulo(l.direccion),
        TipoZona: valorONulo(l.residencialCondominio),
        Plan: valorONulo(l.plan),
        SN_ONT: valorONulo(l.snONT),
        proid: valorONulo(l.proidONT),
        ...meshCols,
        ...boxCols,
        SN_FONO: valorONulo(l.snFONO),
        PlanGamer: valorONulo(l.planGamer),
        KitWifiPro: valorONulo(l.kitWifiPro),
        ServicioCableadoMesh: valorONulo(l.servicioCableadoMesh),
        Cat5e: cat5,
        Cat6: cat6,
        PuntosUTP: puntos,
        Observacion: valorONulo(l.observacion),
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Liquidaciones");

    const fechaMes = dayjs(filtros.mes).format("MMMM_YYYY").toLowerCase();
    const fechaDia = filtros.dia ? `_${dayjs(filtros.dia).format("DD_MM_YYYY")}` : "";
    const nombreArchivo = `Liquidacion_REDES_${fechaMes}${fechaDia}.xlsx`;

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), nombreArchivo);
    toast.success(`✅ Archivo "${nombreArchivo}" exportado correctamente`);
  };

  /* =========================
     Render
  ========================= */
  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Liquidación de Instalaciones</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExportarExcel}
            className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded shadow"
          >
            📤 Exportar a Excel
          </button>
          <button
            onClick={limpiarFiltros}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm px-3 py-2 rounded border"
          >
            ✨ Limpiar filtros
          </button>
        </div>
      </div>

      {/* KPIs sticky */}
      <div
        ref={kpiRef}
        className="sticky top-0 z-20 mb-3 border border-blue-200 rounded-xl bg-gradient-to-r from-blue-50 via-white to-blue-50 p-3 shadow"
      >
        <div className="flex flex-wrap gap-4 items-center justify-between text-blue-900 text-[13px] font-medium">
          <span className="inline-flex items-center gap-2">
            <span className="bg-blue-600 text-white rounded-full px-3 py-1 text-xs font-bold">
              {kpis.total}
            </span>{" "}
            instalaciones
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="bg-gray-800 text-white rounded-full px-2 py-0.5 text-xs">ONT</span> {kpis.totalONT}
            <span className="bg-green-200 text-green-800 rounded-full px-2 py-0.5 text-xs">MESH</span> {kpis.totalMESH}
            <span className="bg-yellow-200 text-yellow-800 rounded-full px-2 py-0.5 text-xs">BOX</span> {kpis.totalBOX}
            <span className="bg-pink-200 text-pink-800 rounded-full px-2 py-0.5 text-xs">FONO</span> {kpis.totalFONO}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="bg-purple-200 text-purple-800 rounded-full px-2 py-0.5 text-xs">Gamer</span> {kpis.totalGamer}
            <span className="bg-blue-200 text-blue-800 rounded-full px-2 py-0.5 text-xs">Wifi Pro</span> {kpis.totalWifiPro}
            <span className="bg-orange-200 text-orange-800 rounded-full px-2 py-0.5 text-xs">Cableado</span> {kpis.totalCableado}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="bg-slate-200 text-slate-800 rounded-full px-2 py-0.5 text-xs">Cat5e</span> {kpis.totalCat5e}
            <span className="bg-slate-400 text-slate-900 rounded-full px-2 py-0.5 text-xs">Cat6</span> {kpis.totalCat6}
            <span className="bg-slate-800 text-white rounded-full px-2 py-0.5 text-xs">UTP</span> {kpis.totalUTP}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Mes</label>
          <Input type="month" name="mes" value={filtros.mes} onChange={handleFiltroInput} />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Día</label>
          <Input type="date" name="dia" value={filtros.dia} onChange={handleFiltroInput} />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Tipo de Cuadrilla</label>
          <Select
            isMulti
            name="tipoCuadrilla"
            options={opcionesTipoCuadrilla}
            className="text-sm"
            placeholder="Seleccionar..."
            value={opcionesTipoCuadrilla.filter((opt) => filtros.tipoCuadrilla.includes(opt.value))}
            onChange={(sel) => setFiltros((p) => ({ ...p, tipoCuadrilla: (sel || []).map((s) => s.value) }))}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Tipo Zona</label>
          <Select
            isMulti
            name="residencialCondominio"
            options={[
              { value: "RESIDENCIAL", label: "Residencial" },
              { value: "CONDOMINIO", label: "Condominio" },
            ]}
            className="text-sm"
            placeholder="Seleccionar..."
            value={[
              { value: "RESIDENCIAL", label: "Residencial" },
              { value: "CONDOMINIO", label: "Condominio" },
            ].filter((opt) => filtros.residencialCondominio.includes(opt.value))}
            onChange={(sel) =>
              setFiltros((p) => ({ ...p, residencialCondominio: (sel || []).map((s) => s.value) }))
            }
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Cuadrilla</label>
          <Select
            isMulti
            name="cuadrilla"
            options={opcionesCuadrilla}
            className="text-sm"
            placeholder="Seleccionar..."
            value={opcionesCuadrilla.filter((opt) => filtros.cuadrilla.includes(opt.value))}
            onChange={(sel) => setFiltros((p) => ({ ...p, cuadrilla: (sel || []).map((s) => s.value) }))}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Código o Cliente</label>
          <Input
            type="text"
            name="busqueda"
            placeholder="Buscar código o cliente"
            value={filtros.busqueda}
            onChange={handleFiltroInput}
          />
        </div>

        <div className="col-span-full">
          <div className="flex flex-wrap gap-4 items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filtros.filtrarPlanGamer}
                onChange={(e) => setFiltros((p) => ({ ...p, filtrarPlanGamer: e.target.checked }))}
              />
              🎮 Plan Gamer
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filtros.filtrarKitWifiPro}
                onChange={(e) => setFiltros((p) => ({ ...p, filtrarKitWifiPro: e.target.checked }))}
              />
              📦 Kit Wifi Pro
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filtros.filtrarCableadoMesh}
                onChange={(e) => setFiltros((p) => ({ ...p, filtrarCableadoMesh: e.target.checked }))}
              />
              🧵 Cableado Mesh
            </label>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">📶 Cat5e</label>
              <select
                name="cat5eFiltro"
                value={filtros.cat5eFiltro}
                onChange={handleFiltroInput}
                className="border px-2 py-1 rounded text-sm"
              >
                <option value="">Todos</option>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filtros.filtrarObservacion}
                onChange={(e) => setFiltros((p) => ({ ...p, filtrarObservacion: e.target.checked }))}
              />
              📝 Con observación
            </label>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto border rounded-lg relative">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr className="text-center text-gray-700 font-semibold">
              {[
                { k: "fechaInstalacion", lbl: "Fecha Instalación", w: "w-40" },
                { k: "tipoCuadrilla", lbl: "Tipo Cuadrilla", w: "w-40" },
                { k: "cuadrillaNombre", lbl: "Cuadrilla", w: "w-44" },
                { k: "codigoCliente", lbl: "Código", w: "w-32" },
                { k: "cliente", lbl: "Cliente", w: "w-56" },
                { k: "residencialCondominio", lbl: "R/C", w: "w-36" },
                { k: "plan", lbl: "Plan", w: "min-w-[240px]" },
                { k: "snONT", lbl: "SN ONT", w: "w-40" },
                { k: "snMESH", lbl: "SN MESH", w: "w-56" },
                { k: "snBOX", lbl: "SN BOX", w: "w-56" },
                { k: "snFONO", lbl: "SN FONO", w: "w-40" },
                { k: "planGamer", lbl: "Plan Gamer", w: "w-32" },
                { k: "kitWifiPro", lbl: "Kit Wifi Pro", w: "w-36" },
                { k: "servicioCableadoMesh", lbl: "Cableado Mesh", w: "w-40" },
                { k: "cat5e", lbl: "Cat5e", w: "w-24" },
                { k: "cat6", lbl: "Cat6", w: "w-24" },
                { k: "puntos", lbl: "Puntos UTP", w: "w-28" },
                { k: "observacion", lbl: "Observación", w: "min-w-[220px]" },
                { k: "accion", lbl: "Acción", w: "w-32" },
              ].map((col) => (
                <th
                  key={col.k}
                  className={cls("p-2 border cursor-pointer select-none bg-gray-100", col.w)}
                  onClick={() => col.k !== "accion" && setSortKey(col.k)}
                  title="Ordenar"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>{col.lbl}</span>
                    {sort.key === col.k && <span>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Espaciador: solo cuando el thead está pegado */}
            {headPinned && (
              <tr aria-hidden>
                <td colSpan={19} style={{ height: theadH }} />
              </tr>
            )}

            {cargando ? (
              <tr>
                <td colSpan={19} className="p-6 text-center text-gray-500">
                  Cargando…
                </td>
              </tr>
            ) : pageData.length === 0 ? (
              <tr>
                <td colSpan={19} className="p-6 text-center text-gray-500">
                  No hay registros para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              pageData.map((l) => {
                const f = convertirAFecha(l.fechaInstalacion);
                const cat5 = parseIntSafe(ediciones[l.id]?.cat5e ?? l.cat5e ?? 0);
                const cat6 = parseIntSafe(l.cat6 ?? 0);
                const puntos = cat5 + cat6;

                return (
                  <tr key={l.id} className="hover:bg-gray-50 text-center">
                    <td className="border p-2">{formatearFecha(f)}</td>

                    {/* Tipo Cuadrilla */}
                    <td className="border p-1">
                      <select
                        value={ ediciones[l.id]?.tipoCuadrilla ?? l.tipoCuadrilla ?? "" }
                        className="border rounded px-2 py-1 text-sm"
                        onChange={(e) => handleEdicionChange(l.id, "tipoCuadrilla", e.target.value)}
                      >
                        <option value="">-- Seleccionar --</option>
                        {opcionesTipoCuadrilla.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="border p-2">{l.cuadrillaNombre || "-"}</td>
                    <td className="border p-2">{l.codigoCliente || "-"}</td>
                    <td className="border p-2">{l.cliente || "-"}</td>

                    {/* R/C */}
                    <td className="border p-1">
                      <select
                        value={ ediciones[l.id]?.residencialCondominio ?? l.residencialCondominio ?? "" }
                        className="border rounded px-2 py-1 text-sm"
                        onChange={(e) => handleEdicionChange(l.id, "residencialCondominio", e.target.value)}
                      >
                        <option value="">-- Seleccionar --</option>
                        <option value="RESIDENCIAL">RESIDENCIAL</option>
                        <option value="CONDOMINIO">CONDOMINIO</option>
                      </select>
                    </td>

                    {/* Plan (badge) */}
                    <td
                      className="border p-1 text-left max-w-[360px]"
                      style={{ maxHeight: 64, overflowY: "auto" }}
                      dangerouslySetInnerHTML={{ __html: resaltarPlanHTML(l.plan) }}
                    />

                    <td className="border p-2">{l.snONT || "-"}</td>

                    {/* SN MESH */}
                    <td className="border p-2">
                      {Array.isArray(l.snMESH) && l.snMESH.filter(Boolean).length > 0 ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {l.snMESH.filter(Boolean).map((sn, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 border border-green-200"
                            >
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>

                    {/* SN BOX */}
                    <td className="border p-2">
                      {Array.isArray(l.snBOX) && l.snBOX.filter(Boolean).length > 0 ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {l.snBOX.filter(Boolean).map((sn, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 border border-yellow-200"
                            >
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="border p-2">{l.snFONO || "-"}</td>

                    {/* Plan Gamer */}
                    <td className="border p-2">
                      <input
                        type="checkbox"
                        className="scale-110"
                        checked={(ediciones[l.id]?.planGamer ?? l.planGamer ?? "") !== ""}
                        onChange={(e) =>
                          handleEdicionChange(l.id, "planGamer", e.target.checked ? "INTERNETGAMER" : "")
                        }
                      />
                    </td>

                    {/* Kit Wifi Pro */}
                    <td className="border p-2">
                      <input
                        type="checkbox"
                        className="scale-110"
                        checked={(ediciones[l.id]?.kitWifiPro ?? l.kitWifiPro ?? "") !== ""}
                        onChange={(e) =>
                          handleEdicionChange(
                            l.id,
                            "kitWifiPro",
                            e.target.checked ? "KIT WIFI PRO (AL CONTADO)" : ""
                          )
                        }
                      />
                    </td>

                    {/* Cableado Mesh */}
                    <td className="border p-2">
                      <input
                        type="checkbox"
                        className="scale-110"
                        checked={(ediciones[l.id]?.servicioCableadoMesh ?? l.servicioCableadoMesh ?? "") !== ""}
                        onChange={(e) =>
                          handleEdicionChange(
                            l.id,
                            "servicioCableadoMesh",
                            e.target.checked ? "SERVICIO CABLEADO DE MESH" : ""
                          )
                        }
                      />
                    </td>

                    {/* Cat5e */}
                    <td className="border p-1">
                      <input
                        type="number"
                        min={0}
                        value={ediciones[l.id]?.cat5e ?? l.cat5e ?? 0}
                        className="w-20 text-center border rounded px-2 py-1"
                        onChange={(e) => handleEdicionChange(l.id, "cat5e", e.target.value)}
                      />
                    </td>

                    <td className="border p-2">{l.cat6 ?? 0}</td>
                    <td className="border p-2">{puntos}</td>

                    {/* Observación */}
                    <td className="border p-1">
                      <input
                        type="text"
                        value={ediciones[l.id]?.observacion ?? l.observacion ?? ""}
                        className="w-full px-2 py-1 border rounded"
                        onChange={(e) => handleEdicionChange(l.id, "observacion", e.target.value)}
                      />
                    </td>

                    {/* Acción */}
                    <td className="border p-2">
                      <button
                        className={cls(
                          "px-3 py-1 rounded text-xs text-white",
                          guardandoFila === l.id ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-700"
                        )}
                        disabled={guardandoFila === l.id}
                        onClick={() => guardarFila(l)}
                      >
                        {guardandoFila === l.id ? "Guardando…" : "Guardar"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Mostrando{" "}
          <strong>
            {pageData.length > 0 ? (page - 1) * pageSize + 1 : 0}–{(page - 1) * pageSize + pageData.length}
          </strong>{" "}
          de <strong>{liquidacionesFiltradas.length}</strong>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded border bg-white disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ◀
          </button>
          <span className="text-sm">
            Página <strong>{page}</strong> / {totalPages}
          </span>
          <button
            className="px-3 py-1 rounded border bg-white disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}
