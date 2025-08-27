// src/app/dashboard/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import dayjs from "dayjs";
import durationPlugin from "dayjs/plugin/duration";
import { useAuth } from "@/context/AuthContext";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import * as XLSX from "xlsx";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";

dayjs.extend(durationPlugin);

/* =========================
   UI helpers
========================= */
const COLORS = ["#6366f1", "#10b981", "#f43f5e", "#f59e0b", "#3b82f6", "#14b8a6", "#8b5cf6", "#ec4899", "#22c55e", "#eab308"];



function Card({ title, right, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, delta, hint }) {
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <div className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">{value}</div>
        <span
          className={
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold " +
            (isUp
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : isDown
              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300")
          }
        >
          {isUp ? "▲" : isDown ? "▼" : "•"} {Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts` : "—"}
        </span>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Empty({ title = "Sin datos", desc = "No hay información para los filtros seleccionados." }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
      </div>
    </div>
  );
}

function Skeleton({ rows = 1 }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mb-3 h-6 rounded bg-slate-200 dark:bg-slate-700" />
      ))}
    </div>
  );
}

/* =========================
   Mapa (React-Leaflet)
========================= */
const MapInstalaciones = dynamic(
  () =>
    import("react-leaflet").then(({ MapContainer, TileLayer, CircleMarker, Popup }) => {
      const Comp = ({ points, center = [-12.0464, -77.0428], zoom = 11 }) => (
        <MapContainer center={center} zoom={zoom} style={{ height: 320, width: "100%", borderRadius: "12px" }}>
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p, idx) => {
            const color =
              p.estado === "finalizada" ? "#10b981" :
              p.estado === "pendiente" ? "#f43f5e" :
              p.estado === "reprogramada" ? "#f59e0b" :
              "#64748b";
            return (
              <CircleMarker key={idx} center={[p.lat, p.lng]} pathOptions={{ color }} radius={6}>
                <Popup>
                  <div className="text-xs">
                    <p><b>Cliente:</b> {p.cliente || "—"}</p>
                    <p><b>Estado:</b> {p.estado}</p>
                    <p><b>Cuadrilla:</b> {p.cuadrilla || "—"}</p>
                    <p><b>Gestor:</b> {p.gestor || "—"}</p>
                    <p><b>Coordinador:</b> {p.coordinador || "—"}</p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      );
      return { default: Comp };
    }),
  { ssr: false }
);

/* =========================
   Página
========================= */
export default function Dashboard() {
  const { user, initializing } = useAuth();

  /* --------- Fecha / Período --------- */
  // tipo: dia | semana | semanas | mes
  const [rangoTipo, setRangoTipo] = useState("dia");
  const hoyYMD = dayjs().format("YYYY-MM-DD");
  const [fechaDia, setFechaDia] = useState(hoyYMD);
  const [semana, setSemana] = useState(dayjs().format("YYYY-[W]WW"));          // p.ej. 2025-W09
  const [semanaIni, setSemanaIni] = useState(dayjs().format("YYYY-[W]WW"));    // para "semanas"
  const [semanaFin, setSemanaFin] = useState(dayjs().format("YYYY-[W]WW"));
  const [mesVal, setMesVal] = useState(dayjs().format("YYYY-MM"));             // p.ej. 2025-09

  // Helpers de semana ISO (sin plugin)
  const parseWeekValue = (val) => {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(String(val || ""));
    if (!m) return null;
    return { year: Number(m[1]), week: Number(m[2]) };
  };
  const isoWeekStart = ({ year, week }) => {
    const d4 = dayjs(new Date(year, 0, 4));
    const startWeek1 = d4.startOf("week").add(1, "day"); // Monday
    return startWeek1.add((week - 1) * 7, "day");
  };

  const periodo = useMemo(() => {
    let start, end, etiqueta;
    if (rangoTipo === "dia") {
      start = dayjs(fechaDia);
      end = start;
    } else if (rangoTipo === "semana") {
      const pw = parseWeekValue(semana);
      if (pw) {
        start = isoWeekStart(pw);
        end = start.add(6, "day");
      } else {
        start = dayjs(fechaDia).startOf("week").add(1, "day");
        end = start.add(6, "day");
      }
    } else if (rangoTipo === "semanas") {
      const a = parseWeekValue(semanaIni);
      const b = parseWeekValue(semanaFin);
      let s = a ? isoWeekStart(a) : dayjs(fechaDia).startOf("week").add(1, "day");
      let e = b ? isoWeekStart(b).add(6, "day") : s.add(6, "day");
      if (e.isBefore(s)) [s, e] = [e, s];
      start = s; end = e;
    } else {
      const base = dayjs(`${mesVal}-01`);
      start = base.startOf("month");
      end = base.endOf("month");
    }
    etiqueta = `${start.format("YYYY-MM-DD")} — ${end.format("YYYY-MM-DD")}`;
    return { start, end, etiqueta };
  }, [rangoTipo, fechaDia, semana, semanaIni, semanaFin, mesVal]);

  const periodoPrev = useMemo(() => {
    let start, end;
    if (rangoTipo === "dia") {
      start = periodo.start.subtract(1, "day");
      end = periodo.end.subtract(1, "day");
    } else if (rangoTipo === "semana") {
      start = periodo.start.subtract(7, "day");
      end = periodo.end.subtract(7, "day");
    } else if (rangoTipo === "semanas") {
      const dias = periodo.end.diff(periodo.start, "day") + 1;
      start = periodo.start.subtract(dias, "day");
      end = periodo.end.subtract(dias, "day");
    } else {
      start = periodo.start.subtract(1, "month").startOf("month");
      end = periodo.start.subtract(1, "month").endOf("month");
    }
    return { start, end };
  }, [periodo, rangoTipo]);

  const fechasDe = (p) => {
    const out = [];
    let d = p.start;
    while (d.diff(p.end, "day") <= 0) {
      out.push(d.format("YYYY-MM-DD"));
      d = d.add(1, "day");
    }
    return out;
  };
  const fechasSel = useMemo(() => fechasDe(periodo), [periodo]);
  const fechasPrev = useMemo(() => fechasDe(periodoPrev), [periodoPrev]);

  const fechaRef = periodo.end.format("YYYY-MM-DD");

  /* --------- datos base --------- */
  const [cargando, setCargando] = useState(false);
  const montado = useRef(true);

  // datasets
  const [asistenciaCuadrillasAll, setAsistenciaCuadrillasAll] = useState([]);
  const [asistenciaTecnicosAll, setAsistenciaTecnicosAll] = useState([]);
  const [instalacionesAll, setInstalacionesAll] = useState([]);
  const [usuariosIdx, setUsuariosIdx] = useState({}); // uid -> datos usuario

  // filtros (basados en instalaciones/asistencia)
  const [fZona, setFZona] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fTipoCuadrilla, setFTipoCuadrilla] = useState("");
  const [fGestor, setFGestor] = useState("");
  const [fCoordinador, setFCoordinador] = useState("");
  const [fCuadrilla, setFCuadrilla] = useState(""); // texto libre

  // metas
  const [metaInstalaciones, setMetaInstalaciones] = useState(100);
  const [metaPctAsistencia, setMetaPctAsistencia] = useState(85);

  const [showAvanzado, setShowAvanzado] = useState(false);

  // --- utils ---
  const norm = (v) => String(v ?? "").toLowerCase().trim();
  // normalizador robusto de nombre de cuadrilla (quita prefijo c_, guiones, múltiples espacios, etc.)
  const normCuad = (v) => String(v ?? "")
    .toLowerCase()
    .replace(/^c_/, "")
    .replace(/[\W_]+/g, " ")
    .trim();

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  // Carga inicial
  useEffect(() => {
    if (initializing || !user) return;

    (async () => {
      try {
        setCargando(true);

        const snapC = await getDocs(collection(db, "asistencia_cuadrillas"));
        const asistenciaC = snapC.docs.map(d => ({ id: d.id, ...d.data() }));

        const snapT = await getDocs(collection(db, "asistencia_tecnicos"));
        const asistenciaT = snapT.docs.map(d => ({ id: d.id, ...d.data() }));

        const snapI = await getDocs(collection(db, "instalaciones"));
        const instalaciones = snapI.docs.map(d => {
          const raw = d.data();
          const _fechaYMD =
            typeof raw.fechaInstalacion === "string"
              ? dayjs(raw.fechaInstalacion).format("YYYY-MM-DD")
              : raw.fechaInstalacion?.toDate
              ? dayjs(raw.fechaInstalacion.toDate()).format("YYYY-MM-DD")
              : "";
          const _cuadrillaNombre = raw.cuadrillaNombre || raw.cuadrilla || "";
          return { id: d.id, ...raw, _fechaYMD, _cuadrillaNombre };
        });

        const snapU = await getDocs(collection(db, "usuarios"));
        const idxU = {};
        snapU.docs.forEach(d => { idxU[d.id] = d.data(); });

        if (!montado.current) return;
        setAsistenciaCuadrillasAll(asistenciaC);
        setAsistenciaTecnicosAll(asistenciaT);
        setInstalacionesAll(instalaciones);
        setUsuariosIdx(idxU);
      } catch (err) {
        console.warn("Error dashboard:", err?.code || err?.message);
        if (!montado.current) return;
        setAsistenciaCuadrillasAll([]);
        setAsistenciaTecnicosAll([]);
        setInstalacionesAll([]);
        setUsuariosIdx({});
      } finally {
        if (montado.current) setCargando(false);
      }
    })();
  }, [initializing, user]);

  /* =========================
     Helpers
  ========================== */
  const toYMD = (x) => {
    if (!x) return "";
    if (typeof x === "string") return dayjs(x).format("YYYY-MM-DD");
    if (x.toDate) return dayjs(x.toDate()).format("YYYY-MM-DD");
    return "";
  };

  const personaDe = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const u = usuariosIdx[s];
    return (
      u?.fullName ||
      u?.nombre ||
      u?.displayName ||
      u?.nombres ||
      u?.name ||
      s
    );
  };

  const setFechas = new Set(fechasSel);
  const setFechasPrev = new Set(fechasPrev);

  /* =========================
     Base del PERÍODO (instalaciones)
  ========================== */
  const instalacionesPeriodoBase = useMemo(
    () => instalacionesAll.filter(i => setFechas.has(i._fechaYMD)),
    [instalacionesAll, setFechas, fechasSel.join("|")]
  );

  // Índice asistencia por nombre de cuadrilla para el período (por si hace falta meta)
  const asistenciaPeriodoBase = useMemo(
    () => asistenciaCuadrillasAll.filter(c => setFechas.has(c.fecha)),
    [asistenciaCuadrillasAll, setFechas, fechasSel.join("|")]
  );

  // Meta por cuadrilla desde instalaciones (para completar región/tipo si falta en asistencia)
  const instalacionesPeriodoEnriq = useMemo(() => {
    // enriquecer cada instalación con campos unificados
    return instalacionesPeriodoBase.map(i => {
      const _zona = i.zona || "Sin Zona";
      const _region = i.region || "";
      const _tipoCuadrilla = i.tipoCuadrilla || "";
      const _gestor = personaDe(i.gestor || i.gestorCuadrilla || i.gestorNombre || i.gestorCuadrillaNombre || "");
      const _coordinador = personaDe(i.coordinador || i.coordinadorCuadrilla || i.coordinadorNombre || i.coordinadorCuadrillaNombre || "");
      const _cuadrillaNombre = i._cuadrillaNombre || "";
      return { ...i, _zona, _region, _tipoCuadrilla, _gestor, _coordinador, _cuadrillaNombre };
    });
  }, [instalacionesPeriodoBase, usuariosIdx]);

  // índice meta por cuadrilla normalizada
  const idxMetaCuadrilla = useMemo(() => {
    const m = {};
    for (const i of instalacionesPeriodoEnriq) {
      const k = normCuad(i._cuadrillaNombre);
      if (!k) continue;
      if (!m[k]) {
        m[k] = {
          zona: i._zona,
          region: i._region,
          tipoCuadrilla: i._tipoCuadrilla,
          gestor: i._gestor,
          coordinador: i._coordinador,
          nombre: i._cuadrillaNombre,
        };
      }
    }
    return m;
  }, [instalacionesPeriodoEnriq]);

  /* =========================
     Filtros (opciones desde instalaciones)
  ========================== */
  const opcionesZonas = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._zona || "Sin Zona").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  const opcionesRegiones = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._region || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  const opcionesTipoCuadrilla = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._tipoCuadrilla || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  const opcionesGestor = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._gestor || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  const opcionesCoordinador = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._coordinador || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  const opcionesCuadrilla = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesPeriodoEnriq) {
      const label = (i._cuadrillaNombre || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesPeriodoEnriq]);

  // Filtro principal para instalaciones seleccionadas (para el resto de paneles)
  const pasaFiltroInst = (i) => {
    if (fZona && norm(i._zona || "Sin Zona") !== norm(fZona)) return false;
    if (fRegion && norm(i._region || "") !== norm(fRegion)) return false;
    if (fTipoCuadrilla && norm(i._tipoCuadrilla || "") !== norm(fTipoCuadrilla)) return false;
    if (fGestor && norm(i._gestor || "") !== norm(fGestor)) return false;
    if (fCoordinador && norm(i._coordinador || "") !== norm(fCoordinador)) return false;
    if (fCuadrilla && !norm(i._cuadrillaNombre || "").includes(norm(fCuadrilla))) return false;
    return true;
  };

  const instalacionesSel = useMemo(
    () => instalacionesPeriodoEnriq.filter(pasaFiltroInst),
    [instalacionesPeriodoEnriq, fZona, fRegion, fTipoCuadrilla, fGestor, fCoordinador, fCuadrilla]
  );

  /* =========================
     Asistencia (SOLO asistencia) — no depende de instalaciones
     - Cuadrillas con técnicos por día
     - Se excluyen "descanso"
     - Se aplican los filtros usando datos de asistencia y meta de instalaciones
  ========================== */

  // índice de cuadrillas con técnicos por día (fechas del período)
  const idxTecPorDia = useMemo(() => {
    const m = {};
    for (const t of asistenciaTecnicosAll) {
      const y = toYMD(t.fecha);
      if (!setFechas.has(y)) continue;
      const k = normCuad(
        t.cuadrillaNombre ||
        t.cuadrilla ||
        t.nombreCuadrilla ||
        t.cuadrillaId              // <-- añadido
      );
      if (!k) continue;
      if (!m[y]) m[y] = new Set();
      m[y].add(k);
    }
    return m;
  }, [asistenciaTecnicosAll, setFechas, fechasSel.join("|")]);

  // asistencia del período ya filtrada por los selects (usando meta si falta info)
  const asistenciaPeriodoFiltrada = useMemo(() => {
    const filas = asistenciaCuadrillasAll
      .filter(c => setFechas.has(c.fecha))
      .map(c => {
        const key = normCuad(c.nombre || c.cuadrillaNombre || c.cuadrillaId || c.cuadrilla);
        const meta = idxMetaCuadrilla[key] || {};
        return {
          ...c,
          _key: key,
          _nombre: c.nombre || meta.nombre || c.cuadrilla || "",
          _zona: c.zona || meta.zona || "Sin Zona",
          _region: c.region || meta.region || "",
          _tipoCuadrilla: c.tipoCuadrilla || c.tipo || meta.tipoCuadrilla || "",
          _gestor: personaDe(c.gestor || meta.gestor || ""),
          _coordinador: personaDe(c.coordinador || meta.coordinador || ""),
        };
      })
      .filter(c => {
        if (fZona && norm(c._zona) !== norm(fZona)) return false;
        if (fRegion && norm(c._region) !== norm(fRegion)) return false;
        if (fTipoCuadrilla && norm(c._tipoCuadrilla) !== norm(fTipoCuadrilla)) return false;
        if (fGestor && norm(c._gestor) !== norm(fGestor)) return false;
        if (fCoordinador && norm(c._coordinador) !== norm(fCoordinador)) return false;
        if (fCuadrilla && !norm(c._nombre).includes(norm(fCuadrilla))) return false;
        return true;
      });
    return filas;
  }, [asistenciaCuadrillasAll, setFechas, idxMetaCuadrilla, fZona, fRegion, fTipoCuadrilla, fGestor, fCoordinador, fCuadrilla, usuariosIdx]);

  // Resumen de asistencia (con técnicos y sin descanso)
  const resumenAsistencia = useMemo(() => {
    let registrosValidos = 0;
    let asistidas = 0;
    let descansos = 0;

    for (const ymd of fechasSel) {
      const cuTec = idxTecPorDia[ymd] || new Set();

      const registrosDia = asistenciaPeriodoFiltrada.filter(
        c => c.fecha === ymd && cuTec.has(c._key)
      );

      descansos += registrosDia.filter(c => (c.estado || "").toLowerCase() === "descanso").length;

      const validosDia = registrosDia.filter(c =>
        ["asistencia", "falta"].includes((c.estado || "").toLowerCase())
      );
      registrosValidos += validosDia.length;
      asistidas += validosDia.filter(c => (c.estado || "").toLowerCase() === "asistencia").length;
    }

    return { registrosValidos, asistidas, descansos };
  }, [fechasSel, idxTecPorDia, asistenciaPeriodoFiltrada]);

  const totalRegistrosSel = resumenAsistencia.registrosValidos;
  const asistidasSel = resumenAsistencia.asistidas;
  const descansosSel = resumenAsistencia.descansos;
  const pctAsistenciaSel = totalRegistrosSel > 0 ? (asistidasSel / totalRegistrosSel) * 100 : 0;

  /* =========================
     Instalaciones válidas (sin garantía) y KPIs
  ========================== */
  const instSelValidas = useMemo(
    () => instalacionesSel.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia"),
    [instalacionesSel]
  );

  // período anterior (misma lógica de asistencia sin instalaciones)
  const instalacionesPrevBase = useMemo(
    () => instalacionesAll.filter(i => setFechasPrev.has(i._fechaYMD)),
    [instalacionesAll, setFechasPrev, fechasPrev.join("|")]
  );

  const instalacionesPrevEnriq = useMemo(() => {
    return instalacionesPrevBase.map(i => {
      const _zona = i.zona || "Sin Zona";
      const _region = i.region || "";
      const _tipoCuadrilla = i.tipoCuadrilla || "";
      const _gestor = personaDe(i.gestor || i.gestorCuadrilla || i.gestorNombre || i.gestorCuadrillaNombre || "");
      const _coordinador = personaDe(i.coordinador || i.coordinadorCuadrilla || i.coordinadorNombre || i.coordinadorCuadrillaNombre || "");
      const _cuadrillaNombre = i._cuadrillaNombre || "";
      return { ...i, _zona, _region, _tipoCuadrilla, _gestor, _coordinador, _cuadrillaNombre };
    }).filter(pasaFiltroInst);
  }, [instalacionesPrevBase, usuariosIdx, fZona, fRegion, fTipoCuadrilla, fGestor, fCoordinador, fCuadrilla]);

  const instPrevValidas = useMemo(
    () => instalacionesPrevEnriq.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia"),
    [instalacionesPrevEnriq]
  );

  // meta anterior por cuadrilla
  const idxMetaPrev = useMemo(() => {
    const m = {};
    for (const i of instalacionesPrevEnriq) {
      const k = normCuad(i._cuadrillaNombre);
      if (!k) continue;
      if (!m[k]) {
        m[k] = {
          zona: i._zona, region: i._region, tipoCuadrilla: i._tipoCuadrilla,
          gestor: i._gestor, coordinador: i._coordinador, nombre: i._cuadrillaNombre,
        };
      }
    }
    return m;
  }, [instalacionesPrevEnriq]);

  // asistencia anterior con misma lógica
  const asistenciaPrevFiltrada = useMemo(() => {
    const filas = asistenciaCuadrillasAll
      .filter(c => setFechasPrev.has(c.fecha))
      .map(c => {
        const key = normCuad(c.nombre || c.cuadrillaNombre || c.cuadrillaId || c.cuadrilla);
        const meta = idxMetaPrev[key] || {};
        return {
          ...c,
          _key: key,
          _nombre: c.nombre || meta.nombre || c.cuadrilla || "",
          _zona: c.zona || meta.zona || "Sin Zona",
          _region: c.region || meta.region || "",
          _tipoCuadrilla: c.tipoCuadrilla || c.tipo || meta.tipoCuadrilla || "",
          _gestor: personaDe(c.gestor || meta.gestor || ""),
          _coordinador: personaDe(c.coordinador || meta.coordinador || ""),
        };
      })
      .filter(c => {
        if (fZona && norm(c._zona) !== norm(fZona)) return false;
        if (fRegion && norm(c._region) !== norm(fRegion)) return false;
        if (fTipoCuadrilla && norm(c._tipoCuadrilla) !== norm(fTipoCuadrilla)) return false;
        if (fGestor && norm(c._gestor) !== norm(fGestor)) return false;
        if (fCoordinador && norm(c._coordinador) !== norm(fCoordinador)) return false;
        if (fCuadrilla && !norm(c._nombre).includes(norm(fCuadrilla))) return false;
        return true;
      });
    return filas;
  }, [asistenciaCuadrillasAll, setFechasPrev, idxMetaPrev, fZona, fRegion, fTipoCuadrilla, fGestor, fCoordinador, fCuadrilla, usuariosIdx]);

  // índice técnicos anterior
  const idxTecPrevPorDia = useMemo(() => {
    const m = {};
    for (const t of asistenciaTecnicosAll) {
      const y = toYMD(t.fecha);
      if (!setFechasPrev.has(y)) continue;
      const k = normCuad(
        t.cuadrillaNombre ||
        t.cuadrilla ||
        t.nombreCuadrilla ||
        t.cuadrillaId              // <-- añadido
      );
      if (!k) continue;
      if (!m[y]) m[y] = new Set();
      m[y].add(k);
    }
    return m;
  }, [asistenciaTecnicosAll, setFechasPrev, fechasPrev.join("|")]);

  const resumenAsistenciaPrev = useMemo(() => {
    let registrosValidos = 0, asistidas = 0;
    for (const ymd of fechasPrev) {
      const cuTec = idxTecPrevPorDia[ymd] || new Set();
      const registrosDia = asistenciaPrevFiltrada.filter(
        c => c.fecha === ymd && cuTec.has(c._key)
      );
      const validosDia = registrosDia.filter(c =>
        ["asistencia", "falta"].includes((c.estado || "").toLowerCase())
      );
      registrosValidos += validosDia.length;
      asistidas += validosDia.filter(c => (c.estado || "").toLowerCase() === "asistencia").length;
    }
    return { registrosValidos, asistidas };
  }, [fechasPrev, idxTecPrevPorDia, asistenciaPrevFiltrada]);

  const pctAsistenciaPrev = resumenAsistenciaPrev.registrosValidos > 0
    ? (resumenAsistenciaPrev.asistidas / resumenAsistenciaPrev.registrosValidos) * 100
    : 0;

  /* ==== Finalizadas / Efectividad / Prod ==== */
  const finalizadasSel = useMemo(
    () => instSelValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada"),
    [instSelValidas]
  );
  const countFinalizadasSel = finalizadasSel.length;

  const finalizadasPrev = useMemo(
    () => instPrevValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada"),
    [instPrevValidas]
  );
  const countFinalizadasPrev = finalizadasPrev.length;

  const efectividadSel = instSelValidas.length > 0 ? (countFinalizadasSel / instSelValidas.length) * 100 : 0;
  const efectividadPrev = instPrevValidas.length > 0 ? (countFinalizadasPrev / instPrevValidas.length) * 100 : 0;
  const deltaEfectividad = efectividadSel - efectividadPrev;

  // productividad: finalizadas válidas / cuadrillas asistidas (sin descanso)
  const prodSel = asistidasSel > 0 ? (countFinalizadasSel / asistidasSel) : 0;
  const prodPrev = resumenAsistenciaPrev.asistidas > 0 ? (countFinalizadasPrev / resumenAsistenciaPrev.asistidas) : 0;
  const deltaProd = prodSel - prodPrev;

  /* =========================
     Tiempo de ciclo promedio (solo finalizadas válidas)
  ========================== */
  function parseFechaHora(x, ymdDefault) {
    if (!x) return null;
    if (typeof x === "string") {
      const d = dayjs(x);
      if (d.isValid()) return d;
      const hhmm = dayjs(`${ymdDefault} ${x}`);
      return hhmm.isValid() ? hhmm : null;
    }
    if (x.toDate) return dayjs(x.toDate());
    return null;
  }
  const tiemposValidos = useMemo(() => {
    const mins = [];
    for (const i of finalizadasSel) {
      const ini = parseFechaHora(i.horaInicio || i.inicio || i.horaInicioTrabajo, i._fechaYMD);
      const fin = parseFechaHora(i.horaFin || i.fin || i.horaFinTrabajo, i._fechaYMD);
      if (ini && fin && fin.isAfter(ini)) mins.push(fin.diff(ini, "minute"));
    }
    if (mins.length === 0) return { promedioMin: null, count: 0 };
    const avg = mins.reduce((s, m) => s + m, 0) / mins.length;
    return { promedioMin: avg, count: mins.length };
  }, [finalizadasSel]);

  const tiempoCicloFmt = useMemo(() => {
    if (!Number.isFinite(tiemposValidos.promedioMin)) return "—";
    const totalMin = Math.round(tiemposValidos.promedioMin);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} h`;
  }, [tiemposValidos]);

  /* =========================
     Top Zonas (por _zona) y Distribución completa (por _zona)
  ========================== */
  const topZonasData = useMemo(() => {
    const acc = {};
    for (const i of finalizadasSel) {
      const z = i._zona || "Sin Zona";
      acc[z] = (acc[z] || 0) + 1;
    }
    return Object.entries(acc)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [finalizadasSel]);

  const distZonasCompleto = useMemo(() => {
    const acc = {};
    for (const i of instSelValidas) {
      const z = i._zona || "Sin Zona";
      acc[z] = (acc[z] || 0) + 1;
    }
    return Object.entries(acc).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [instSelValidas]);

  /* =========================
     Mapa rápido (todas las instalaciones del filtro)
  ========================== */
  const puntosMapa = useMemo(() => {
    const pts = [];
    for (const i of instalacionesSel) {
      const lat = Number(i.lat ?? i.latitud ?? i.latitude ?? i?.coordenadas?.lat);
      const lng = Number(i.lng ?? i.longitud ?? i.longitude ?? i.lon ?? i?.coordenadas?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pts.push({
          lat, lng,
          estado: (i.estado || "otro").toLowerCase(),
          cliente: i.cliente || i.nombreCliente || i.codigoCliente || "",
          cuadrilla: i._cuadrillaNombre || "",
          gestor: i._gestor || "",
          coordinador: i._coordinador || "",
        });
      }
    }
    return pts;
  }, [instalacionesSel]);

  const centerMapa = useMemo(() => {
    if (puntosMapa.length === 0) return [-12.0464, -77.0428];
    const avgLat = puntosMapa.reduce((s, p) => s + p.lat, 0) / puntosMapa.length;
    const avgLng = puntosMapa.reduce((s, p) => s + p.lng, 0) / puntosMapa.length;
    return [avgLat, avgLng];
  }, [puntosMapa]);

  /* =========================
     Top Cuadrillas — Finalizadas válidas (por cuadrillaNombre)
  ========================== */
  const topCuadrillas = useMemo(() => {
    const acc = {};
    for (const i of finalizadasSel) {
      const c = i._cuadrillaNombre || "Sin Cuadrilla";
      acc[c] = (acc[c] || 0) + 1;
    }
    return Object.entries(acc)
      .map(([cuadrilla, finalizadas]) => ({ cuadrilla, finalizadas }))
      .sort((a, b) => b.finalizadas - a.finalizadas)
      .slice(0, 8);
  }, [finalizadasSel]);

  /* =========================
     Tendencia 7 días (anclada al último día del período seleccionado)
  ========================== */
  const tendencia7 = useMemo(() => {
    const arr = [];
    for (let d = 6; d >= 0; d--) {
      const ymd = dayjs(fechaRef).subtract(d, "day").format("YYYY-MM-DD");

      const instD = instalacionesAll
        .filter(i => i._fechaYMD === ymd)
        .map(i => {
          return {
            ...i,
            _zona: i.zona || "Sin Zona",
            _region: i.region || "",
            _tipoCuadrilla: i.tipoCuadrilla || "",
            _gestor: personaDe(i.gestor || i.gestorCuadrilla || i.gestorNombre || i.gestorCuadrillaNombre || ""),
            _coordinador: personaDe(i.coordinador || i.coordinadorCuadrilla || i.coordinadorNombre || i.coordinadorCuadrillaNombre || ""),
            _cuadrillaNombre: i._cuadrillaNombre || "",
          };
        })
        .filter(pasaFiltroInst);

      const instDValidas = instD.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia");
      const finD = instDValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada").length;
      const efectD = instDValidas.length > 0 ? (finD / instDValidas.length) * 100 : 0;

      // asistencia del día y % asistencia (sin descansos) con técnicos
      const tecSet = new Set(
        asistenciaTecnicosAll
          .filter(t => toYMD(t.fecha) === ymd)
          .map(t => normCuad(t.cuadrillaNombre || t.cuadrilla || t.nombreCuadrilla || t.cuadrillaId)) // <-- añadido cuadrillaId
          .filter(Boolean)
      );

      const asisDia = asistenciaCuadrillasAll
        .filter(c => c.fecha === ymd)
        .map(c => ({ ...c, _key: normCuad(c.nombre || c.cuadrillaNombre || c.cuadrillaId || c.cuadrilla) }))
        .filter(c => tecSet.has(c._key));

      const validos = asisDia.filter(c => ["asistencia", "falta"].includes((c.estado || "").toLowerCase()));
      const ok = validos.filter(c => (c.estado || "").toLowerCase() === "asistencia");
      const pctAsisD = validos.length > 0 ? (ok.length / validos.length) * 100 : 0;

      arr.push({ fecha: ymd.slice(5), pctAsistencia: Number(pctAsisD.toFixed(1)), efectividad: Number(efectD.toFixed(1)) });
    }
    return arr;
  }, [fechaRef, instalacionesAll, asistenciaCuadrillasAll, asistenciaTecnicosAll, fZona, fRegion, fTipoCuadrilla, fGestor, fCoordinador, fCuadrilla, usuariosIdx]);

  /* =========================
     Exportar Excel
  ========================== */
  const exportarXLSX = () => {
    const hoja1 = [
      ["Período", periodo.etiqueta],
      ["Tipo", rangoTipo],
      ["Zona", fZona || "Todas"],
      ["Región", fRegion || "Todas"],
      ["Tipo Cuadrilla", fTipoCuadrilla || "Todas"],
      ["Gestor", fGestor || "Todos"],
      ["Coordinador", fCoordinador || "Todos"],
      ["Cuadrilla (contiene)", fCuadrilla || "—"],
      [],
      ["KPI", "Valor", "Periodo anterior", "Δ"],
      ["Finalizadas (sin garantía)", countFinalizadasSel, countFinalizadasPrev, countFinalizadasSel - countFinalizadasPrev],
      ["Efectividad (sin garantía)", `${efectividadSel.toFixed(1)}%`, `${efectividadPrev.toFixed(1)}%`, (efectividadSel-efectividadPrev).toFixed(1)],
      ["% Asistencia (sin descansos)", `${pctAsistenciaSel.toFixed(1)}%`, `${pctAsistenciaPrev.toFixed(1)}%`, (pctAsistenciaSel - pctAsistenciaPrev).toFixed(1)],
      ["Prod. (Finalizadas/Cuadrilla asistida)", prodSel.toFixed(2), prodPrev.toFixed(2), (prodSel - prodPrev).toFixed(2)],
      ["Descansos (programados)", descansosSel, "", ""],
      ["Tiempo de ciclo promedio", tiempoCicloFmt, "", ""],
    ];

    const hoja2 = [["Zona/Distrito", "Finalizadas válidas"]];
    topZonasData.forEach(r => hoja2.push([r.name, r.value]));

    const hoja3 = [["Distribución por Zona (válidas)", "Cantidad"]];
    distZonasCompleto.forEach(r => hoja3.push([r.name, r.value]));

    const hoja4 = [["Cuadrilla (cuadrillaNombre)", "Finalizadas válidas"]];
    topCuadrillas.forEach(r => hoja4.push([r.cuadrilla, r.finalizadas]));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja1), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja2), "TopZonas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja3), "Distribución");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja4), "TopCuadrillas");
    XLSX.writeFile(wb, `dashboard_${periodo.start.format("YYYYMMDD")}_${periodo.end.format("YYYYMMDD")}.xlsx`);
  };

  /* =========================
     UI helpers
  ========================== */
  const progresoInst = Math.min(100, (countFinalizadasSel / (metaInstalaciones || 1)) * 100);
  const progresoAsis = Math.min(100, (pctAsistenciaSel / (metaPctAsistencia || 1)) * 100);
  const limpiarFiltros = () => {
    setFZona("");
    setFRegion("");
    setFTipoCuadrilla("");
    setFGestor("");
    setFCoordinador("");
    setFCuadrilla("");
  };

  const opcionesCuadrillaFiltradas = useMemo(
    () => opcionesCuadrilla.filter(q => norm(q).includes(norm(fCuadrilla))),
    [opcionesCuadrilla, fCuadrilla]
  );

  return (
    <div className="min-h-screen space-y-8 p-6 dark:bg-slate-900 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard — {periodo.etiqueta}</h1>
          {cargando && (
            <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
              </svg>
              Cargando…
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tipo de período */}
          <select
            value={rangoTipo}
            onChange={(e) => setRangoTipo(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            title="Tipo de período"
          >
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="semanas">Semanas</option>
            <option value="mes">Mes</option>
          </select>

          {/* Inputs según tipo */}
          {rangoTipo === "dia" && (
            <>
              <input
                type="date"
                value={fechaDia}
                onChange={(e) => setFechaDia(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:[color-scheme:dark]"
              />
              <button
                onClick={() => setFechaDia(hoyYMD)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                title="Ir a hoy"
              >
                Hoy
              </button>
            </>
          )}

          {rangoTipo === "semana" && (
            <input
              type="week"
              value={semana}
              onChange={(e) => setSemana(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          )}

          {rangoTipo === "semanas" && (
            <>
              <input
                type="week"
                value={semanaIni}
                onChange={(e) => setSemanaIni(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                title="Semana inicial"
              />
              <span className="text-sm text-slate-500">→</span>
              <input
                type="week"
                value={semanaFin}
                onChange={(e) => setSemanaFin(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                title="Semana final"
              />
            </>
          )}

          {rangoTipo === "mes" && (
            <input
              type="month"
              value={mesVal}
              onChange={(e) => setMesVal(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          )}

          <div className="mx-2 h-6 w-px bg-slate-300 dark:bg-slate-700" />

          <button
            onClick={exportarXLSX}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Exportar Excel
          </button>

          <label className="ml-2 inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={showAvanzado} onChange={e => setShowAvanzado(e.target.checked)} />
            <span className="text-slate-600 dark:text-slate-300">Métricas avanzadas</span>
          </label>
        </div>
      </div>

      {/* Filtros */}
      <Card
        title="Filtros"
        right={
          <button
            onClick={limpiarFiltros}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            Limpiar
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-8">
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Zona / Distrito</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fZona} onChange={(e) => setFZona(e.target.value)}>
              <option value="">Todas</option>
              {opcionesZonas.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Región</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fRegion} onChange={(e) => setFRegion(e.target.value)}>
              <option value="">Todas</option>
              {opcionesRegiones.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Tipo Cuadrilla</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fTipoCuadrilla} onChange={(e) => setFTipoCuadrilla(e.target.value)}>
              <option value="">Todas</option>
              {opcionesTipoCuadrilla.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Gestor</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fGestor} onChange={(e) => setFGestor(e.target.value)}>
              <option value="">Todos</option>
              {opcionesGestor.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Coordinador</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fCoordinador} onChange={(e) => setFCoordinador(e.target.value)}>
              <option value="">Todos</option>
              {opcionesCoordinador.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Búsqueda por cuadrilla */}
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
              Cuadrilla (buscar por <b>cuadrillaNombre</b>)
            </label>
            <input
              list="d-cuadrillas"
              className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="Escribe para filtrar…"
              value={fCuadrilla}
              onChange={(e) => setFCuadrilla(e.target.value)}
            />
            <datalist id="d-cuadrillas">
              {opcionesCuadrillaFiltradas.slice(0, 30).map(q => (
                <option key={q} value={q} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Meta Finalizadas (sin garantía)</label>
            <input type="number" min={0} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={metaInstalaciones} onChange={(e) => setMetaInstalaciones(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Meta % Asistencia</label>
            <input type="number" min={0} max={100} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={metaPctAsistencia} onChange={(e) => setMetaPctAsistencia(Number(e.target.value))} />
          </div>
        </div>

        {/* Termómetros */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-end justify-between">
              <p className="text-sm font-medium">Cumplimiento Instalaciones Finalizadas</p>
              <p className="text-xs text-slate-500">{countFinalizadasSel}/{metaInstalaciones} ({progresoInst.toFixed(0)}%)</p>
            </div>
            <div className="mt-1 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-3 rounded-full bg-sky-500 dark:bg-sky-400" style={{ width: `${progresoInst}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between">
              <p className="text-sm font-medium">Cumplimiento % Asistencia</p>
              <p className="text-xs text-slate-500">{pctAsistenciaSel.toFixed(1)}% / {metaPctAsistencia}% ({progresoAsis.toFixed(0)}%)</p>
            </div>
            <div className="mt-1 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-3 rounded-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${progresoAsis}%` }} />
            </div>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Kpi
          label="% Asistencia (cuadrillas con técnicos, sin descansos)"
          value={`${pctAsistenciaSel.toFixed(1)}%`}
          delta={pctAsistenciaSel - pctAsistenciaPrev}
          hint={`${asistidasSel}/${totalRegistrosSel || 0} cuadrillas en campo — ${descansosSel} descanso(s)`}
        />
        <Kpi
          label="Efectividad (sin garantía)"
          value={`${efectividadSel.toFixed(1)}%`}
          delta={deltaEfectividad}
          hint={`${countFinalizadasSel}/${instSelValidas.length || 0} finalizadas válidas`}
        />
        <Kpi
          label="Prod: Finalizadas/Cuadrilla asistida"
          value={prodSel.toFixed(2)}
          delta={deltaProd}
          hint="Finalizadas válidas / Cuadrillas con asistencia"
        />
        <Kpi
          label="Finalizadas (sin garantía)"
          value={countFinalizadasSel}
          delta={countFinalizadasSel - countFinalizadasPrev}
          hint={`Vs período anterior (${countFinalizadasPrev})`}
        />
        <Kpi
          label="Descansos (programados)"
          value={descansosSel}
          delta={NaN}
          hint="No cuentan para % asistencia"
        />
        <Kpi
          label="Tiempo de ciclo promedio"
          value={tiempoCicloFmt}
          delta={NaN}
          hint={tiemposValidos.count ? `${tiemposValidos.count} con hora inicio/fin` : "Sin datos de horas"}
        />
      </div>

      {/* Gráficos principales */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Top Zonas/Distritos (Finalizadas válidas)">
          {cargando ? <Skeleton rows={6} /> : topZonasData.length === 0 ? (
            <Empty title="Sin datos" desc="No hay finalizadas válidas para el período y filtros." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topZonasData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Estados de instalaciones (válidas)">
          {instSelValidas.length === 0 ? (
            <Empty title="Sin instalaciones válidas" desc="No hay registros distintos a garantía." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={(function() {
                    const acc = {};
                    instSelValidas.forEach(i => {
                      const e = (i.estado || "otro").toLowerCase();
                      acc[e] = (acc[e] || 0) + 1;
                    });
                    return Object.entries(acc).map(([k, v]) => ({ name: k, value: v }));
                  })()}
                  dataKey="value"
                  outerRadius={100}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {Object.keys((function(){const a={};instSelValidas.forEach(i=>{const e=(i.estado||"otro").toLowerCase();a[e]=(a[e]||0)+1});return a;})()).map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Tendencias y Mapa */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Tendencia 7 días — % Asistencia (sin descansos) vs Efectividad">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={tendencia7} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fecha" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pctAsistencia" name="% Asistencia" />
              <Line type="monotone" dataKey="efectividad" name="Efectividad %" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card
          title="Mapa rápido — Finalizadas / Pendientes / Reprogramadas"
          right={<span className="text-xs text-slate-500 dark:text-slate-400">{puntosMapa.length} puntos</span>}
        >
          {puntosMapa.length === 0 ? (
            <Empty title="Sin coordenadas" desc="No se encontraron instalaciones con lat/lng." />
          ) : (
            <MapInstalaciones points={puntosMapa} center={centerMapa} zoom={12} />
          )}
        </Card>
      </div>

      {/* Distribución & Detalle rápido */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Distribución por Zona/Distrito (Instalaciones válidas)">
          {distZonasCompleto.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={distZonasCompleto} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-20} textAnchor="end" height={50} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Detalle rápido */}
        <Card title="Detalle rápido — Instalaciones (Estado / Distrito) — SIN garantía">
          {instSelValidas.length === 0 ? (
            <Empty />
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left">Distrito</th>
                  </tr>
                </thead>
                <tbody>
                  {instSelValidas.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-3 py-2">{i.cliente || i.codigoCliente || i.id}</td>
                      <td className="px-3 py-2 capitalize">{(i.estado || "—").toLowerCase()}</td>
                      <td className="px-3 py-2">{i._zona || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Top Cuadrillas — Finalizadas válidas (período)">
          {topCuadrillas.length === 0 ? (
            <Empty title="Sin datos de cuadrillas" />
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Cuadrilla</th>
                    <th className="px-3 py-2 text-right">Finalizadas</th>
                  </tr>
                </thead>
                <tbody>
                  {topCuadrillas.map((r) => (
                    <tr key={r.cuadrilla} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-3 py-2">{r.cuadrilla}</td>
                      <td className="px-3 py-2 text-right">{r.finalizadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Avanzado */}
      {showAvanzado && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Tabla rápida — Instalaciones (filtro aplicado) — SIN garantía">
            {instSelValidas.length === 0 ? (
              <Empty />
            ) : (
              <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <tr>
                      <th className="px-2 py-2 text-left">Cliente</th>
                      <th className="px-2 py-2 text-left">Estado</th>
                      <th className="px-2 py-2 text-left">Plan</th>
                      <th className="px-2 py-2 text-left">Zona</th>
                      <th className="px-2 py-2 text-left">Región</th>
                      <th className="px-2 py-2 text-left">ZonaCuadrilla</th>
                      <th className="px-2 py-2 text-left">Tipo Cuadrilla</th>
                      <th className="px-2 py-2 text-left">Cuadrilla</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instSelValidas.map((i) => (
                      <tr key={i.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-2 py-2">{i.cliente || i.codigoCliente || i.id}</td>
                        <td className="px-2 py-2">{(i.estado || "").toLowerCase()}</td>
                        <td className="px-2 py-2">{i.plan || i.planServicio || i.tipoInstalacion || i.tipoInstalación || "—"}</td>
                        <td className="px-2 py-2">{i._zona || "—"}</td>
                        <td className="px-2 py-2">{i._region || "—"}</td>
                        <td className="px-2 py-2">{i.zonaCuadrilla || "—"}</td>
                        <td className="px-2 py-2">{i._tipoCuadrilla || "—"}</td>
                        <td className="px-2 py-2">{i._cuadrillaNombre || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
