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

  // completa lo escrito con la primera coincidencia (exacta o parcial)
const completarCuadrilla = () => {
  const q = norm(qCuadrilla);
  if (!q) { setFCuadrilla(""); return; }
  const exact = opcionesCuadrilla.find(o => norm(o) === q);
  const parcial = opcionesCuadrilla.find(o => norm(o).includes(q));
  const pick = exact || parcial || "";
  setQCuadrilla(pick);
  setFCuadrilla(pick);
};

  const { user, initializing } = useAuth();

  const [fecha, setFecha] = useState(dayjs().format("YYYY-MM-DD"));
  const fechaAyer = useMemo(() => dayjs(fecha).subtract(1, "day").format("YYYY-MM-DD"), [fecha]);

  const [cargando, setCargando] = useState(false);
  const montado = useRef(true);

  // datasets
  const [asistenciaCuadrillasAll, setAsistenciaCuadrillasAll] = useState([]);
  const [asistenciaTecnicosAll, setAsistenciaTecnicosAll] = useState([]);
  const [instalacionesAll, setInstalacionesAll] = useState([]);
  const [usuariosIdx, setUsuariosIdx] = useState({}); // uid -> datos usuario

  // filtros (basados en instalaciones)
  const [fZona, setFZona] = useState("");
  const [fGestor, setFGestor] = useState("");
  const [fCoordinador, setFCoordinador] = useState("");
  const [fCuadrilla, setFCuadrilla] = useState(""); // cuadrillaNombre
  const [qCuadrilla, setQCuadrilla] = useState(""); // <-- buscador de cuadrilla

  // metas
  const [metaInstalaciones, setMetaInstalaciones] = useState(100);
  const [metaPctAsistencia, setMetaPctAsistencia] = useState(85);

  const [showAvanzado, setShowAvanzado] = useState(false);

  // --- utils de normalización ---
  const norm = (v) => String(v ?? "").toLowerCase().trim();

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

        // usuarios (para traducir UID -> nombre)
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

  // traductor UID -> nombre visible (si no existe en índice, devuelve el valor tal cual)
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

  /* =========================
     Base de HOY (instalaciones)
  ========================== */
  const instalacionesHoyBase = useMemo(
    () => instalacionesAll.filter(i => i._fechaYMD === fecha),
    [instalacionesAll, fecha]
  );

  // Índice asistencia por nombre de cuadrilla (normalizado)
  const asistenciaHoyBase = useMemo(
    () => asistenciaCuadrillasAll.filter(c => c.fecha === fecha),
    [asistenciaCuadrillasAll, fecha]
  );
  const idxAsistenciaByNombre = useMemo(() => {
    const idx = {};
    for (const c of asistenciaHoyBase) {
      const k = norm(c?.nombre);
      if (k) idx[k] = c;
    }
    return idx;
  }, [asistenciaHoyBase]);

  // Enriquecer instalaciones con zona/gestor/coordinador (si faltan) traduciendo UID->nombre
  const instalacionesHoyEnriquecidas = useMemo(() => {
    return instalacionesHoyBase.map(i => {
      const key  = norm(i._cuadrillaNombre);
      const meta = key && idxAsistenciaByNombre[key] ? idxAsistenciaByNombre[key] : {};

      const _zona = i.zona || meta.zona || "Sin Zona";

      const _gestor = personaDe(
        i.gestor ||
        i.gestorCuadrilla ||
        i.gestorNombre ||
        i.gestorCuadrillaNombre ||
        meta.gestor ||
        meta.gestorNombre ||
        ""
      );

      const _coordinador = personaDe(
        i.coordinador ||
        i.coordinadorCuadrilla ||
        i.coordinadorNombre ||
        i.coordinadorCuadrillaNombre ||
        meta.coordinador ||
        meta.coordinadorNombre ||
        ""
      );

      const _cuadrillaNombre = i._cuadrillaNombre || meta.nombre || "";

      return { ...i, _zona, _gestor, _coordinador, _cuadrillaNombre };
    });
  }, [instalacionesHoyBase, idxAsistenciaByNombre, usuariosIdx]);

  /* =========================
     Filtros (derivados de instalaciones)
  ========================== */
  const opcionesZonas = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesHoyEnriquecidas) {
      const label = (i._zona || "Sin Zona").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesHoyEnriquecidas]);

  const opcionesGestor = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesHoyEnriquecidas) {
      const label = (i._gestor || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesHoyEnriquecidas]);

  const opcionesCoordinador = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesHoyEnriquecidas) {
      const label = (i._coordinador || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesHoyEnriquecidas]);

  const opcionesCuadrilla = useMemo(() => {
    const m = new Map();
    for (const i of instalacionesHoyEnriquecidas) {
      const label = (i._cuadrillaNombre || "").toString();
      const key = norm(label);
      if (key) m.set(key, label);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }, [instalacionesHoyEnriquecidas]);

  // lista filtrada por lo que el usuario escribe
  const opcionesCuadrillaFiltradas = useMemo(
    () => opcionesCuadrilla.filter(q => norm(q).includes(norm(qCuadrilla))),
    [opcionesCuadrilla, qCuadrilla]
  );

  const pasaFiltroInst = (i) => {
    if (fZona && norm(i._zona || "Sin Zona") !== norm(fZona)) return false;
    if (fGestor && norm(i._gestor || "") !== norm(fGestor)) return false;
    if (fCoordinador && norm(i._coordinador || "") !== norm(fCoordinador)) return false;
    if (fCuadrilla && norm(i._cuadrillaNombre || "") !== norm(fCuadrilla)) return false;
    return true;
  };

  const instalacionesHoy = useMemo(
    () => instalacionesHoyEnriquecidas.filter(pasaFiltroInst),
    [instalacionesHoyEnriquecidas, fZona, fGestor, fCoordinador, fCuadrilla]
  );

  /* =========================
     Asistencia (solo cuadrillas con técnicos y presentes en las instalaciones)
  ========================== */
  const tecnicosHoy = useMemo(
    () => asistenciaTecnicosAll.filter(t => toYMD(t.fecha) === fecha),
    [asistenciaTecnicosAll, fecha]
  );
  const cuadrillasConTecnicosSet = useMemo(() => {
    const s = new Set(
      tecnicosHoy
        .map(t => norm(t.cuadrillaNombre || t.cuadrilla || t.nombreCuadrilla))
        .filter(Boolean)
    );
    return s;
  }, [tecnicosHoy]);

  const asistenciaFiltradaHoy = useMemo(() => {
    const cuInst = new Set(
      instalacionesHoy.map(i => norm(i._cuadrillaNombre)).filter(Boolean)
    );
    return asistenciaHoyBase
      .filter(c => cuadrillasConTecnicosSet.has(norm(c.nombre)))
      .filter(c => cuInst.has(norm(c.nombre)));
  }, [asistenciaHoyBase, instalacionesHoy, cuadrillasConTecnicosSet]);

  const asistidasHoy = useMemo(
    () => asistenciaFiltradaHoy.filter(c => (c.estado || "").toLowerCase() === "asistencia"),
    [asistenciaFiltradaHoy]
  );
  const totalRegistrosHoy = asistenciaFiltradaHoy.length;
  const pctAsistenciaHoy = totalRegistrosHoy > 0 ? (asistidasHoy.length / totalRegistrosHoy) * 100 : 0;

  /* =========================
     Instalaciones válidas (sin garantía) y KPIs
  ========================== */
  const instHoyValidas = useMemo(
    () => instalacionesHoy.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia"),
    [instalacionesHoy]
  );

  const instalacionesAyer = useMemo(() => {
    const base = instalacionesAll
      .filter(i => i._fechaYMD === fechaAyer)
      .map(i => {
        const key  = norm(i._cuadrillaNombre || i.cuadrillaNombre || i.cuadrilla);
        const meta = key && idxAsistenciaByNombre[key] ? idxAsistenciaByNombre[key] : {};

        const _zona = i.zona || meta.zona || "Sin Zona";

        const _gestor = personaDe(
          i.gestor ||
          i.gestorCuadrilla ||
          i.gestorNombre ||
          i.gestorCuadrillaNombre ||
          meta.gestor ||
          meta.gestorNombre ||
          ""
        );

        const _coordinador = personaDe(
          i.coordinador ||
          i.coordinadorCuadrilla ||
          i.coordinadorNombre ||
          i.coordinadorCuadrillaNombre ||
          meta.coordinador ||
          meta.coordinadorNombre ||
          ""
        );

        const _cuadrillaNombre = i._cuadrillaNombre || i.cuadrillaNombre || meta.nombre || "";

        return { ...i, _zona, _gestor, _coordinador, _cuadrillaNombre };
      });

    return base.filter(pasaFiltroInst);
  }, [instalacionesAll, fechaAyer, idxAsistenciaByNombre, fZona, fGestor, fCoordinador, fCuadrilla, usuariosIdx]);

  const instAyerValidas = useMemo(
    () => instalacionesAyer.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia"),
    [instalacionesAyer]
  );

  const finalizadasHoy = useMemo(
    () => instHoyValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada"),
    [instHoyValidas]
  );
  const countFinalizadasHoy = finalizadasHoy.length;

  const finalizadasAyer = useMemo(
    () => instAyerValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada"),
    [instAyerValidas]
  );
  const countFinalizadasAyer = finalizadasAyer.length;

  const efectividadHoy = instHoyValidas.length > 0 ? (countFinalizadasHoy / instHoyValidas.length) * 100 : 0;
  const efectividadAyer = instAyerValidas.length > 0 ? (countFinalizadasAyer / instAyerValidas.length) * 100 : 0;
  const deltaEfectividad = efectividadHoy - efectividadAyer;

  const prodHoy = asistidasHoy.length > 0 ? (countFinalizadasHoy / asistidasHoy.length) : 0;

  const asistidasAyer = useMemo(() => {
    const tecnicosAyer = asistenciaTecnicosAll.filter(t => toYMD(t.fecha) === fechaAyer);
    const setCuTecAyer = new Set(
      tecnicosAyer.map(t => norm(t.cuadrillaNombre || t.cuadrilla || t.nombreCuadrilla)).filter(Boolean)
    );
    const cuInstAyer = new Set(
      instalacionesAyer.map(i => norm(i._cuadrillaNombre)).filter(Boolean)
    );
    const asisAyer = asistenciaCuadrillasAll
      .filter(c => c.fecha === fechaAyer)
      .filter(c => setCuTecAyer.has(norm(c.nombre)))
      .filter(c => cuInstAyer.has(norm(c.nombre)));
    return asisAyer.filter(c => (c.estado || "").toLowerCase() === "asistencia");
  }, [asistenciaCuadrillasAll, asistenciaTecnicosAll, instalacionesAyer, fechaAyer]);
  const prodAyer = asistidasAyer.length > 0 ? (countFinalizadasAyer / asistidasAyer.length) : 0;
  const deltaProd = prodHoy - prodAyer;

  /* =========================
     Tiempo de ciclo promedio (solo finalizadas válidas)
  ========================== */
  function parseFechaHora(x) {
    if (!x) return null;
    if (typeof x === "string") {
      const d = dayjs(x);
      if (d.isValid()) return d;
      const hhmm = dayjs(`${fecha} ${x}`);
      return hhmm.isValid() ? hhmm : null;
    }
    if (x.toDate) return dayjs(x.toDate());
    return null;
  }
  const tiemposValidos = useMemo(() => {
    const mins = [];
    for (const i of finalizadasHoy) {
      const ini = parseFechaHora(i.horaInicio || i.inicio || i.horaInicioTrabajo);
      const fin = parseFechaHora(i.horaFin || i.fin || i.horaFinTrabajo);
      if (ini && fin && fin.isAfter(ini)) mins.push(fin.diff(ini, "minute"));
    }
    if (mins.length === 0) return { promedioMin: null, count: 0 };
    const avg = mins.reduce((s, m) => s + m, 0) / mins.length;
    return { promedioMin: avg, count: mins.length };
  }, [finalizadasHoy, fecha]);

  const tiempoCicloFmt = useMemo(() => {
    if (!Number.isFinite(tiemposValidos.promedioMin)) return "—";
    const totalMin = Math.round(tiemposValidos.promedioMin);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} h`;
  }, [tiemposValidos]);

  /* =========================
     Top Zonas y Distribución por zona
  ========================== */
  const topZonasData = useMemo(() => {
    const acc = {};
    for (const i of finalizadasHoy) {
      const z = i._zona || "Sin Zona";
      acc[z] = (acc[z] || 0) + 1;
    }
    return Object.entries(acc)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [finalizadasHoy]);

  const distZonasCompleto = useMemo(() => {
    const acc = {};
    for (const i of instHoyValidas) {
      const z = i._zona || "Sin Zona";
      acc[z] = (acc[z] || 0) + 1;
    }
    return Object.entries(acc).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [instHoyValidas]);

  /* =========================
     Mapa rápido
  ========================== */
  const puntosMapa = useMemo(() => {
    const pts = [];
    for (const i of instalacionesHoy) {
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
  }, [instalacionesHoy]);

  const centerMapa = useMemo(() => {
    if (puntosMapa.length === 0) return [-12.0464, -77.0428];
    const avgLat = puntosMapa.reduce((s, p) => s + p.lat, 0) / puntosMapa.length;
    const avgLng = puntosMapa.reduce((s, p) => s + p.lng, 0) / puntosMapa.length;
    return [avgLat, avgLng];
  }, [puntosMapa]);

  /* =========================
     Top Cuadrillas
  ========================== */
  const topCuadrillas = useMemo(() => {
    const acc = {};
    for (const i of finalizadasHoy) {
      const c = i._cuadrillaNombre || "Sin Cuadrilla";
      acc[c] = (acc[c] || 0) + 1;
    }
    return Object.entries(acc)
      .map(([cuadrilla, finalizadas]) => ({ cuadrilla, finalizadas }))
      .sort((a, b) => b.finalizadas - a.finalizadas)
      .slice(0, 8);
  }, [finalizadasHoy]);

  /* =========================
     Tendencia 7 días
  ========================== */
  const tendencia7 = useMemo(() => {
    const arr = [];
    for (let d = 6; d >= 0; d--) {
      const ymd = dayjs(fecha).subtract(d, "day").format("YYYY-MM-DD");

      const instD = instalacionesAll
        .filter(i => i._fechaYMD === ymd)
        .map(i => {
          const key  = norm(i._cuadrillaNombre || i.cuadrillaNombre || i.cuadrilla);
          const meta = key && idxAsistenciaByNombre[key] ? idxAsistenciaByNombre[key] : {};
          return {
            ...i,
            _zona: i.zona || meta.zona || "Sin Zona",
            _gestor: personaDe(
              i.gestor ||
              i.gestorCuadrilla ||
              i.gestorNombre ||
              i.gestorCuadrillaNombre ||
              meta.gestor ||
              meta.gestorNombre ||
              ""
            ),
            _coordinador: personaDe(
              i.coordinador ||
              i.coordinadorCuadrilla ||
              i.coordinadorNombre ||
              i.coordinadorCuadrillaNombre ||
              meta.coordinador ||
              meta.coordinadorNombre ||
              ""
            ),
            _cuadrillaNombre: i._cuadrillaNombre || i.cuadrillaNombre || meta.nombre || "",
          };
        })
        .filter(pasaFiltroInst);

      const instDValidas = instD.filter(i => (i.tipoServicio || "").toLowerCase() !== "garantia");
      const finD = instDValidas.filter(i => (i.estado || "").toLowerCase() === "finalizada").length;
      const efectD = instDValidas.length > 0 ? (finD / instDValidas.length) * 100 : 0;

      const cuInstSet = new Set(instD.map(i => norm(i._cuadrillaNombre)).filter(Boolean));
      const tecD = asistenciaTecnicosAll.filter(t => toYMD(t.fecha) === ymd);
      const cuConTec = new Set(tecD.map(t => norm(t.cuadrillaNombre || t.cuadrilla || t.nombreCuadrilla)).filter(Boolean));
      const asisD = asistenciaCuadrillasAll
        .filter(c => c.fecha === ymd)
        .filter(c => cuConTec.has(norm(c.nombre)))
        .filter(c => cuInstSet.has(norm(c.nombre)));
      const asisOK = asisD.filter(c => (c.estado || "").toLowerCase() === "asistencia");
      const pctAsisD = asisD.length > 0 ? (asisOK.length / asisD.length) * 100 : 0;

      arr.push({ fecha: ymd.slice(5), pctAsistencia: Number(pctAsisD.toFixed(1)), efectividad: Number(efectD.toFixed(1)) });
    }
    return arr;
  }, [fecha, instalacionesAll, asistenciaCuadrillasAll, asistenciaTecnicosAll, fZona, fGestor, fCoordinador, fCuadrilla, idxAsistenciaByNombre, usuariosIdx]);

  /* =========================
     Exportar Excel
  ========================== */
  const exportarXLSX = () => {
    const hoja1 = [
      ["Fecha", fecha],
      ["Zona", fZona || "Todas"],
      ["Gestor", fGestor || "Todos"],
      ["Coordinador", fCoordinador || "Todos"],
      ["Cuadrilla (cuadrillaNombre)", fCuadrilla || "Todas"],
      [],
      ["KPI", "Valor", "Ayer", "Δ"],
      ["Finalizadas (sin garantía)", countFinalizadasHoy, countFinalizadasAyer, countFinalizadasHoy - countFinalizadasAyer],
      ["Efectividad (sin garantía)", `${efectividadHoy.toFixed(1)}%`, `${efectividadAyer.toFixed(1)}%`, (efectividadHoy-efectividadAyer).toFixed(1)],
      ["% Asistencia (con técnicos)", `${pctAsistenciaHoy.toFixed(1)}%`, "", ""],
      ["Prod. (Finalizadas/Cuadrilla)", prodHoy.toFixed(2), prodAyer.toFixed(2), (prodHoy-prodAyer).toFixed(2)],
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
    XLSX.writeFile(wb, `dashboard_${fecha}.xlsx`);
  };

  /* =========================
     UI helpers
  ========================== */
  const progresoInst = Math.min(100, (countFinalizadasHoy / (metaInstalaciones || 1)) * 100);
  const progresoAsis = Math.min(100, (pctAsistenciaHoy / (metaPctAsistencia || 1)) * 100);
  const limpiarFiltros = () => {
  setFZona(""); setFGestor(""); setFCoordinador(""); setFCuadrilla(""); setQCuadrilla("");
};


  return (
    <div className="min-h-screen space-y-8 p-6 dark:bg-slate-900 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard — {fecha}</h1>
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
          <button
            onClick={() => setFecha(dayjs().subtract(1, "day").format("YYYY-MM-DD"))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            title="Ir a ayer"
          >
            ↩︎ Ayer
          </button>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:[color-scheme:dark]"
          />
          <button
            onClick={() => setFecha(dayjs().format("YYYY-MM-DD"))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            title="Ir a hoy"
          >
            Hoy
          </button>

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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Zona / Distrito</label>
            <select className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={fZona} onChange={(e) => setFZona(e.target.value)}>
              <option value="">Todas</option>
              {opcionesZonas.map(z => <option key={z} value={z}>{z}</option>)}
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

          {/* Cuadrilla + buscador */}
          <div className="md:col-span-2">
  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
    Cuadrilla (por <b>cuadrillaNombre</b>)
  </label>

  <input
    list="lista-cuadrillas"
    value={qCuadrilla}
    onChange={(e) => { setQCuadrilla(e.target.value); setFCuadrilla(e.target.value); }}
    onKeyDown={(e) => { if (e.key === "Enter") completarCuadrilla(); }}
    onBlur={completarCuadrilla}
    placeholder="Escribe una cuadrilla…"
    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
  />

  <datalist id="lista-cuadrillas">
    {opcionesCuadrilla.map(o => <option key={o} value={o} />)}
  </datalist>
</div>


          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Meta Finalizadas (sin garantía)</label>
              <input type="number" min={0} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={metaInstalaciones} onChange={(e) => setMetaInstalaciones(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Meta % Asistencia</label>
              <input type="number" min={0} max={100} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={metaPctAsistencia} onChange={(e) => setMetaPctAsistencia(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Termómetros */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-end justify-between">
              <p className="text-sm font-medium">Cumplimiento Instalaciones Finalizadas</p>
              <p className="text-xs text-slate-500">{countFinalizadasHoy}/{metaInstalaciones} ({progresoInst.toFixed(0)}%)</p>
            </div>
            <div className="mt-1 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-3 rounded-full bg-sky-500 dark:bg-sky-400" style={{ width: `${progresoInst}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between">
              <p className="text-sm font-medium">Cumplimiento % Asistencia</p>
              <p className="text-xs text-slate-500">{pctAsistenciaHoy.toFixed(1)}% / {metaPctAsistencia}% ({progresoAsis.toFixed(0)}%)</p>
            </div>
            <div className="mt-1 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-3 rounded-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${progresoAsis}%` }} />
            </div>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="% Asistencia (cuadrillas con técnicos)"
          value={`${pctAsistenciaHoy.toFixed(1)}%`}
          delta={NaN}
          hint={`${asistidasHoy.length}/${totalRegistrosHoy || 0} cuadrillas en campo`}
        />
        <Kpi
          label="Efectividad (sin garantía)"
          value={`${efectividadHoy.toFixed(1)}%`}
          delta={deltaEfectividad}
          hint={`${countFinalizadasHoy}/${instHoyValidas.length || 0} finalizadas válidas`}
        />
        <Kpi
          label="Prod: Finalizadas/Cuadrilla"
          value={prodHoy.toFixed(2)}
          delta={deltaProd}
          hint="Finalizadas válidas / Cuadrillas asistidas"
        />
        <Kpi
          label="Finalizadas (sin garantía)"
          value={countFinalizadasHoy}
          delta={countFinalizadasHoy - countFinalizadasAyer}
          hint={`Comparado con ayer (${countFinalizadasAyer})`}
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
            <Empty title="Sin datos" desc="No hay finalizadas válidas para esta fecha y filtros." />
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
          {instHoyValidas.length === 0 ? (
            <Empty title="Sin instalaciones válidas" desc="No hay registros distintos a garantía." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={(function() {
                    const acc = {};
                    instHoyValidas.forEach(i => {
                      const e = (i.estado || "otro").toLowerCase();
                      acc[e] = (acc[e] || 0) + 1;
                    });
                    return Object.entries(acc).map(([k, v]) => ({ name: k, value: v }));
                  })()}
                  dataKey="value"
                  outerRadius={100}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {Object.keys((function(){const a={};instHoyValidas.forEach(i=>{const e=(i.estado||"otro").toLowerCase();a[e]=(a[e]||0)+1});return a;})()).map((_, idx) => (
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
        <Card title="Tendencia 7 días — % Asistencia (con técnicos) vs Efectividad">
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

        {/* Detalle rápido SIN plan y SIN garantía */}
        <Card title="Detalle rápido — Instalaciones (Estado / Distrito) — SIN garantía">
          {instHoyValidas.length === 0 ? (
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
                  {instHoyValidas.map((i) => (
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

        <Card title="Top Cuadrillas — Finalizadas válidas (hoy)">
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

      {/* Avanzado: tabla completa del filtro (con plan) */}
      {showAvanzado && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Tabla rápida — Instalaciones (filtro aplicado) — SIN garantía">
            {instHoyValidas.length === 0 ? (
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
                      <th className="px-2 py-2 text-left">Cuadrilla</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instHoyValidas.map((i) => (
                      <tr key={i.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-2 py-2">{i.cliente || i.codigoCliente || i.id}</td>
                        <td className="px-2 py-2">{(i.estado || "").toLowerCase()}</td>
                        <td className="px-2 py-2">{i.plan || i.planServicio || i.tipoInstalacion || i.tipoInstalación || "—"}</td>
                        <td className="px-2 py-2">{i._zona || "—"}</td>
                        <td className="px-2 py-2">{i.region || "—"}</td>
                        <td className="px-2 py-2">{i.zonaCuadrilla || "—"}</td>
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
