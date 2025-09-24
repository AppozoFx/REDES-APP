// src/app/(private)/garantias/dashboard/page.js
"use client";

/* ============================================================================
   DASHBOARD — GARANTÍAS
   - UI/flow alineado al dashboard base
   - Métrica principal: % de Garantías por Cuadrilla = G / I
     (G: garantías, I: finalizadas válidas sin garantía)
   - Cortes por casoGarantia, responsableGarantia, imputadoGarantia
   - Tabla avanzada con todas las columnas solicitadas
   - Exportar a XLSX
============================================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import dayjs from "dayjs";
import durationPlugin from "dayjs/plugin/duration";
import dynamic from "next/dynamic";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import "leaflet/dist/leaflet.css";

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

/* =========================
   Mapa (React-Leaflet)
========================= */
const MapGarantias = dynamic(
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
              p.estado === "pendiente" || p.estado === "abierta" ? "#f43f5e" :
              p.estado === "en_proceso" ? "#f59e0b" :
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

/* ============================================================================
   PÁGINA
============================================================================ */
export default function DashboardGarantias() {
  /* --------- Fecha / Período --------- */
  const [rangoTipo, setRangoTipo] = useState("dia"); // dia | semana | semanas | mes
  const hoyYMD = dayjs().format("YYYY-MM-DD");
  const [fechaDia, setFechaDia] = useState(hoyYMD);
  const [semana, setSemana] = useState(dayjs().format("YYYY-[W]WW"));
  const [semanaIni, setSemanaIni] = useState(dayjs().format("YYYY-[W]WW"));
  const [semanaFin, setSemanaFin] = useState(dayjs().format("YYYY-[W]WW"));
  const [mesVal, setMesVal] = useState(dayjs().format("YYYY-MM"));

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
    let start, end;
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
    return { start, end, etiqueta: `${start.format("YYYY-MM-DD")} — ${end.format("YYYY-MM-DD")}` };
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
    let d = p.start.startOf("day");
    const end = p.end.startOf("day");
    while (d.isSame(end) || d.isBefore(end)) {
      out.push(d.format("YYYY-MM-DD"));
      d = d.add(1, "day");
    }
    return out;
  };
  const fechasSel = useMemo(() => fechasDe(periodo), [periodo]);
  const fechasPrev = useMemo(() => fechasDe(periodoPrev), [periodoPrev]);
  const setFechas = new Set(fechasSel);
  const setFechasPrev = new Set(fechasPrev);

  /* --------- Datos base --------- */
  const [cargando, setCargando] = useState(false);
  const [instalacionesAll, setInstalacionesAll] = useState([]);
  const montado = useRef(true);

  const norm = (v) => String(v ?? "").toLowerCase().trim();
  const normCuad = (v) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/^c_/, "")
      .replace(/[\W_]+/g, " ")
      .trim();

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  // Carga de instalaciones
  useEffect(() => {
    (async () => {
      try {
        setCargando(true);
        const snapI = await getDocs(collection(db, "instalaciones"));
        const data = snapI.docs.map((d) => {
          const raw = d.data();
          const _fechaInstYMD =
            typeof raw.fechaInstalacion === "string"
              ? dayjs(raw.fechaInstalacion).format("YYYY-MM-DD")
              : raw.fechaInstalacion?.toDate
              ? dayjs(raw.fechaInstalacion.toDate()).format("YYYY-MM-DD")
              : "";
          const _fechaCreadoYMD =
            typeof raw.creadoEn === "string"
              ? dayjs(raw.creadoEn).format("YYYY-MM-DD")
              : raw.creadoEn?.toDate
              ? dayjs(raw.creadoEn.toDate()).format("YYYY-MM-DD")
              : "";

          const _cuadrillaNombre = raw.cuadrillaNombre || raw.cuadrilla || "";
          const _zona = raw.zona || "Sin Zona";
          const _region = raw.region || "";
          const _tipoCuadrilla = raw.tipoCuadrilla || "";
          const _rc = raw.residencialCondominio || raw.residencial || raw.condominio || "";
          const _gestor = raw.gestorCuadrilla || raw.gestor || "";
          const _coordinador =
  raw.coordinadorCuadrillaNombre ||
  raw.coordinadorNombre ||
  raw.coordinador ||
  raw.coordinadorCuadrilla ||  // si sólo llega UID, se verá tal cual
  "";


          return {
            id: d.id,
            ...raw,
            _fechaInstYMD,
            _fechaCreadoYMD,
            _cuadrillaNombre,
            _zona,
            _region,
            _tipoCuadrilla,
            _rc,
            _gestor,
            _coordinador,
          };
        });
        if (!montado.current) return;
        setInstalacionesAll(data);
      } catch (err) {
        console.warn("Error cargando instalaciones:", err?.code || err?.message);
        if (!montado.current) return;
        setInstalacionesAll([]);
      } finally {
        if (montado.current) setCargando(false);
      }
    })();
  }, []);

  /* =========================
     FILTROS
  ========================== */
  const [fRC, setFRC] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fTipoCuadrilla, setFTipoCuadrilla] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fCoordinador, setFCoordinador] = useState("");
  const [fCuadrilla, setFCuadrilla] = useState("");

  const [fResponsable, setFResponsable] = useState("");
  const [fImputado, setFImputado] = useState("");
  const [fCaso, setFCaso] = useState("");

  const opcionesFrom = (arr, key) => {
    const m = new Map();
    for (const i of arr) {
      const label = (i[key] || "").toString();
      const k = norm(label);
      if (k) m.set(k, i[key]);
    }
    return Array.from(m.values()).sort((a, b) => String(a).localeCompare(String(b)));
  };

  // Base del período
  const garantiasPeriodoBase = useMemo(
    () => instalacionesAll.filter(i => setFechas.has(i._fechaCreadoYMD) && norm(i.tipoServicio) === "garantia"),
    [instalacionesAll, setFechas, fechasSel.join("|")]
  );

  const instalacionesValidasPeriodoBase = useMemo(
    () => instalacionesAll.filter(i => setFechas.has(i._fechaInstYMD) && norm(i.tipoServicio) !== "garantia" && norm(i.estado) === "finalizada"),
    [instalacionesAll, setFechas, fechasSel.join("|")]
  );

  // Opciones para selects (desde garantías del período)
  const opcionesRC = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i._rc })), "v"), [garantiasPeriodoBase]);
  const opcionesRegiones = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i._region })), "v"), [garantiasPeriodoBase]);
  const opcionesTipoCuadrilla = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i._tipoCuadrilla })), "v"), [garantiasPeriodoBase]);

  const opcionesCoordinador = useMemo(
  () => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i._coordinador })), "v"),
  [garantiasPeriodoBase]
);

  const opcionesCuadrilla = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i._cuadrillaNombre })), "v"), [garantiasPeriodoBase]);
const opcionesEstado = useMemo(
  () => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i.estado })), "v"),
  [garantiasPeriodoBase]
);

  const opcionesResponsable = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i.responsableGarantia })), "v"), [garantiasPeriodoBase]);
  const opcionesImputado = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i.imputadoGarantia })), "v"), [garantiasPeriodoBase]);
  const opcionesCaso = useMemo(() => opcionesFrom(garantiasPeriodoBase.map(i => ({ v: i.casoGarantia })), "v"), [garantiasPeriodoBase]);

  // Filtros
  const pasaFiltroGarantia = (i) => {
  if (fRC && norm(i._rc) !== norm(fRC)) return false;
  if (fRegion && norm(i._region) !== norm(fRegion)) return false;
  if (fTipoCuadrilla && norm(i._tipoCuadrilla) !== norm(fTipoCuadrilla)) return false;
  if (fEstado && norm(i.estado) !== norm(fEstado)) return false;                 // <— nuevo
  if (fCoordinador && norm(i._coordinador) !== norm(fCoordinador)) return false;
  if (fCuadrilla && !norm(i._cuadrillaNombre).includes(norm(fCuadrilla))) return false;

  if (fResponsable && norm(i.responsableGarantia) !== norm(fResponsable)) return false;
  if (fImputado && norm(i.imputadoGarantia) !== norm(fImputado)) return false;
  if (fCaso && norm(i.casoGarantia) !== norm(fCaso)) return false;

  return true;
};

  const pasaFiltroInstValida = (i) => {
  if (fRC && norm(i._rc) !== norm(fRC)) return false;
  if (fRegion && norm(i._region) !== norm(fRegion)) return false;
  if (fTipoCuadrilla && norm(i._tipoCuadrilla) !== norm(fTipoCuadrilla)) return false;
  if (fEstado && norm(i.estado) !== norm(fEstado)) return false;                 // <— nuevo
  if (fCoordinador && norm(i._coordinador) !== norm(fCoordinador)) return false;
  if (fCuadrilla && !norm(i._cuadrillaNombre).includes(norm(fCuadrilla))) return false;
  return true;
};

  const garantiasSel = useMemo(
  () => garantiasPeriodoBase.filter(pasaFiltroGarantia),
  [garantiasPeriodoBase, fRC, fRegion, fTipoCuadrilla, fEstado, fCoordinador, fCuadrilla, fResponsable, fImputado, fCaso]
);

  const instalacionesValidasSel = useMemo(
  () => instalacionesValidasPeriodoBase.filter(pasaFiltroInstValida),
  [instalacionesValidasPeriodoBase, fRC, fRegion, fTipoCuadrilla, fEstado, fCoordinador, fCuadrilla]
);

  /* =========================
     % Garantías por Cuadrilla (barras VERTICALES)
  ========================== */
  const pctGarantiasPorCuadrilla = useMemo(() => {
    // Numerador: garantías por cuadrilla
    const num = {};
    for (const g of garantiasSel) {
      const c = g._cuadrillaNombre || "Sin Cuadrilla";
      num[c] = (num[c] || 0) + 1;
    }
    // Denominador: finalizadas válidas por cuadrilla
    const den = {};
    for (const i of instalacionesValidasSel) {
      const c = i._cuadrillaNombre || "Sin Cuadrilla";
      den[c] = (den[c] || 0) + 1;
    }
    const out = [];
    const allKeys = new Set([...Object.keys(num), ...Object.keys(den)]);
    for (const c of allKeys) {
      const G = num[c] || 0;
      const I = den[c] || 0;
      const pct = I > 0 ? (G / I) * 100 : 0;
      out.push({ cuadrilla: c, garantias: G, finalizadas: I, pct: Number(pct.toFixed(1)) });
    }
    return out.sort((a, b) => b.pct - a.pct);
  }, [garantiasSel, instalacionesValidasSel]);

  /* =========================
     Cuadrillas con 0% de Garantías (G=0 / I>0)
     (⚠️ debe declararse DESPUÉS de pctGarantiasPorCuadrilla)
  ========================== */
  const cuadrillasCeroPct = useMemo(() => {
    return pctGarantiasPorCuadrilla
      .filter(r => r.finalizadas > 0 && r.garantias === 0)
      .sort((a, b) => b.finalizadas - a.finalizadas);
  }, [pctGarantiasPorCuadrilla]);

  /* =========================
     Distribuciones (caso, responsable, imputado)
  ========================== */
  const distFromField = (arr, field) => {
    const acc = {};
    for (const x of arr) {
      const k = (x[field] || "Sin dato").toString();
      acc[k] = (acc[k] || 0) + 1;
    }
    return Object.entries(acc)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  };

  const distCaso = useMemo(() => distFromField(garantiasSel, "casoGarantia"), [garantiasSel]);
  const distResponsable = useMemo(() => distFromField(garantiasSel, "responsableGarantia"), [garantiasSel]);
  const distImputado = useMemo(() => distFromField(garantiasSel, "imputadoGarantia"), [garantiasSel]);

  /* =========================
     KPIs periodo vs anterior
  ========================== */
  const garantiasPrev = useMemo(
  () => instalacionesAll
        .filter(i => setFechasPrev.has(i._fechaCreadoYMD) && norm(i.tipoServicio) === "garantia")
        .filter(pasaFiltroGarantia),
  [instalacionesAll, setFechasPrev, fechasPrev.join("|"), fRC, fRegion, fTipoCuadrilla, fEstado, fCoordinador, fCuadrilla, fResponsable, fImputado, fCaso]
);
  const instalacionesValidasPrev = useMemo(
  () => instalacionesAll
        .filter(i => setFechasPrev.has(i._fechaInstYMD) && norm(i.tipoServicio) !== "garantia" && norm(i.estado) === "finalizada")
        .filter(pasaFiltroInstValida),
  [instalacionesAll, setFechasPrev, fechasPrev.join("|"), fRC, fRegion, fTipoCuadrilla, fEstado, fCoordinador, fCuadrilla]
);

  const totalGarantias = garantiasSel.length;
  const totalValidas = instalacionesValidasSel.length;
  const tasaGarantiasSel = totalValidas > 0 ? (totalGarantias / totalValidas) * 100 : 0;

  const totalGarantiasPrev = garantiasPrev.length;
  const totalValidasPrev = instalacionesValidasPrev.length;
  const tasaGarantiasPrev = totalValidasPrev > 0 ? (totalGarantiasPrev / totalValidasPrev) * 100 : 0;

  /* =========================
     Tendencia (aperturas de garantías por día)
  ========================== */
  const tendenciaGarantias = useMemo(() => {
    const idx = Object.fromEntries(fechasSel.map(f => [f.slice(5), 0])); // MM-DD -> 0
    for (const g of garantiasSel) {
      const k = (g._fechaCreadoYMD || "").slice(5);
      if (k in idx) idx[k] += 1;
    }
    return Object.entries(idx).map(([fecha, value]) => ({ fecha, value }));
  }, [garantiasSel, fechasSel.join("|")]);

  /* =========================
     Mapa
  ========================== */
  const puntosMapa = useMemo(() => {
    const pts = [];
    for (const g of garantiasSel) {
      const lat = Number(g?.coordenadas?.lat ?? g.lat ?? g.latitud);
      const lng = Number(g?.coordenadas?.lng ?? g.lng ?? g.longitud);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pts.push({
          lat, lng,
          estado: (g.estado || "otro").toLowerCase(),
          cliente: g.cliente || g.codigoCliente || g.id,
          cuadrilla: g._cuadrillaNombre || "",
          gestor: g._gestor || "",
          coordinador: g._coordinador || "",
        });
      }
    }
    return pts;
  }, [garantiasSel]);

  const centerMapa = useMemo(() => {
    if (puntosMapa.length === 0) return [-12.0464, -77.0428];
    const avgLat = puntosMapa.reduce((s, p) => s + p.lat, 0) / puntosMapa.length;
    const avgLng = puntosMapa.reduce((s, p) => s + p.lng, 0) / puntosMapa.length;
    return [avgLat, avgLng];
  }, [puntosMapa]);

  /* =========================
     Tabla avanzada
  ========================== */
  const parseFechaHora = (x, ymdDefault) => {
    if (!x) return null;
    if (typeof x === "string") {
      if (/^\d{1,2}:\d{2}$/.test(x)) {
        const hhmm = dayjs(`${ymdDefault} ${x}`);
        return hhmm.isValid() ? hhmm : null;
      }
      const d = dayjs(x);
      return d.isValid() ? d : null;
    }
    if (x?.toDate) return dayjs(x.toDate());
    return null;
  };

  const fmtDuracionHM = (ini, fin) => {
    if (!ini || !fin || !fin.isAfter(ini)) return "—";
    const mins = fin.diff(ini, "minute");
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h} h${m ? ` ${m} min` : ""}`;
    return `${m} min`;
  };

  const detalleGarantias = useMemo(() => {
    return garantiasSel.map((g) => {
      const ymdGar = g._fechaCreadoYMD || g._fechaInstYMD || "";
      const ymdInst = g._fechaInstYMD || "";
      const ini = parseFechaHora(g.horaInicio || g.inicio, ymdGar);
      const fin = parseFechaHora(g.horaFin || g.fin, ymdGar);
      const dur = fmtDuracionHM(ini, fin);

      let dias = Number(g.diasDesdeInstalacion);
      if (!Number.isFinite(dias)) {
        if (ymdInst && ymdGar) {
          dias = dayjs(ymdGar).diff(dayjs(ymdInst), "day");
        } else {
          dias = null;
        }
      }
      return {
        id: g.id,
        fGarantia: ymdGar || "—",
        estado: g.estado || "—",
        cliente: g.cliente || "—",
        codigoCliente: g.codigoCliente || "—",
        fInstalacion: ymdInst || "—",
        dias: Number.isFinite(dias) ? dias : "—",
        plan: g.plan || "—",
        direccion: g.direccion || "—",
        cuadrilla: g._cuadrillaNombre || "—",
        tipoServicio: g.tipoServicio || "—",
        tramo: g.tramo || "—",
        hInicio: ini ? ini.format("HH:mm") : "—",
        hFin: fin ? fin.format("HH:mm") : "—",
        duracion: dur,
        motivo: g.motivoGarantia || "—",
        diagnostico: g.diagnosticoGarantia || "—",
        solucion: g.solucionGarantia || "—",
        caso: g.casoGarantia || "—",
        imputado: g.imputadoGarantia || "—",
      };
    }).sort((a, b) => String(a.fGarantia).localeCompare(String(b.fGarantia)));
  }, [garantiasSel]);

  /* =========================
     Exportar a Excel
  ========================== */
  const exportarXLSX = () => {
    const hoja1 = [
      ["Período", periodo.etiqueta],
      ["Tipo", rangoTipo],
      ["R/C", fRC || "Todos"],
      ["Región", fRegion || "Todas"],
      ["Tipo Cuadrilla", fTipoCuadrilla || "Todas"],
      ["Gestor", fGestor || "Todos"],
      ["Coordinador", fCoordinador || "Todos"],
      ["Cuadrilla (contiene)", fCuadrilla || "—"],
      ["Responsable", fResponsable || "Todos"],
      ["Imputado", fImputado || "Todos"],
      ["Caso", fCaso || "Todos"],
      [],
      ["KPI", "Actual", "Anterior", "Δ"],
      ["Garantías (N)", totalGarantias, totalGarantiasPrev, totalGarantias - totalGarantiasPrev],
      ["Finalizadas válidas (N)", totalValidas, totalValidasPrev, totalValidas - totalValidasPrev],
      ["Tasa de Garantías (%)", Number(tasaGarantiasSel.toFixed(1)), Number(tasaGarantiasPrev.toFixed(1)), Number((tasaGarantiasSel - tasaGarantiasPrev).toFixed(1))],
    ];

    const hoja2 = [["Cuadrilla", "Garantías (G)", "Finalizadas válidas (I)", "% G/I"]];
    pctGarantiasPorCuadrilla.forEach(r => hoja2.push([r.cuadrilla, r.garantias, r.finalizadas, r.pct]));

    const hoja3 = [["Caso Garantía", "Cantidad"]];
    distCaso.forEach(r => hoja3.push([r.name, r.value]));

    const hoja4 = [["Responsable Garantía", "Cantidad"]];
    distResponsable.forEach(r => hoja4.push([r.name, r.value]));

    const hoja5 = [["Imputado Garantía", "Cantidad"]];
    distImputado.forEach(r => hoja5.push([r.name, r.value]));

    const headersDetalle = [
      "F. Garantía","Estado","Cliente","Código Cliente","F. Instalación","Días","Plan","Dirección",
      "Cuadrilla","Tipo Servicio","Tramo","H. Inicio","H. Fin","Duración",
      "Motivo","Diagnóstico","Solución","Caso","Imputado"
    ];
    const hoja6 = [headersDetalle];
    detalleGarantias.forEach(r => {
      hoja6.push([
        r.fGarantia, r.estado, r.cliente, r.codigoCliente, r.fInstalacion, r.dias, r.plan, r.direccion,
        r.cuadrilla, r.tipoServicio, r.tramo, r.hInicio, r.hFin, r.duracion,
        r.motivo, r.diagnostico, r.solucion, r.caso, r.imputado
      ]);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja1), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja2), "% por Cuadrilla");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja3), "Caso");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja4), "Responsable");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja5), "Imputado");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja6), "Detalle");
    XLSX.writeFile(wb, `garantias_${periodo.start.format("YYYYMMDD")}_${periodo.end.format("YYYYMMDD")}.xlsx`);
  };

  /* =========================
     UI helpers
  ========================== */
  const limpiarFiltros = () => {
  setFRC(""); setFRegion(""); setFTipoCuadrilla("");
  setFEstado("");                     // <— nuevo
  setFCoordinador(""); setFCuadrilla("");
  setFResponsable(""); setFImputado(""); setFCaso("");
};


  const opcionesCuadrillaFiltradas = useMemo(
    () => opcionesCuadrilla.filter(q => norm(q).includes(norm(fCuadrilla))),
    [opcionesCuadrilla, fCuadrilla]
  );

  /* =========================
     Render
  ========================== */
  return (
    <div className="min-h-screen space-y-8 p-6 dark:bg-slate-900 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard de Garantías — {periodo.etiqueta}</h1>
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-9">
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">(Residencial / Condominio)</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fRC} onChange={(e) => setFRC(e.target.value)}>
              <option value="">Todos</option>
              {opcionesRC.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Región</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fRegion} onChange={(e) => setFRegion(e.target.value)}>
              <option value="">Todas</option>
              {opcionesRegiones.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Tipo Cuadrilla</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fTipoCuadrilla} onChange={(e) => setFTipoCuadrilla(e.target.value)}>
              <option value="">Todas</option>
              {opcionesTipoCuadrilla.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Estado</label>
  <select
    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
    value={fEstado}
    onChange={(e) => setFEstado(e.target.value)}
  >
    <option value="">Todos</option>
    {opcionesEstado.map(v => <option key={v} value={v}>{v}</option>)}
  </select>
</div>

          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Coordinador</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fCoordinador} onChange={(e) => setFCoordinador(e.target.value)}>
              <option value="">Todos</option>
              {opcionesCoordinador.map(v => <option key={v} value={v}>{v}</option>)}
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

          {/* Nuevos filtros */}
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Responsable</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fResponsable} onChange={(e) => setFResponsable(e.target.value)}>
              <option value="">Todos</option>
              {opcionesResponsable.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Imputado</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fImputado} onChange={(e) => setFImputado(e.target.value)}>
              <option value="">Todos</option>
              {opcionesImputado.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Caso</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fCaso} onChange={(e) => setFCaso(e.target.value)}>
              <option value="">Todos</option>
              {opcionesCaso.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Garantías (N)"
          value={totalGarantias}
          delta={totalGarantias - totalGarantiasPrev}
          hint={`Vs período anterior (${totalGarantiasPrev})`}
        />
        <Kpi
          label="Finalizadas válidas (N)"
          value={totalValidas}
          delta={totalValidas - totalValidasPrev}
          hint={`Vs período anterior (${totalValidasPrev})`}
        />
        <Kpi
          label="Tasa de Garantías (G/I)"
          value={`${tasaGarantiasSel.toFixed(1)}%`}
          delta={tasaGarantiasSel - tasaGarantiasPrev}
          hint={`${totalGarantias}/${totalValidas || 0} — prev ${tasaGarantiasPrev.toFixed(1)}%`}
        />
        <Kpi
          label="Top Caso (participación)"
          value={distCaso[0] ? `${distCaso[0].name}` : "—"}
          delta={NaN}
          hint={distCaso[0] ? `${distCaso[0].value} casos` : "Sin datos"}
        />
        <Kpi
          label="Top Responsable"
          value={distResponsable[0] ? `${distResponsable[0].name}` : "—"}
          delta={NaN}
          hint={distResponsable[0] ? `${distResponsable[0].value} casos` : "Sin datos"}
        />
        <Kpi
          label="Top Imputado"
          value={distImputado[0] ? `${distImputado[0].name}` : "—"}
          delta={NaN}
          hint={distImputado[0] ? `${distImputado[0].value} casos` : "Sin datos"}
        />
      </div>

      {/* Barras verticales % por Cuadrilla */}
      <Card title="% de Garantías por Cuadrilla (G / I)">
        {pctGarantiasPorCuadrilla.length === 0 ? (
          <Empty title="Sin datos" desc="No hay garantías o finalizadas válidas para el período/filtros." />
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <BarChart
              data={pctGarantiasPorCuadrilla}
              margin={{ top: 8, right: 16, left: 0, bottom: 56 }}
              barCategoryGap="22%"
              barGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="cuadrilla"
                interval={0}
                angle={-28}
                textAnchor="end"
                height={60}
              />
              <YAxis
                type="number"
                domain={[0, "dataMax"]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                formatter={(_, __, props) => {
                  const { pct, garantias, finalizadas } = props.payload || {};
                  return [
                    `% Garantías: ${pct}% (G: ${garantias} / I: ${finalizadas})`,
                    ""
                  ];
                }}
              />
              <Legend />
              <Bar
                dataKey="pct"
                name="% Garantías"
                fill="#10b981"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Distribuciones y 0% */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Distribución por Caso de Garantía">
          {distCaso.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={distCaso} dataKey="value" outerRadius={110} label={({ name, value }) => `${name}: ${value}`}>
                  {distCaso.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Distribución por Responsable */}
        <Card title="Distribución por Responsable">
          {distResponsable.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distResponsable} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-20} textAnchor="end" height={50} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(v) => [v, "Casos"]} />
                <Legend />
                <Bar dataKey="value" name="Casos" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Distribución por Imputado */}
        <Card title="Distribución por Imputado">
          {distImputado.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distImputado} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-20} textAnchor="end" height={50} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(v) => [v, "Casos"]} />
                <Legend />
                <Bar dataKey="value" name="Casos" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* 0% Garantías */}
        <Card title="Cuadrillas con 0% de Garantías (G=0 / I>0)">
          {cuadrillasCeroPct.length === 0 ? (
            <Empty title="Sin cuadrillas con 0%" desc="No hay cuadrillas con G=0 e I>0 para los filtros." />
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart
                data={cuadrillasCeroPct}
                margin={{ top: 8, right: 16, left: 0, bottom: 56 }}
                barCategoryGap="22%"
                barGap={4}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="cuadrilla" interval={0} angle={-28} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} />
                <Tooltip
                  formatter={(_, __, props) => {
                    const { garantias, finalizadas } = props.payload || {};
                    return [`G: ${garantias} / I: ${finalizadas} — 0%`, ""];
                  }}
                />
                <Legend />
                <Bar dataKey="finalizadas" name="Instalaciones válidas (I)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Tendencia y Mapa */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Tendencia — Aperturas de Garantía (por día)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={tendenciaGarantias} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fecha" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="value" name="Garantías" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Mapa rápido — Garantías" right={<span className="text-xs text-slate-500 dark:text-slate-400">{puntosMapa.length} puntos</span>}>
          {puntosMapa.length === 0 ? (
            <Empty title="Sin coordenadas" desc="No se encontraron garantías con lat/lng." />
          ) : (
            <MapGarantias points={puntosMapa} center={centerMapa} zoom={12} />
          )}
        </Card>
      </div>

      {/* Tabla avanzada */}
      <Card title="Métricas avanzadas — Detalle de Garantías">
        {detalleGarantias.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  <th className="px-2 py-2 text-left">F. Garantía</th>
                  <th className="px-2 py-2 text-left">Estado</th>
                  <th className="px-2 py-2 text-left">Cliente</th>
                  <th className="px-2 py-2 text-left">Código Cliente</th>
                  <th className="px-2 py-2 text-left">F. Instalación</th>
                  <th className="px-2 py-2 text-right">Días</th>
                  <th className="px-2 py-2 text-left">Plan</th>
                  <th className="px-2 py-2 text-left">Dirección</th>
                  <th className="px-2 py-2 text-left">Cuadrilla</th>
                  <th className="px-2 py-2 text-left">Tipo Servicio</th>
                  <th className="px-2 py-2 text-left">Tramo</th>
                  <th className="px-2 py-2 text-left">H. Inicio</th>
                  <th className="px-2 py-2 text-left">H. Fin</th>
                  <th className="px-2 py-2 text-left">Duración</th>
                  <th className="px-2 py-2 text-left">Motivo</th>
                  <th className="px-2 py-2 text-left">Diagnóstico</th>
                  <th className="px-2 py-2 text-left">Solución</th>
                  <th className="px-2 py-2 text-left">Caso</th>
                  <th className="px-2 py-2 text-left">Imputado</th>
                </tr>
              </thead>
              <tbody>
                {detalleGarantias.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2">{r.fGarantia}</td>
                    <td className="px-2 py-2 capitalize">{String(r.estado).toLowerCase()}</td>
                    <td className="px-2 py-2">{r.cliente}</td>
                    <td className="px-2 py-2">{r.codigoCliente}</td>
                    <td className="px-2 py-2">{r.fInstalacion}</td>
                    <td className="px-2 py-2 text-right">{r.dias}</td>
                    <td className="px-2 py-2">{r.plan}</td>
                    <td className="px-2 py-2">{r.direccion}</td>
                    <td className="px-2 py-2">{r.cuadrilla}</td>
                    <td className="px-2 py-2">{r.tipoServicio}</td>
                    <td className="px-2 py-2">{r.tramo}</td>
                    <td className="px-2 py-2">{r.hInicio}</td>
                    <td className="px-2 py-2">{r.hFin}</td>
                    <td className="px-2 py-2">{r.duracion}</td>
                    <td className="px-2 py-2">{r.motivo}</td>
                    <td className="px-2 py-2">{r.diagnostico}</td>
                    <td className="px-2 py-2">{r.solucion}</td>
                    <td className="px-2 py-2">{r.caso}</td>
                    <td className="px-2 py-2">{r.imputado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
