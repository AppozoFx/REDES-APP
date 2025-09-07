"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/es";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext"; // ajusta si tu ruta difiere

dayjs.extend(customParseFormat);
dayjs.locale("es");

/* =========================
   Helpers
========================= */
const cls = (...x) => x.filter(Boolean).join(" ");
const toInt = (v) => {
  const n = parseInt(String(v ?? 0), 10);
  return Number.isNaN(n) ? 0 : n;
};
const toFloat = (v) => {
  const n = parseFloat(String(v ?? 0));
  return Number.isNaN(n) ? 0 : n;
};
const convFecha = (valor) => {
  if (!valor) return null;
  if (typeof valor?.toDate === "function") return valor.toDate();
  const p = dayjs(valor, "D [de] MMMM [de] YYYY, h:mm:ss A [UTC-5]", "es", true);
  return p.isValid() ? p.toDate() : new Date(valor);
};
const fmt = (d) => (d ? dayjs(d).format("DD/MM/YYYY") : "-");

// Normaliza string para filtros (sin tildes, minúsculas)
const norm = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const esResidencial = (row) =>
  (row.residencialCondominio || "")
    .toString()
    .trim()
    .toUpperCase() === "RESIDENCIAL";

// ¿ya tiene datos de liquidación?
const tieneDatosLiq = (row) => {
  const a = (row.acta || "").trim();
  const r = (row.rotuloNapCto || "").trim();
  const m = Number.isFinite(row.metraje_instalado) ? row.metraje_instalado : 0;
  const t = Number.isFinite(row.templadores) ? row.templadores : 0;
  const h = Number.isFinite(row.hebillas) ? row.hebillas : 0;
  const c = Number.isFinite(row.clevis) ? row.clevis : 0;
  if (esResidencial(row)) return !!(a || r || m || t || h || c);
  return !!(a || r || m);
};

/* =========================
   Página
========================= */
export default function LiquidacionMaterialesPage() {
  const { userData } = useAuth(); // { uid, displayName, email, ... }

  const [cargando, setCargando] = useState(false);
  const [insts, setInsts] = useState([]);
  const [cuadrillasIdx, setCuadrillasIdx] = useState({}); // nombre -> { id, r_c/categoria }

  // filtros (sin R/C) + estado (toggle)
  const [filtros, setFiltros] = useState({
    mes: dayjs().format("YYYY-MM"),
    dia: "",
    cuadrilla: "",
    busqueda: "",
    estado: "todos", // "todos" | "pendientes" | "liquidados"
  });

  // Edición / liquidación por fila
  const [formFila, setFormFila] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);

  // Focus para escanear ACTA directo
  const scanRef = useRef(null);

  const obtenerInsts = async () => {
    const snap = await getDocs(collection(db, "liquidacion_instalaciones"));
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setInsts(data);
  };

  /* =========================
     Cargar base
  ========================= */
  useEffect(() => {
    (async () => {
      try {
        setCargando(true);
        // 1) instalaciones
        await obtenerInsts();

        // 2) índice de cuadrillas (por campo "nombre")
        const snapC = await getDocs(collection(db, "cuadrillas"));
        const idx = {};
        snapC.docs.forEach((d) => {
          const v = d.data();
          const nombre = (v?.nombre || "").trim();
          if (nombre) {
            idx[nombre] = {
              id: d.id,
              categoria: v?.categoria || v?.r_c || v?.tipo || "",
              r_c: v?.r_c || "",
            };
          }
        });
        setCuadrillasIdx(idx);
      } catch (e) {
        console.error(e);
        toast.error("Error cargando datos");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  /* =========================
     Filtro
  ========================= */
  const instsFiltradas = useMemo(() => {
    const mes = filtros.mes;
    const dia = filtros.dia;
    const q = norm(filtros.busqueda);
    const cuad = norm(filtros.cuadrilla);
    const ver = filtros.estado; // "todos" | "pendientes" | "liquidados"

    return insts.filter((l) => {
      const f = convFecha(l.fechaInstalacion);
      if (!f) return false;

      const okMes = dayjs(f).format("YYYY-MM") === mes;
      const okDia = dia ? dayjs(f).format("YYYY-MM-DD") === dia : true;

      const lCuad = norm(l.cuadrillaNombre);
      const okCuad = cuad ? lCuad.includes(cuad) : true;

      const hay = norm(`${l.codigoCliente || ""} ${l.cliente || ""} ${l.cuadrillaNombre || ""}`);
      const okQ = q ? hay.includes(q) : true;

      const liq = tieneDatosLiq(l);
      const okEstado =
        ver === "todos" ? true : ver === "liquidados" ? liq : !liq;

      return okMes && okDia && okCuad && okQ && okEstado;
    });
  }, [insts, filtros]);

  /* =========================
     Handlers UI
  ========================= */
  const onChangeFiltro = (e) => {
    const { name, value } = e.target;
    setFiltros((p) => ({ ...p, [name]: value }));
  };

  const setField = (rowId, campo, valor) => {
    setFormFila((p) => ({
      ...p,
      [rowId]: {
        // defaults
        acta: "",
        rotulo: "",
        metraje: "",
        templadores: "",
        hebillas: "",
        clevis: "",
        // override
        ...p[rowId],
        [campo]: valor,
      },
    }));
  };

  /* =========================
     Transacción de guardado (actualiza el doc) con DESCUENTO DIFERENCIAL
  ========================= */
  const guardarLiquidacion = async (row) => {
    const f = formFila[row.id] || {};

    // 1) Consolidar "nuevo" valor: si input vacío, conservar existente
    const actaInput = (f.acta ?? "").toString().trim();
    const rotuloInput = (f.rotulo ?? "").toString().trim();
    const metrajeInput = f.metraje ?? "";
    const templInput = f.templadores ?? "";
    const hebiInput = f.hebillas ?? "";
    const clevInput = f.clevis ?? "";

    const acta = actaInput || (row.acta || "");
    const rotulo = rotuloInput || (row.rotuloNapCto || "");

    const prevMetraje = Number.isFinite(row.metraje_instalado) ? row.metraje_instalado : 0;
    const newMetraje = Math.max(0, toFloat(metrajeInput !== "" ? metrajeInput : prevMetraje));

    const soloRes = esResidencial(row);

    const prevTempl = soloRes && Number.isFinite(row.templadores) ? row.templadores : 0;
    const prevHebi  = soloRes && Number.isFinite(row.hebillas) ? row.hebillas : 0;
    const prevClev  = soloRes && Number.isFinite(row.clevis) ? row.clevis : 0;

    const newTempl = soloRes ? Math.max(0, toInt(templInput !== "" ? templInput : prevTempl)) : 0;
    const newHebi  = soloRes ? Math.max(0, toInt(hebiInput  !== "" ? hebiInput  : prevHebi )) : 0;
    const newClev  = soloRes ? Math.max(0, toInt(clevInput  !== "" ? clevInput  : prevClev )) : 0;

    // 2) Validaciones mínimas
    if (!acta)  return toast.error("Ingresa/scanea el Nº de ACTA.");
    if (!rotulo) return toast.error("Ingresa el rótulo NAP/CTO.");

    // 3) Calcular DELTAS (solo se descuentan positivos)
    const dMetraje = Math.max(0, newMetraje - prevMetraje);
    const dTempl   = Math.max(0, newTempl   - prevTempl);
    const dHebi    = Math.max(0, newHebi    - prevHebi);
    const dClev    = Math.max(0, newClev    - prevClev);

    const cuadrillaNombre = row.cuadrillaNombre || "";
    const cuadrillaInfo = cuadrillasIdx[cuadrillaNombre];
    if (!cuadrillaInfo?.id) {
      return toast.error(`No encuentro el ID de la cuadrilla "${cuadrillaNombre}".`);
    }
    const cuadId = cuadrillaInfo.id;

    setGuardandoId(row.id);
    try {
      await runTransaction(db, async (tx) => {
        // 4) Preparar refs solo para lo que tenga delta > 0
        const refsOpt = [];
        if (dMetraje > 0) {
          refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "bobina"));
        }
        if (soloRes) {
          if (dTempl > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "templadores"));
          if (dHebi  > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "hebillas"));
          if (dClev  > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "clevis"));
        }

        // 5) Leer cantidades y validar stock suficiente SOLO para las diferencias
        const snaps = await Promise.all(refsOpt.map((r) => tx.get(r)));
        const getCant = (id) => toFloat(snaps.find((s) => s.ref.id === id)?.data()?.cantidad || 0);

        const faltas = [];
        if (dMetraje > 0) {
          const cur = getCant("bobina");
          if (cur - dMetraje < 0) faltas.push(`bobina (tienes ${cur} m, pides +${dMetraje} m)`);
        }
        if (soloRes) {
          if (dTempl > 0) {
            const cur = getCant("templadores");
            if (cur - dTempl < 0) faltas.push(`templadores (tienes ${cur}, pides +${dTempl})`);
          }
          if (dHebi > 0) {
            const cur = getCant("hebillas");
            if (cur - dHebi < 0) faltas.push(`hebillas (tienes ${cur}, pides +${dHebi})`);
          }
          if (dClev > 0) {
            const cur = getCant("clevis");
            if (cur - dClev < 0) faltas.push(`clevis (tienes ${cur}, pides +${dClev})`);
          }
        }

        if (faltas.length) throw new Error("Stock insuficiente: " + faltas.join(" | "));

        // 6) Descontar SOLO las diferencias positivas
        const marca = {
          actualizadoEn: serverTimestamp(),
          actualizadoPor: userData?.displayName || userData?.email || "Sistema",
        };
        if (dMetraje > 0) {
          const refBob = doc(db, "cuadrillas", cuadId, "stock_materiales", "bobina");
          const cur = getCant("bobina");
          tx.update(refBob, { cantidad: cur - dMetraje, ...marca });
        }
        if (soloRes) {
          if (dTempl > 0) {
            const r = doc(db, "cuadrillas", cuadId, "stock_materiales", "templadores");
            const cur = getCant("templadores");
            tx.update(r, { cantidad: cur - dTempl, ...marca });
          }
          if (dHebi > 0) {
            const r = doc(db, "cuadrillas", cuadId, "stock_materiales", "hebillas");
            const cur = getCant("hebillas");
            tx.update(r, { cantidad: cur - dHebi, ...marca });
          }
          if (dClev > 0) {
            const r = doc(db, "cuadrillas", cuadId, "stock_materiales", "clevis");
            const cur = getCant("clevis");
            tx.update(r, { cantidad: cur - dClev, ...marca });
          }
        }

        // 7) Actualizar el documento de instalación con los NUEVOS totales
        const instRef = doc(db, "liquidacion_instalaciones", row.id);
        tx.update(instRef, {
          acta,                         // "005-0024274"
          rotuloNapCto: rotulo,         // texto
          metraje_instalado: newMetraje,// número (m)
          templadores: soloRes ? newTempl : 0,
          hebillas:    soloRes ? newHebi  : 0,
          clevis:      soloRes ? newClev  : 0,
          materiales_liq_por: userData?.displayName || userData?.email || "Sistema",
          materiales_liq_en: serverTimestamp(),
        });
      });

      toast.success(tieneDatosLiq(row) ? "✅ Actualización realizada (diferencia aplicada)." : "✅ Liquidación registrada.");
      await obtenerInsts(); // refrescar para ver chips/estado
      setFormFila((p) => {
        const cp = { ...p };
        delete cp[row.id];
        return cp;
      });
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "No se pudo liquidar.");
    } finally {
      setGuardandoId(null);
    }
  };

  /* =========================
     Render
  ========================= */
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Liquidación de Materiales por Instalación</h1>
        <button
          onClick={() => scanRef.current?.focus()}
          className="text-sm px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-900"
          title="Ir al campo de escaneo"
        >
          ⌾ Foco en ACTA
        </button>
      </div>

      {/* Filtros (sin R/C) + toggle estado */}
      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Mes</label>
          <input
            type="month"
            name="mes"
            value={filtros.mes}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Día</label>
          <input
            type="date"
            name="dia"
            value={filtros.dia}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Cuadrilla</label>
          <input
            list="lista-cuadrillas"
            type="text"
            name="cuadrilla"
            placeholder="Escribe o elige…"
            value={filtros.cuadrilla}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
          />
          <datalist id="lista-cuadrillas">
            {Object.keys(cuadrillasIdx).sort().map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Código o Cliente</label>
          <input
            type="text"
            name="busqueda"
            placeholder="Buscar por código o cliente…"
            value={filtros.busqueda}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Estado</label>
          <select
            name="estado"
            value={filtros.estado}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
            title="Filtra por estado de liquidación"
          >
            <option value="todos">Todos</option>
            <option value="pendientes">Pendientes</option>
            <option value="liquidados">Liquidados</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr className="text-center text-gray-700 font-semibold">
              <th className="p-2 border w-32">Estado</th>
              <th className="p-2 border w-36">Fecha</th>
              <th className="p-2 border w-48">Cuadrilla</th>
              <th className="p-2 border w-28">Código</th>
              <th className="p-2 border w-56">Cliente</th>
              <th className="p-2 border w-40">SN ONT</th>
              <th className="p-2 border w-60">SN MESH</th>
              <th className="p-2 border w-60">SN BOX</th>
              <th className="p-2 border w-40">SN FONO</th>
              <th className="p-2 border min-w-[620px]">Liquidar / Datos existentes</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">Cargando…</td>
              </tr>
            ) : instsFiltradas.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">No hay registros con los filtros actuales.</td>
              </tr>
            ) : (
              instsFiltradas.map((l) => {
                const f = convFecha(l.fechaInstalacion);
                const v = formFila[l.id] || {};
                const mesh = Array.isArray(l.snMESH) ? l.snMESH.filter(Boolean) : [];
                const box = Array.isArray(l.snBOX) ? l.snBOX.filter(Boolean) : [];
                const saving = guardandoId === l.id;

                const ya = tieneDatosLiq(l);
                const estadoCls = ya
                  ? "bg-green-100 text-green-800 border-green-300"
                  : "bg-amber-100 text-amber-800 border-amber-300";

                const actaExist = (l.acta || "").trim();
                const rotuloExist = (l.rotuloNapCto || "").trim();
                const metrajeExist = Number.isFinite(l.metraje_instalado) ? l.metraje_instalado : null;
                const templExist = Number.isFinite(l.templadores) ? l.templadores : null;
                const hebiExist = Number.isFinite(l.hebillas) ? l.hebillas : null;
                const clevExist = Number.isFinite(l.clevis) ? l.clevis : null;

                return (
                  <tr key={l.id} className="hover:bg-gray-50 align-top">
                    {/* Estado */}
                    <td className="border p-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${estadoCls}`}>
                        {ya ? "✅ Liquidado" : "🟠 Pendiente"}
                      </span>
                      {l.materiales_liq_en && (
                        <div className="mt-1 text-[11px] text-gray-500">
                          {`Último: ${fmt(convFecha(l.materiales_liq_en))}`}
                        </div>
                      )}
                    </td>

                    <td className="border p-2 text-center">{fmt(f)}</td>
                    <td className="border p-2 text-center">{l.cuadrillaNombre || "-"}</td>
                    <td className="border p-2 text-center">{l.codigoCliente || "-"}</td>
                    <td className="border p-2">{l.cliente || "-"}</td>
                    <td className="border p-2 text-center">{l.snONT || "-"}</td>
                    <td className="border p-2">
                      {mesh.length ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {mesh.map((sn, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-800 border">
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="border p-2">
                      {box.length ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {box.map((sn, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 border">
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="border p-2 text-center">{l.snFONO || "-"}</td>

                    {/* Bloque de liquidación + datos existentes */}
                    <td className="border p-2">
                      {/* Chips de datos existentes */}
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {actaExist ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 border text-slate-700">ACTA: {actaExist}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">ACTA: —</span>
                        )}
                        {rotuloExist ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 border text-slate-700">Rótulo: {rotuloExist}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">Rótulo: —</span>
                        )}
                        {typeof metrajeExist === "number" ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 border text-slate-700">Metros: {metrajeExist}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">Metros: —</span>
                        )}
                        {esResidencial(l) && (
                          <>
                            {typeof templExist === "number" ? (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 border border-green-200 text-green-800">Templadores: {templExist}</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">Templadores: —</span>
                            )}
                            {typeof hebiExist === "number" ? (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 border border-green-200 text-green-800">Hebillas: {hebiExist}</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">Hebillas: —</span>
                            )}
                            {typeof clevExist === "number" ? (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 border border-green-200 text-green-800">Clevis: {clevExist}</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-rose-50 border border-rose-200 text-rose-700">Clevis: —</span>
                            )}
                          </>
                        )}
                      </div>

                      {/* Formulario de liquidación / actualización */}
                      <div className="grid gap-2 md:grid-cols-6">
                        {/* ACTA con autoguionado; precarga desde doc si no hay edición */}
                        <input
                          ref={scanRef}
                          type="text"
                          inputMode="numeric"
                          placeholder="Nº ACTA (scan)"
                          className={cls(
                            "border rounded px-2 py-1",
                            (l.acta && !v.acta) || (v.acta && v.acta.trim() !== "") ? "border-green-400" : ""
                          )}
                          value={v.acta ?? l.acta ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const soloDig = raw.replace(/[^\d]/g, "");
                            const form = soloDig.length <= 3 ? soloDig : `${soloDig.slice(0, 3)}-${soloDig.slice(3)}`;
                            setField(l.id, "acta", form);
                          }}
                        />

                        <input
                          type="text"
                          placeholder="Rótulo NAP/CTO"
                          className={cls(
                            "border rounded px-2 py-1",
                            (l.rotuloNapCto && !v.rotulo) || (v.rotulo && v.rotulo.trim() !== "") ? "border-green-400" : ""
                          )}
                          value={v.rotulo ?? l.rotuloNapCto ?? ""}
                          onChange={(e) => setField(l.id, "rotulo", e.target.value)}
                        />

                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Metros"
                          className={cls(
                            "border rounded px-2 py-1",
                            (typeof l.metraje_instalado === "number" && v.metraje === undefined) ||
                            (v.metraje !== undefined && String(v.metraje).trim() !== "") ? "border-green-400" : ""
                          )}
                          value={v.metraje !== undefined ? v.metraje : (typeof l.metraje_instalado === "number" ? l.metraje_instalado : "")}
                          onChange={(e) => setField(l.id, "metraje", e.target.value)}
                          title="Metraje instalado (descuenta bobina)"
                        />

                        {/* Solo para RESIDENCIAL */}
                        {esResidencial(l) && (
                          <>
                            <input
                              type="number"
                              min={0}
                              placeholder="Templadores"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.templadores === "number" && v.templadores === undefined) ||
                                (v.templadores !== undefined && String(v.templadores).trim() !== "") ? "border-green-400" : ""
                              )}
                              value={v.templadores !== undefined ? v.templadores : (typeof l.templadores === "number" ? l.templadores : "")}
                              onChange={(e) => setField(l.id, "templadores", e.target.value)}
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="Hebillas"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.hebillas === "number" && v.hebillas === undefined) ||
                                (v.hebillas !== undefined && String(v.hebillas).trim() !== "") ? "border-green-400" : ""
                              )}
                              value={v.hebillas !== undefined ? v.hebillas : (typeof l.hebillas === "number" ? l.hebillas : "")}
                              onChange={(e) => setField(l.id, "hebillas", e.target.value)}
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="Clevis"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.clevis === "number" && v.clevis === undefined) ||
                                (v.clevis !== undefined && String(v.clevis).trim() !== "") ? "border-green-400" : ""
                              )}
                              value={v.clevis !== undefined ? v.clevis : (typeof l.clevis === "number" ? l.clevis : "")}
                              onChange={(e) => setField(l.id, "clevis", e.target.value)}
                            />
                          </>
                        )}

                        <div className="md:col-span-6 flex items-center justify-between">
                          {/* Resumen faltante/ok (simple) */}
                          <div className="text-[11px] text-gray-600">
                            {(() => {
                              const faltan = [];
                              if (!actaExist && !v.acta) faltan.push("ACTA");
                              if (!rotuloExist && !v.rotulo) faltan.push("Rótulo");
                              if (!(typeof metrajeExist === "number") && v.metraje === undefined) faltan.push("Metros");
                              if (esResidencial(l)) {
                                if (!(typeof templExist === "number") && v.templadores === undefined) faltan.push("Templadores");
                                if (!(typeof hebiExist === "number") && v.hebillas === undefined) faltan.push("Hebillas");
                                if (!(typeof clevExist === "number") && v.clevis === undefined) faltan.push("Clevis");
                              }
                              return faltan.length ? `Faltan: ${faltan.join(", ")}` : "Todo OK";
                            })()}
                          </div>

                          <button
                            disabled={saving}
                            onClick={() => guardarLiquidacion(l)}
                            className={cls(
                              "px-4 py-1.5 rounded text-white",
                              saving ? "bg-slate-400" : ya ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"
                            )}
                          >
                            {saving ? "Guardando…" : ya ? "Actualizar" : "Liquidar"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        * Se descuenta del stock de la cuadrilla (subcolección <code>stock_materiales</code>) y se
        <strong> actualiza</strong> el documento de <code>liquidacion_instalaciones</code> con los
        nuevos totales. Si aumentas cantidades, se descuenta <u>solo la diferencia</u>; si reduces, no se repone (puedo habilitar reposición si lo necesitas).
      </p>
    </div>
  );
}
