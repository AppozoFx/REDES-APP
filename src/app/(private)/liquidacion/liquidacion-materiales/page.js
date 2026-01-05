"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  serverTimestamp,
  // ✅ NUEVO
  query,
  where,
  orderBy,
} from "firebase/firestore";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/es";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";

// NUEVO: XLSX + file-saver
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

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
  const { userData } = useAuth();

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

  // Ordenación
  const [sortKey, setSortKey] = useState("fecha"); // 'estado'|'fecha'|'cuadrilla'|'codigo'|'cliente'
  const [sortDir, setSortDir] = useState("desc"); // 'asc' | 'desc'

  // Edición / liquidación por fila
  const [formFila, setFormFila] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);

  // Focus para escanear ACTA directo
  const scanRef = useRef(null);

  /**
   * ✅ CAMBIO CLAVE:
   * Cargar SOLO el mes desde Firestore usando strings ISO
   * - inicio = "YYYY-MM-01T00:00:00.000Z"
   * - fin    = primer día del siguiente mes "YYYY-MM-01T00:00:00.000Z"
   *
   * Esto evita traer TODO 2025/2026 y elimina el timeout.
   */
  const obtenerInsts = async (yyyyMM) => {
    const inicioISO = dayjs(`${yyyyMM}-01`).startOf("month").toISOString();
    const finISO = dayjs(`${yyyyMM}-01`).add(1, "month").startOf("month").toISOString();

    const q = query(
      collection(db, "liquidacion_instalaciones"),
      where("fechaInstalacion", ">=", inicioISO),
      where("fechaInstalacion", "<", finISO),
      orderBy("fechaInstalacion", "desc")
    );

    const snap = await getDocs(q);
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setInsts(data);
  };

  /* =========================
     Cargar base
  ========================= */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setCargando(true);

        // 1) instalaciones: SOLO MES actual
        await obtenerInsts(dayjs().format("YYYY-MM"));
        if (!alive) return;

        // 2) índice de cuadrillas (por campo "nombre")
        const snapC = await getDocs(collection(db, "cuadrillas"));
        if (!alive) return;

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
        toast.error(e?.message || "Error cargando datos");
      } finally {
        if (alive) setCargando(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // ✅ recargar instalaciones cuando cambie el mes
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setCargando(true);
        await obtenerInsts(filtros.mes);
      } catch (e) {
        console.error(e);
        toast.error(e?.message || "Error cargando datos del mes");
      } finally {
        if (alive) setCargando(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [filtros.mes]);

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
      const okEstado = ver === "todos" ? true : ver === "liquidados" ? liq : !liq;

      return okMes && okDia && okCuad && okQ && okEstado;
    });
  }, [insts, filtros]);

  /* =========================
     Indicadores (globales y de la vista)
  ========================= */
  const indicadoresGlobal = useMemo(() => {
    const total = insts.length;
    let liq = 0;
    for (const r of insts) if (tieneDatosLiq(r)) liq++;
    const pend = total - liq;
    return { total, liq, pend };
  }, [insts]);

  const indicadoresVista = useMemo(() => {
    const total = instsFiltradas.length;
    let liq = 0;
    for (const r of instsFiltradas) if (tieneDatosLiq(r)) liq++;
    const pend = total - liq;
    return { total, liq, pend };
  }, [instsFiltradas]);

  /* =========================
     Ordenación (sobre el resultado ya filtrado)
  ========================= */
  const sortedRows = useMemo(() => {
    const list = [...instsFiltradas];
    const dir = sortDir === "asc" ? 1 : -1;

    const getComparable = (row, key) => {
      if (key === "estado") return tieneDatosLiq(row) ? 1 : 0;
      if (key === "fecha") {
        const f = convFecha(row.fechaInstalacion);
        return f ? f.getTime() : 0;
      }
      if (key === "cuadrilla") return norm(row.cuadrillaNombre || "");
      if (key === "codigo") return norm(row.codigoCliente || "");
      if (key === "cliente") return norm(row.cliente || "");
      return "";
    };

    list.sort((a, b) => {
      const A = getComparable(a, sortKey);
      const B = getComparable(b, sortKey);
      if (A < B) return -1 * dir;
      if (A > B) return 1 * dir;
      const aT = convFecha(a.fechaInstalacion)?.getTime() ?? 0;
      const bT = convFecha(b.fechaInstalacion)?.getTime() ?? 0;
      return bT - aT;
    });

    return list;
  }, [instsFiltradas, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key) => (sortKey !== key ? "↕" : sortDir === "asc" ? "▲" : "▼");

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
        acta: "",
        rotulo: "",
        metraje: "",
        templadores: "",
        hebillas: "",
        clevis: "",
        ...p[rowId],
        [campo]: valor,
      },
    }));
  };

  /* =========================
     Exportar XLSX (filtrado + ordenado)
  ========================= */
  const exportXLSX = () => {
    const headers = ["Estado", "Fecha", "Cuadrilla", "Código", "Cliente", "Acta"];
    const rows = sortedRows.map((l) => {
      const estado = tieneDatosLiq(l) ? "Liquidado" : "Pendiente";
      const fecha = fmt(convFecha(l.fechaInstalacion));
      const cuadrilla = l.cuadrillaNombre || "-";
      const codigo = l.codigoCliente || "-";
      const cliente = l.cliente || "-";
      const acta = (l.acta || "").trim() || "-";
      return [estado, fecha, cuadrilla, codigo, cliente, acta];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "Liquidación");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    saveAs(blob, `liquidacion-materiales_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`);
  };

  /* =========================
     Transacción de guardado (LOGICA ORIGINAL)
  ========================= */
  const guardarLiquidacion = async (row) => {
    const f = formFila[row.id] || {};

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
    const prevHebi = soloRes && Number.isFinite(row.hebillas) ? row.hebillas : 0;
    const prevClev = soloRes && Number.isFinite(row.clevis) ? row.clevis : 0;

    const newTempl = soloRes ? Math.max(0, toInt(templInput !== "" ? templInput : prevTempl)) : 0;
    const newHebi = soloRes ? Math.max(0, toInt(hebiInput !== "" ? hebiInput : prevHebi)) : 0;
    const newClev = soloRes ? Math.max(0, toInt(clevInput !== "" ? clevInput : prevClev)) : 0;

    if (!acta) return toast.error("Ingresa/scanea el Nº de ACTA.");
    if (!rotulo) return toast.error("Ingresa el rótulo NAP/CTO.");

    const dMetraje = Math.max(0, newMetraje - prevMetraje);
    const dTempl = Math.max(0, newTempl - prevTempl);
    const dHebi = Math.max(0, newHebi - prevHebi);
    const dClev = Math.max(0, newClev - prevClev);

    const cuadrillaNombre = row.cuadrillaNombre || "";
    const cuadrillaInfo = cuadrillasIdx[cuadrillaNombre];
    if (!cuadrillaInfo?.id) return toast.error(`No encuentro el ID de la cuadrilla "${cuadrillaNombre}".`);
    const cuadId = cuadrillaInfo.id;

    setGuardandoId(row.id);
    try {
      await runTransaction(db, async (tx) => {
        const refsOpt = [];
        if (dMetraje > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "bobina"));
        if (soloRes) {
          if (dTempl > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "templadores"));
          if (dHebi > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "hebillas"));
          if (dClev > 0) refsOpt.push(doc(db, "cuadrillas", cuadId, "stock_materiales", "clevis"));
        }

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

        const instRef = doc(db, "liquidacion_instalaciones", row.id);
        tx.update(instRef, {
          acta,
          rotuloNapCto: rotulo,
          metraje_instalado: newMetraje,
          templadores: soloRes ? newTempl : 0,
          hebillas: soloRes ? newHebi : 0,
          clevis: soloRes ? newClev : 0,
          materiales_liq_por: userData?.displayName || userData?.email || "Sistema",
          materiales_liq_en: serverTimestamp(),
        });
      });

      toast.success(
        tieneDatosLiq(row)
          ? "✅ Actualización realizada (diferencia aplicada)."
          : "✅ Liquidación registrada."
      );

      // ✅ recarga solo el mes actual
      await obtenerInsts(filtros.mes);

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
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Liquidación de Materiales por Instalación</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={exportXLSX}
            className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700"
            title="Exportar columnas: Estado, Fecha, Cuadrilla, Código, Cliente, Acta"
          >
            ⭳ Exportar XLSX
          </button>
          <button
            onClick={() => scanRef.current?.focus()}
            className="text-sm px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-900"
            title="Ir al campo de escaneo"
          >
            ⌾ Foco en ACTA
          </button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-3 bg-white">
          <div className="text-xs text-gray-500 mb-1">Totales</div>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 border">
              Total: <strong>{indicadoresVista.total}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 border border-green-200">
              Liquidados: <strong>{indicadoresVista.liq}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 border border-amber-200">
              Pendientes: <strong>{indicadoresVista.pend}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Filtros */}
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
              <th className="p-2 border w-32 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("estado")} title="Ordenar por Estado">
                Estado <span className="text-xs opacity-70">{sortIcon("estado")}</span>
              </th>
              <th className="p-2 border w-36 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("fecha")} title="Ordenar por Fecha">
                Fecha <span className="text-xs opacity-70">{sortIcon("fecha")}</span>
              </th>
              <th className="p-2 border w-48 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("cuadrilla")} title="Ordenar por Cuadrilla">
                Cuadrilla <span className="text-xs opacity-70">{sortIcon("cuadrilla")}</span>
              </th>
              <th className="p-2 border w-28 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("codigo")} title="Ordenar por Código">
                Código <span className="text-xs opacity-70">{sortIcon("codigo")}</span>
              </th>
              <th className="p-2 border w-56 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("cliente")} title="Ordenar por Cliente">
                Cliente <span className="text-xs opacity-70">{sortIcon("cliente")}</span>
              </th>

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
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">No hay registros con los filtros actuales.</td>
              </tr>
            ) : (
              sortedRows.map((l) => {
                const f = convFecha(l.fechaInstalacion);
                const v = formFila[l.id] || {};
                const mesh = Array.isArray(l.snMESH) ? l.snMESH.filter(Boolean) : [];
                const box = Array.isArray(l.snBOX) ? l.snBOX.filter(Boolean) : [];
                const saving = guardandoId === l.id;

                const ya = tieneDatosLiq(l);
                const estadoCls = ya ? "bg-green-100 text-green-800 border-green-300" : "bg-amber-100 text-amber-800 border-amber-300";

                const actaExist = (l.acta || "").trim();
                const rotuloExist = (l.rotuloNapCto || "").trim();
                const metrajeExist = Number.isFinite(l.metraje_instalado) ? l.metraje_instalado : null;
                const templExist = Number.isFinite(l.templadores) ? l.templadores : null;
                const hebiExist = Number.isFinite(l.hebillas) ? l.hebillas : null;
                const clevExist = Number.isFinite(l.clevis) ? l.clevis : null;

                return (
                  <tr key={l.id} className="hover:bg-gray-50 align-top">
                    <td className="border p-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${estadoCls}`}>
                        {ya ? "✅ Liquidado" : "🟠 Pendiente"}
                      </span>
                      {l.materiales_liq_en && (
                        <div className="mt-1 text-[11px] text-gray-500">{`Último: ${fmt(convFecha(l.materiales_liq_en))}`}</div>
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
                      ) : (
                        "-"
                      )}
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
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="border p-2 text-center">{l.snFONO || "-"}</td>

                    <td className="border p-2">
                      {/* Chips */}
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

                      {/* Form */}
                      <div className="grid gap-2 md:grid-cols-6">
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
                              (v.metraje !== undefined && String(v.metraje).trim() !== "")
                              ? "border-green-400"
                              : ""
                          )}
                          value={v.metraje !== undefined ? v.metraje : typeof l.metraje_instalado === "number" ? l.metraje_instalado : ""}
                          onChange={(e) => setField(l.id, "metraje", e.target.value)}
                          title="Metraje instalado (descuenta bobina)"
                        />

                        {esResidencial(l) && (
                          <>
                            <input
                              type="number"
                              min={0}
                              placeholder="Templadores"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.templadores === "number" && v.templadores === undefined) ||
                                  (v.templadores !== undefined && String(v.templadores).trim() !== "")
                                  ? "border-green-400"
                                  : ""
                              )}
                              value={v.templadores !== undefined ? v.templadores : typeof l.templadores === "number" ? l.templadores : ""}
                              onChange={(e) => setField(l.id, "templadores", e.target.value)}
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="Hebillas"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.hebillas === "number" && v.hebillas === undefined) ||
                                  (v.hebillas !== undefined && String(v.hebillas).trim() !== "")
                                  ? "border-green-400"
                                  : ""
                              )}
                              value={v.hebillas !== undefined ? v.hebillas : typeof l.hebillas === "number" ? l.hebillas : ""}
                              onChange={(e) => setField(l.id, "hebillas", e.target.value)}
                            />
                            <input
                              type="number"
                              min={0}
                              placeholder="Clevis"
                              className={cls(
                                "border rounded px-2 py-1",
                                (typeof l.clevis === "number" && v.clevis === undefined) ||
                                  (v.clevis !== undefined && String(v.clevis).trim() !== "")
                                  ? "border-green-400"
                                  : ""
                              )}
                              value={v.clevis !== undefined ? v.clevis : typeof l.clevis === "number" ? l.clevis : ""}
                              onChange={(e) => setField(l.id, "clevis", e.target.value)}
                            />
                          </>
                        )}

                        <div className="md:col-span-6 flex items-center justify-between">
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
