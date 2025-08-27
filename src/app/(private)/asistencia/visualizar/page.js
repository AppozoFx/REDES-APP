"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  query as fbQuery,
  where,
  doc,
  updateDoc,
} from "firebase/firestore";
import dayjs from "dayjs";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";

/* =========================
   UI Helpers (alineados al registro)
========================= */
const Chip = ({ color = "gray", children, onClick, active = false }) => {
  const map = {
    green: "bg-green-50 text-green-700 ring-green-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    yellow: "bg-yellow-50 text-yellow-700 ring-yellow-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    gray: "bg-gray-50 text-gray-700 ring-gray-200",
    orange: "bg-orange-50 text-orange-700 ring-orange-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
  };
  const base = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
    map[color] || map.gray
  }`;
  const clickable = onClick ? "cursor-pointer hover:opacity-90" : "";
  const selected = active ? "outline outline-2 outline-offset-2 outline-[#30518c]" : "";
  return (
    <span className={`${base} ${clickable} ${selected}`} onClick={onClick}>
      {children}
    </span>
  );
};

const estadoToColor = (estado) => {
  switch ((estado || "").toLowerCase()) {
    case "asistencia": return "green";
    case "falta": return "red";
    case "suspendida": return "orange";
    case "descanso": return "yellow";
    case "descanso medico": return "indigo";
    case "vacaciones": return "blue";
    case "recuperacion": return "gray";
    case "asistencia compensada": return "blue";
    default: return "slate";
  }
};

const EstadoPill = ({ estado }) => (
  <Chip color={estadoToColor(estado)}>{estado}</Chip>
);

const Progress = ({ value = 0 }) => (
  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
    <div
      className="h-2 bg-[#30518c] transition-all"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);

/* =========================
   Componente principal
========================= */
export default function VisualizarAsistencia() {
  const { userData } = useAuth();

  // ---- Filtros básicos
  const hoy = dayjs().format("YYYY-MM-DD");
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [filtroGestor, setFiltroGestor] = useState("");
  const [filtroCoordinador, setFiltroCoordinador] = useState("");
  const [filtroCuadrilla, setFiltroCuadrilla] = useState("");
  const [filtroTecnico, setFiltroTecnico] = useState("");
  const [filtroEstado, setFiltroEstado] = useState(""); // chips
  const [tab, setTab] = useState("cuadrillas"); // "cuadrillas" | "tecnicos"
  const [groupBy, setGroupBy] = useState("none"); // none | estado | gestor | coordinador | zona
  const [compacto, setCompacto] = useState(false);

  // ---- Orden y paginación
  const [ordenC, setOrdenC] = useState({ campo: "nombre", dir: "asc" });
  const [ordenT, setOrdenT] = useState({ campo: "tecnico", dir: "asc" });
  const [pageC, setPageC] = useState(1);
  const [pageT, setPageT] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ---- Datos
  const [asistenciaCuadrillas, setAsistenciaCuadrillas] = useState([]);
  const [asistenciaTecnicos, setAsistenciaTecnicos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [editando, setEditando] = useState({});
  const [detalleCuadrillaId, setDetalleCuadrillaId] = useState(null);
  const [cargando, setCargando] = useState(false);

  const puedeEditar = userData?.rol?.some((r) =>
    ["TI", "Gerencia", "RRHH", "Almacén"].includes(r)
  );

  // ---- URL <-> Filtros (compartible)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pDesde = params.get("desde");
    const pHasta = params.get("hasta");
    const pTab = params.get("tab");
    const pFG = params.get("gestor");
    const pFC = params.get("coord");
    const pCQ = params.get("cuad");
    const pTQ = params.get("tec");
    const pFE = params.get("estado");
    const pGB = params.get("groupBy");
    const pPS = params.get("ps");
    const pCP = params.get("compact");

    if (pDesde) setDesde(pDesde);
    if (pHasta) setHasta(pHasta);
    if (pTab) setTab(pTab);
    if (pFG) setFiltroGestor(pFG);
    if (pFC) setFiltroCoordinador(pFC);
    if (pCQ) setFiltroCuadrilla(pCQ);
    if (pTQ) setFiltroTecnico(pTQ);
    if (pFE) setFiltroEstado(pFE);
    if (pGB) setGroupBy(pGB);
    if (pPS) setPageSize(Number(pPS) || 20);
    if (pCP) setCompacto(pCP === "1");
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("desde", desde);
    params.set("hasta", hasta);
    params.set("tab", tab);
    if (filtroGestor) params.set("gestor", filtroGestor);
    if (filtroCoordinador) params.set("coord", filtroCoordinador);
    if (filtroCuadrilla) params.set("cuad", filtroCuadrilla);
    if (filtroTecnico) params.set("tec", filtroTecnico);
    if (filtroEstado) params.set("estado", filtroEstado);
    if (groupBy !== "none") params.set("groupBy", groupBy);
    if (pageSize !== 20) params.set("ps", String(pageSize));
    if (compacto) params.set("compact", "1");
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", url);
  }, [desde, hasta, tab, filtroGestor, filtroCoordinador, filtroCuadrilla, filtroTecnico, filtroEstado, groupBy, pageSize, compacto]);

  /* =========================
     Carga de datos por rango
  ========================= */
  const getWhereFecha = () => {
    if (desde === hasta) return [where("fecha", "==", desde)];
    // Rango (necesita índice por campo fecha). YYYY-MM-DD funciona bien lexicográficamente.
    return [where("fecha", ">=", desde), where("fecha", "<=", hasta)];
  };

  useEffect(() => {
    const fetchData = async () => {
      setCargando(true);
      try {
        const [cuadSnap, userSnap, zonasSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
          getDocs(collection(db, "zonas")),
        ]);

        const cuadrillasData = cuadSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const usuariosData = userSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const zonasData = zonasSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.zona || "").localeCompare(b.zona || ""));

        setCuadrillas(cuadrillasData);
        setUsuarios(usuariosData);
        setZonas(zonasData);
      } finally {
        setCargando(false);
      }
    };
    fetchData();
  }, []);

  // Carga dependiente del rango
  useEffect(() => {
    const fetchAsistencia = async () => {
      setCargando(true);
      try {
        const whereFecha = getWhereFecha();
        const [cuadAsisSnap, tecAsisSnap] = await Promise.all([
          getDocs(fbQuery(collection(db, "asistencia_cuadrillas"), ...whereFecha)),
          getDocs(fbQuery(collection(db, "asistencia_tecnicos"), ...whereFecha)),
        ]);

        const asistenciaCData = cuadAsisSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const asistenciaTData = tecAsisSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const asistenciaCConDatos = asistenciaCData.map((a) => ({
          ...a,
          gestor: a.gestor || "-",
          coordinador: a.coordinador || "-",
        }));

        setAsistenciaCuadrillas(asistenciaCConDatos);
        setAsistenciaTecnicos(asistenciaTData);
        setPageC(1);
        setPageT(1);
      } finally {
        setCargando(false);
      }
    };
    fetchAsistencia();
  }, [desde, hasta]);

  /* =========================
     Filtros, búsqueda y chips
  ========================= */
  const gestoresUnicos = useMemo(
    () => [...new Set(asistenciaCuadrillas.map((a) => a.gestor).filter(Boolean))],
    [asistenciaCuadrillas]
  );
  const coordinadoresUnicos = useMemo(
    () => [...new Set(asistenciaCuadrillas.map((a) => a.coordinador).filter(Boolean))],
    [asistenciaCuadrillas]
  );

  // Búsqueda combinada para cuadrillas
  const cuadrillasFiltradasBase = useMemo(() => {
    const q = (filtroCuadrilla || "").toLowerCase().trim();
    const matchQ = (a) => {
      if (!q) return true;
      const en = [
        a.nombre,
        a.zona,
        a.placa,
        a.gestor,
        a.coordinador,
        a.tipo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return en.includes(q);
    };
    return asistenciaCuadrillas.filter((a) => {
      const coincideGestor = filtroGestor ? a.gestor === filtroGestor : true;
      const coincideCoordinador = filtroCoordinador ? a.coordinador === filtroCoordinador : true;
      const coincideEstado = filtroEstado ? (a.estado || "").toLowerCase() === filtroEstado : true;
      return coincideGestor && coincideCoordinador && coincideEstado && matchQ(a);
    });
  }, [asistenciaCuadrillas, filtroGestor, filtroCoordinador, filtroCuadrilla, filtroEstado]);

  // Búsqueda para técnicos (por nombre y cuadrilla mostrada)
  const cuadrillasMostradasIds = useMemo(
    () => new Set(cuadrillasFiltradasBase.map((c) => c.cuadrillaId)),
    [cuadrillasFiltradasBase]
  );

  const tecnicosFiltradosBase = useMemo(() => {
    const q = (filtroTecnico || "").toLowerCase().trim();
    return asistenciaTecnicos.filter((t) => {
      const u = usuarios.find((uu) => uu.id === t.tecnicoId);
      const nombreCompleto = u ? `${u.nombres} ${u.apellidos}`.toLowerCase() : "";

      const coincideTecnico = q ? nombreCompleto.includes(q) : true;
      const coincideCuadrilla = filtroCuadrilla ? cuadrillasMostradasIds.has(t.cuadrillaId) : true;
      const coincideEstado = filtroEstado ? (t.estado || "").toLowerCase() === filtroEstado : true;

      return coincideTecnico && coincideCuadrilla && coincideEstado;
    });
  }, [asistenciaTecnicos, usuarios, filtroTecnico, filtroCuadrilla, filtroEstado, cuadrillasMostradasIds]);

  /* =========================
     Orden y paginación
  ========================= */
  const sortBy = (arr, campo, dir, accessor) => {
    const sorted = [...arr].sort((a, b) => {
      const va = accessor(a, campo);
      const vb = accessor(b, campo);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    });
    return dir === "desc" ? sorted.reverse() : sorted;
  };

  const cuadrillasOrdenadas = useMemo(() => {
    const accessor = (a, campo) => {
      switch (campo) {
        case "nombre": return a.nombre;
        case "fecha": return a.fecha;
        case "tipo": return a.tipo;
        case "zona": return a.zona;
        case "estado": return a.estado;
        case "placa": return a.placa;
        case "gestor": return a.gestor;
        case "coordinador": return a.coordinador;
        default: return a.nombre;
      }
    };
    return sortBy(cuadrillasFiltradasBase, ordenC.campo, ordenC.dir, accessor);
  }, [cuadrillasFiltradasBase, ordenC]);

  const tecnicosOrdenados = useMemo(() => {
    const accessor = (t, campo) => {
      const u = usuarios.find((uu) => uu.id === t.tecnicoId);
      switch (campo) {
        case "tecnico": return u ? `${u.nombres} ${u.apellidos}` : t.tecnicoId;
        case "cuadrilla": return (cuadrillas.find((c) => c.id === t.cuadrillaId)?.nombre) || "-";
        case "fecha": return t.fecha;
        case "estado": return t.estado;
        default: return u ? `${u.nombres} ${u.apellidos}` : t.tecnicoId;
      }
    };
    return sortBy(tecnicosFiltradosBase, ordenT.campo, ordenT.dir, accessor);
  }, [tecnicosFiltradosBase, ordenT, usuarios, cuadrillas]);

  const paginate = (arr, page, size) => {
    const start = (page - 1) * size;
    return arr.slice(start, start + size);
  };

  const totalPagesC = Math.max(1, Math.ceil(cuadrillasOrdenadas.length / pageSize));
  const totalPagesT = Math.max(1, Math.ceil(tecnicosOrdenados.length / pageSize));
  const cuadrillasPagina = paginate(cuadrillasOrdenadas, pageC, pageSize);
  const tecnicosPagina = paginate(tecnicosOrdenados, pageT, pageSize);

  /* =========================
     Agrupar (Cuadrillas)
  ========================= */
  const gruposCuadrillas = useMemo(() => {
    if (groupBy === "none") return { "Resultados": cuadrillasPagina };
    const map = {};
    const keyOf = (c) => {
      switch (groupBy) {
        case "estado": return c.estado || "-";
        case "gestor": return c.gestor || "-";
        case "coordinador": return c.coordinador || "-";
        case "zona": return c.zona || "-";
        default: return "Resultados";
      }
    };
    cuadrillasPagina.forEach((c) => {
      const k = keyOf(c);
      if (!map[k]) map[k] = [];
      map[k].push(c);
    });
    return map;
  }, [cuadrillasPagina, groupBy]);

  /* =========================
     Resumen (KPI)
  ========================= */
  const resumen = useMemo(() => {
    const contar = (arr, valor) => arr.reduce((acc, x) => acc + (((x.estado || "").toLowerCase() === valor) ? 1 : 0), 0);
    const otros = (arr) =>
      arr.filter((x) => !["asistencia", "falta"].includes((x.estado || "").toLowerCase())).length;

    const cAsis = contar(cuadrillasOrdenadas, "asistencia");
    const cFalta = contar(cuadrillasOrdenadas, "falta");
    const cOtros = otros(cuadrillasOrdenadas);
    const cTotal = cuadrillasOrdenadas.length;
    const cPct = cTotal ? ((cAsis / cTotal) * 100).toFixed(1) : "0.0";

    const tAsis = contar(tecnicosOrdenados, "asistencia");
    const tFalta = contar(tecnicosOrdenados, "falta");
    const tOtros = otros(tecnicosOrdenados);
    const tTotal = tecnicosOrdenados.length;
    const tPct = tTotal ? ((tAsis / tTotal) * 100).toFixed(1) : "0.0";

    return { cAsis, cFalta, cOtros, cTotal, cPct, tAsis, tFalta, tOtros, tTotal, tPct };
  }, [cuadrillasOrdenadas, tecnicosOrdenados]);

  /* =========================
     Excel
  ========================= */
  const exportarExcel = () => {
    const cuadrillasSheet = cuadrillasOrdenadas.map((c) => {
      const cuadrilla = cuadrillas.find((cu) => cu.id === c.cuadrillaId);
      const gestor = usuarios.find((u) => u.id === cuadrilla?.gestor);
      const coordinador = usuarios.find((u) => u.id === cuadrilla?.coordinador);
      return {
        Fecha: c.fecha,
        Cuadrilla: c.nombre,
        Tipo: c.tipo,
        Zona: c.zona,
        Estado: c.estado,
        Placa: c.placa,
        Observaciones: c.observaciones || "",
        "Registrado por": usuarios.find((u) => u.id === c.registradoPor)
          ? `${usuarios.find((u) => u.id === c.registradoPor).nombres} ${usuarios.find((u) => u.id === c.registradoPor).apellidos}`
          : c.registradoPor,
        "Modificado por": usuarios.find((u) => u.id === c.modificadoPor)
          ? `${usuarios.find((u) => u.id === c.modificadoPor).nombres} ${usuarios.find((u) => u.id === c.modificadoPor).apellidos}`
          : c.modificadoPor,
        Gestor: gestor ? `${gestor.nombres} ${gestor.apellidos}` : "-",
        Coordinador: coordinador ? `${coordinador.nombres} ${coordinador.apellidos}` : "-",
      };
    });

    const tecnicosSheet = tecnicosOrdenados.map((t) => {
      const tecnico = usuarios.find((u) => u.id === t.tecnicoId);
      const cuadrilla = cuadrillas.find((c) => c.id === t.cuadrillaId);
      return {
        Fecha: t.fecha,
        Técnico: tecnico ? `${tecnico.nombres} ${tecnico.apellidos}` : t.tecnicoId,
        Cuadrilla: cuadrilla?.nombre || "-",
        Estado: t.estado,
        Observaciones: t.observaciones || "",
        "Registrado por": usuarios.find((u) => u.id === t.registradoPor)
          ? `${usuarios.find((u) => u.id === t.registradoPor).nombres} ${usuarios.find((u) => u.id === t.registradoPor).apellidos}`
          : t.registradoPor,
        "Modificado por": usuarios.find((u) => u.id === t.modificadoPor)
          ? `${usuarios.find((u) => u.id === t.modificadoPor).nombres} ${usuarios.find((u) => u.id === t.modificadoPor).apellidos}`
          : t.modificadoPor,
      };
    });

    const resumenSheet = [
      { Rango: `${desde} → ${hasta}`, Campo: "Cuadrillas asistencia", Total: resumen.cAsis },
      { Rango: `${desde} → ${hasta}`, Campo: "Cuadrillas falta", Total: resumen.cFalta },
      { Rango: `${desde} → ${hasta}`, Campo: "Cuadrillas otros", Total: resumen.cOtros },
      { Rango: `${desde} → ${hasta}`, Campo: "Técnicos asistencia", Total: resumen.tAsis },
      { Rango: `${desde} → ${hasta}`, Campo: "Técnicos falta", Total: resumen.tFalta },
      { Rango: `${desde} → ${hasta}`, Campo: "Técnicos otros", Total: resumen.tOtros },
      { Rango: `${desde} → ${hasta}`, Campo: "Exportado por", Total: `${userData?.nombres || ""} ${userData?.apellidos || ""}` },
      { Rango: `${desde} → ${hasta}`, Campo: "Fecha exportación", Total: dayjs().format("YYYY-MM-DD HH:mm") },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cuadrillasSheet), "Cuadrillas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tecnicosSheet), "Técnicos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenSheet), "Resumen");
    XLSX.writeFile(wb, `asistencia_${desde}_a_${hasta}.xlsx`);
  };

  /* =========================
     Edición
  ========================= */
  const handleEditChange = (id, field, value) => {
    setEditando((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };
  const cancelarEdicion = (id) => {
    setEditando((prev) => {
      const cp = { ...prev };
      delete cp[id];
      return cp;
    });
  };
  const guardarCambios = async (c) => {
    const nuevosDatos = editando[c.id];
    if (!nuevosDatos) return;
    await updateDoc(doc(db, "asistencia_cuadrillas", c.id), {
      ...nuevosDatos,
      modificadoPor: userData?.uid || "",
    });
    setAsistenciaCuadrillas((prev) =>
      prev.map((item) => (item.id === c.id ? { ...item, ...nuevosDatos } : item))
    );
    toast.success("✅ Cambios guardados correctamente");
    cancelarEdicion(c.id);
  };
  const guardarCambiosTecnico = async (t) => {
    const idDoc = `${t.tecnicoId}_${t.fecha}`;
    const nuevosDatos = editando[idDoc];
    if (!nuevosDatos) return;
    await updateDoc(doc(db, "asistencia_tecnicos", idDoc), {
      ...nuevosDatos,
      modificadoPor: userData?.uid || "",
    });
    setAsistenciaTecnicos((prev) =>
      prev.map((item) =>
        `${item.tecnicoId}_${item.fecha}` === idDoc ? { ...item, ...nuevosDatos } : item
      )
    );
    toast.success("✅ Cambios guardados en asistencia del técnico");
    cancelarEdicion(idDoc);
  };

  /* =========================
     Presets, vistas, utilidades
  ========================= */
  const setPreset = (tipo) => {
    const today = dayjs();
    if (tipo === "hoy") { setDesde(today.format("YYYY-MM-DD")); setHasta(today.format("YYYY-MM-DD")); }
    if (tipo === "ayer") { const y = today.subtract(1, "day"); setDesde(y.format("YYYY-MM-DD")); setHasta(y.format("YYYY-MM-DD")); }
    if (tipo === "7") { setDesde(today.subtract(6, "day").format("YYYY-MM-DD")); setHasta(today.format("YYYY-MM-DD")); }
    if (tipo === "mes") { setDesde(today.startOf("month").format("YYYY-MM-DD")); setHasta(today.endOf("month").format("YYYY-MM-DD")); }
  };

  const guardarVista = () => {
    const nombre = prompt("Nombre de la vista:");
    if (!nombre) return;
    const vista = {
      desde, hasta, tab, filtroGestor, filtroCoordinador, filtroCuadrilla, filtroTecnico, filtroEstado, groupBy, pageSize, compacto,
      ordenC, ordenT,
    };
    const key = "asistencia_vistas";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const existente = arr.find((v) => v.nombre === nombre);
    if (existente) Object.assign(existente, { nombre, ...vista });
    else arr.push({ nombre, ...vista });
    localStorage.setItem(key, JSON.stringify(arr));
    toast.success("✅ Vista guardada");
  };

  const cargarVista = () => {
    const key = "asistencia_vistas";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    if (!arr.length) return toast("No hay vistas guardadas");
    const nombre = prompt(`Escribe el nombre de la vista a cargar:\n${arr.map(v => `• ${v.nombre}`).join("\n")}`);
    const v = arr.find((x) => x.nombre === nombre);
    if (!v) return toast.error("Vista no encontrada");
    setDesde(v.desde); setHasta(v.hasta); setTab(v.tab || "cuadrillas");
    setFiltroGestor(v.filtroGestor || ""); setFiltroCoordinador(v.filtroCoordinador || "");
    setFiltroCuadrilla(v.filtroCuadrilla || ""); setFiltroTecnico(v.filtroTecnico || "");
    setFiltroEstado(v.filtroEstado || ""); setGroupBy(v.groupBy || "none");
    setPageSize(v.pageSize || 20); setCompacto(!!v.compacto);
    setOrdenC(v.ordenC || { campo: "nombre", dir: "asc" });
    setOrdenT(v.ordenT || { campo: "tecnico", dir: "asc" });
    toast.success("✅ Vista cargada");
  };

  const copiarResumen = async () => {
    const txt =
`Asistencia (${desde} → ${hasta})
Cuadrillas: Total ${resumen.cTotal} | Asistencia ${resumen.cAsis} | Falta ${resumen.cFalta} | Otros ${resumen.cOtros} | % ${resumen.cPct}%
Técnicos:  Total ${resumen.tTotal} | Asistencia ${resumen.tAsis} | Falta ${resumen.tFalta} | Otros ${resumen.tOtros} | % ${resumen.tPct}%`;
    await navigator.clipboard.writeText(txt);
    toast.success("📋 Resumen copiado");
  };

  const limpiarFiltros = () => {
    setFiltroGestor(""); setFiltroCoordinador(""); setFiltroCuadrilla("");
    setFiltroTecnico(""); setFiltroEstado("");
  };

  /* =========================
     Render
  ========================= */
  return (
    <div className="h-full w-full overflow-auto">
      {/* Barra superior fija */}
      <div className="sticky top-0 z-20 bg-white dark:bg-[#0f0f0f] border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-full px-4 py-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-2xl font-bold text-[#30518c]">Visualizar Asistencia</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-auto">
              <div className="p-3 rounded-xl border bg-white dark:bg-gray-900">
                <div className="text-xs text-gray-500">Cuadrillas asist.</div>
                <div className="font-bold text-lg">{resumen.cAsis}/{resumen.cTotal}</div>
                <Progress value={Number(resumen.cPct)} />
              </div>
              <div className="p-3 rounded-xl border bg-white dark:bg-gray-900">
                <div className="text-xs text-gray-500">Técnicos asist.</div>
                <div className="font-bold text-lg">{resumen.tAsis}/{resumen.tTotal}</div>
                <Progress value={Number(resumen.tPct)} />
              </div>
              <div className="p-3 rounded-xl border bg-white dark:bg-gray-900">
                <div className="text-xs text-gray-500">Cuadrillas falta</div>
                <div className="font-bold text-lg">{resumen.cFalta}</div>
              </div>
              <div className="p-3 rounded-xl border bg-white dark:bg-gray-900">
                <div className="text-xs text-gray-500">Técnicos falta</div>
                <div className="font-bold text-lg">{resumen.tFalta}</div>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="mt-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold">Desde:</label>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                />
                <label className="text-sm font-semibold">Hasta:</label>
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                />
                <div className="flex gap-1">
                  <button onClick={() => setPreset("hoy")} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Hoy</button>
                  <button onClick={() => setPreset("ayer")} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Ayer</button>
                  <button onClick={() => setPreset("7")} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Últ. 7</button>
                  <button onClick={() => setPreset("mes")} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Mes</button>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                <select value={filtroGestor} onChange={(e) => setFiltroGestor(e.target.value)} className="px-3 py-2 border rounded-md">
                  <option value="">Todos los Gestores</option>
                  {gestoresUnicos.map((g) => (<option key={g}>{g}</option>))}
                </select>
                <select value={filtroCoordinador} onChange={(e) => setFiltroCoordinador(e.target.value)} className="px-3 py-2 border rounded-md">
                  <option value="">Todos los Coordinadores</option>
                  {coordinadoresUnicos.map((c) => (<option key={c}>{c}</option>))}
                </select>
                <input
                  type="text"
                  placeholder="Buscar cuadrilla / placa / zona / gestor…"
                  value={filtroCuadrilla}
                  onChange={(e) => setFiltroCuadrilla(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                />
                <input
                  type="text"
                  placeholder="Buscar técnico…"
                  value={filtroTecnico}
                  onChange={(e) => setFiltroTecnico(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                />
              </div>

              <div className="flex items-center gap-2">
                <button onClick={limpiarFiltros} className="px-3 py-2 rounded-md border hover:bg-gray-50">Limpiar</button>
                <button onClick={guardarVista} className="px-3 py-2 rounded-md border hover:bg-gray-50">Guardar vista</button>
                <button onClick={cargarVista} className="px-3 py-2 rounded-md border hover:bg-gray-50">Cargar vista</button>
                <button onClick={copiarResumen} className="px-3 py-2 rounded-md border hover:bg-gray-50">Copiar resumen</button>
                <button onClick={exportarExcel} className="bg-[#30518c] text-white px-4 py-2 rounded shadow hover:bg-[#203a66]">📤 Excel</button>
              </div>
            </div>

            {/* Chips estado */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">Filtrar estado:</span>
              {["", "asistencia", "falta", "suspendida", "descanso", "descanso medico", "vacaciones", "recuperacion", "asistencia compensada"].map((e) => (
                <Chip
                  key={e || "todos"}
                  color={e ? estadoToColor(e) : "slate"}
                  onClick={() => setFiltroEstado((prev) => (prev === e ? "" : e))}
                  active={filtroEstado === e}
                >
                  {e ? e : "Todos"}
                </Chip>
              ))}
              <span className="mx-2 text-gray-300">|</span>
              <label className="text-xs text-gray-600">Agrupar:</label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="px-2 py-1 border rounded text-xs"
              >
                <option value="none">Sin agrupar</option>
                <option value="estado">Por estado</option>
                <option value="gestor">Por gestor</option>
                <option value="coordinador">Por coordinador</option>
                <option value="zona">Por zona</option>
              </select>
              <span className="mx-2 text-gray-300">|</span>
              <label className="text-xs text-gray-600">Densidad:</label>
              <button onClick={() => setCompacto((v) => !v)} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">
                {compacto ? "Cómodo" : "Compacto"}
              </button>
              <span className="mx-2 text-gray-300">|</span>
              <label className="text-xs text-gray-600">Filas/pág:</label>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPageC(1); setPageT(1); }} className="px-2 py-1 border rounded text-xs">
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {/* Tabs */}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setTab("cuadrillas")}
                className={`px-3 py-1.5 rounded-full text-sm ring-1 ${
                  tab === "cuadrillas"
                    ? "bg-[#30518c] text-white ring-[#30518c]"
                    : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                Cuadrillas ({cuadrillasOrdenadas.length})
              </button>
              <button
                onClick={() => setTab("tecnicos")}
                className={`px-3 py-1.5 rounded-full text-sm ring-1 ${
                  tab === "tecnicos"
                    ? "bg-[#30518c] text-white ring-[#30518c]"
                    : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                Técnicos ({tecnicosOrdenados.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className={`px-4 py-4 space-y-6 ${compacto ? "text-[13px]" : "text-sm"}`}>
        {/* Tabla Cuadrillas */}
        {tab === "cuadrillas" && (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-auto">
            {cargando ? (
              <div className="p-8 animate-pulse text-gray-500">Cargando…</div>
            ) : cuadrillasOrdenadas.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No hay registros para los filtros seleccionados.</div>
            ) : (
              <>
                {/* Agrupado */}
                {Object.entries(gruposCuadrillas).map(([grupo, items]) => (
                  <div key={grupo}>
                    {groupBy !== "none" && (
                      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-2 font-semibold border-b border-gray-200">
                        {grupo} <span className="text-xs text-gray-500">({items.length})</span>
                      </div>
                    )}
                    <table className="w-full border-collapse">
                      {groupBy === "none" && (
                        <thead>
                          <tr className="bg-[#30518c] text-white text-left sticky top-0 z-10">
                            <ThC label="Cuadrilla" campo="nombre" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Fecha" campo="fecha" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Tipo" campo="tipo" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Zona" campo="zona" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Estado" campo="estado" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Placa" campo="placa" orden={ordenC} setOrden={setOrdenC} />
                            <th className="p-2">Observaciones</th>
                            <ThC label="Gestor" campo="gestor" orden={ordenC} setOrden={setOrdenC} />
                            <ThC label="Coordinador" campo="coordinador" orden={ordenC} setOrden={setOrdenC} />
                            <th className="p-2">Acción</th>
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {items.map((c, idx) => {
                          const esEditando = !!editando[c.id];
                          const valor = editando[c.id] || c;
                          return (
                            <tr key={c.id} className={`border-b ${idx % 2 ? "bg-gray-50/50 dark:bg-gray-800/30" : ""} hover:bg-gray-50 dark:hover:bg-gray-800`}>
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    className="text-[#30518c] underline underline-offset-2"
                                    onClick={() => setDetalleCuadrillaId(c.cuadrillaId)}
                                  >
                                    {c.nombre}
                                  </button>
                                </div>
                              </td>
                              <td className="p-2">{c.fecha}</td>
                              <td className="p-2">
                                {esEditando ? (
                                  <select value={valor.tipo} onChange={(e) => handleEditChange(c.id, "tipo", e.target.value)} className="border px-2 py-1 rounded-md">
                                    <option value="Regular">Regular</option>
                                    <option value="TOP">TOP</option>
                                    <option value="Alto Valor">Alto Valor</option>
                                  </select>
                                ) : c.tipo}
                              </td>
                              <td className="p-2">{esEditando ? (
                                <select value={valor.zona} onChange={(e) => handleEditChange(c.id, "zona", e.target.value)} className="border px-2 py-1 w-44 rounded-md">
                                  {zonas.map((z) => <option key={z.id} value={z.zona}>{z.zona}</option>)}
                                </select>
                              ) : c.zona}</td>
                              <td className="p-2">
                                {esEditando ? (
                                  <select value={valor.estado} onChange={(e) => handleEditChange(c.id, "estado", e.target.value)} className="border px-2 py-1 rounded-md">
                                    {["asistencia","falta","suspendida","descanso","descanso medico","vacaciones","recuperacion","asistencia compensada"].map(op => <option key={op} value={op}>{op}</option>)}
                                  </select>
                                ) : <EstadoPill estado={c.estado} />}
                              </td>
                              <td className="p-2">
                                {esEditando ? (
                                  <input value={valor.placa || ""} onChange={(e) => handleEditChange(c.id, "placa", e.target.value)} className="border px-2 py-1 rounded-md" placeholder="ABC-123" />
                                ) : (c.placa || <span className="text-gray-400 italic">Sin placa</span>)}
                              </td>
                              <td className="p-2">
                                {esEditando ? (
                                  <input value={valor.observaciones || ""} onChange={(e) => handleEditChange(c.id, "observaciones", e.target.value)} className="border px-2 py-1 rounded-md" placeholder="Observaciones…" />
                                ) : (c.observaciones || <span className="text-gray-400 italic">Sin observaciones</span>)}
                              </td>
                              <td className="p-2">{c.gestor}</td>
                              <td className="p-2">{c.coordinador}</td>
                              <td className="p-2">
                                {puedeEditar ? (
                                  esEditando ? (
                                    <div className="flex gap-2">
                                      <button onClick={() => guardarCambios(c)} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded">Guardar</button>
                                      <button onClick={() => cancelarEdicion(c.id)} className="border px-3 py-1 rounded hover:bg-gray-50">Cancelar</button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2">
                                      <button onClick={() => setEditando((p) => ({ ...p, [c.id]: c }))} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded">Editar</button>
                                      <button onClick={() => setDetalleCuadrillaId(c.cuadrillaId)} className="border px-3 py-1 rounded hover:bg-gray-50">Ver</button>
                                    </div>
                                  )
                                ) : (
                                  <button onClick={() => setDetalleCuadrillaId(c.cuadrillaId)} className="border px-3 py-1 rounded hover:bg-gray-50">Ver</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}

                {/* Paginación */}
                <Pagination
                  page={pageC}
                  totalPages={totalPagesC}
                  onPage={(p) => setPageC(p)}
                />
              </>
            )}
          </div>
        )}

        {/* Tabla Técnicos */}
        {tab === "tecnicos" && (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-auto">
            {cargando ? (
              <div className="p-8 animate-pulse text-gray-500">Cargando…</div>
            ) : tecnicosOrdenados.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No hay registros para los filtros seleccionados.</div>
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#30518c] text-white text-left sticky top-0 z-10">
                      <ThT label="Técnico" campo="tecnico" orden={ordenT} setOrden={setOrdenT} />
                      <ThT label="Cuadrilla" campo="cuadrilla" orden={ordenT} setOrden={setOrdenT} />
                      <ThT label="Fecha" campo="fecha" orden={ordenT} setOrden={setOrdenT} />
                      <ThT label="Estado" campo="estado" orden={ordenT} setOrden={setOrdenT} />
                      <th className="p-2">Observaciones</th>
                      <th className="p-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tecnicosPagina.map((t, idx) => {
                      const idDoc = `${t.tecnicoId}_${t.fecha}`;
                      const esEditando = !!editando[idDoc];
                      const valor = editando[idDoc] || t;
                      const user = usuarios.find((u) => u.id === t.tecnicoId);
                      const nombre = user ? `${user.nombres} ${user.apellidos}` : t.tecnicoId;
                      const cuad = cuadrillas.find((c) => c.id === t.cuadrillaId)?.nombre || "-";
                      return (
                        <tr key={`${t.tecnicoId}_${idx}`} className={`border-b ${idx % 2 ? "bg-gray-50/50 dark:bg-gray-800/30" : ""} hover:bg-gray-50 dark:hover:bg-gray-800`}>
                          <td className="p-2">{nombre}</td>
                          <td className="p-2">{cuad}</td>
                          <td className="p-2">{t.fecha}</td>
                          <td className="p-2">
                            {esEditando ? (
                              <select value={valor.estado} onChange={(e) => handleEditChange(idDoc, "estado", e.target.value)} className="border px-2 py-1 rounded-md">
                                {["asistencia","falta","suspendida","descanso","descanso medico","vacaciones","recuperacion","asistencia compensada"].map(op => <option key={op} value={op}>{op}</option>)}
                              </select>
                            ) : <EstadoPill estado={t.estado} />}
                          </td>
                          <td className="p-2">
                            {esEditando ? (
                              <input value={valor.observaciones || ""} onChange={(e) => handleEditChange(idDoc, "observaciones", e.target.value)} className="border px-2 py-1 rounded-md" placeholder="Observaciones…" />
                            ) : (t.observaciones || <span className="text-gray-400 italic">Sin observaciones</span>)}
                          </td>
                          <td className="p-2">
                            {puedeEditar ? (
                              esEditando ? (
                                <div className="flex gap-2">
                                  <button onClick={() => guardarCambiosTecnico(t)} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded">Guardar</button>
                                  <button onClick={() => cancelarEdicion(idDoc)} className="border px-3 py-1 rounded hover:bg-gray-50">Cancelar</button>
                                </div>
                              ) : (
                                <button onClick={() => setEditando((prev) => ({ ...prev, [idDoc]: t }))} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded">Editar</button>
                              )
                            ) : (
                              <span className="text-xs text-gray-400">Sin permisos</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination page={pageT} totalPages={totalPagesT} onPage={(p) => setPageT(p)} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Panel lateral Detalle Cuadrilla */}
      {detalleCuadrillaId && (
        <SidePanel onClose={() => setDetalleCuadrillaId(null)} title="Detalle de cuadrilla">
          <CuadrillaDetalle
            cuadrillaId={detalleCuadrillaId}
            cuadrillas={cuadrillas}
            tecnicos={asistenciaTecnicos}
            usuarios={usuarios}
            desde={desde}
            hasta={hasta}
          />
        </SidePanel>
      )}
    </div>
  );
}

/* =========================
   Subcomponentes de UI
========================= */
function ThC({ label, campo, orden, setOrden }) {
  const active = orden.campo === campo;
  const dir = active ? (orden.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className="p-2 cursor-pointer select-none"
      onClick={() => setOrden({ campo, dir: active && orden.dir === "asc" ? "desc" : "asc" })}
      title="Ordenar"
    >
      {label} {dir}
    </th>
  );
}

function ThT({ label, campo, orden, setOrden }) {
  const active = orden.campo === campo;
  const dir = active ? (orden.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className="p-2 cursor-pointer select-none"
      onClick={() => setOrden({ campo, dir: active && orden.dir === "asc" ? "desc" : "asc" })}
      title="Ordenar"
    >
      {label} {dir}
    </th>
  );
}

function Pagination({ page, totalPages, onPage }) {
  return (
    <div className="flex items-center justify-between p-3 border-t">
      <div className="text-xs text-gray-500">
        Página {page} de {totalPages}
      </div>
      <div className="flex gap-2">
        <button
          className="px-2 py-1 text-sm border rounded disabled:opacity-50"
          onClick={() => onPage(1)}
          disabled={page === 1}
        >
          «
        </button>
        <button
          className="px-2 py-1 text-sm border rounded disabled:opacity-50"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Anterior
        </button>
        <button
          className="px-2 py-1 text-sm border rounded disabled:opacity-50"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          Siguiente
        </button>
        <button
          className="px-2 py-1 text-sm border rounded disabled:opacity-50"
          onClick={() => onPage(totalPages)}
          disabled={page === totalPages}
        >
          »
        </button>
      </div>
    </div>
  );
}

function SidePanel({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white dark:bg-gray-900 shadow-2xl p-4 overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-[#30518c]">{title}</h3>
          <button onClick={onClose} className="border px-3 py-1 rounded hover:bg-gray-50">Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CuadrillaDetalle({ cuadrillaId, cuadrillas, tecnicos, usuarios, desde, hasta }) {
  const cuad = cuadrillas.find((c) => c.id === cuadrillaId);
  const tecnicosDelRango = tecnicos.filter((t) => t.cuadrillaId === cuadrillaId && t.fecha >= desde && t.fecha <= hasta);
  const detalle = tecnicosDelRango.map((t) => {
    const u = usuarios.find((uu) => uu.id === t.tecnicoId);
    return {
      nombre: u ? `${u.nombres} ${u.apellidos}` : t.tecnicoId,
      fecha: t.fecha,
      estado: t.estado,
      observaciones: t.observaciones || "",
    };
  });

  const agrupadoPorFecha = detalle.reduce((acc, d) => {
    if (!acc[d.fecha]) acc[d.fecha] = [];
    acc[d.fecha].push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {cuad ? (
        <div className="rounded-xl border p-3">
          <div className="font-semibold">{cuad.nombre}</div>
          <div className="text-xs text-gray-500">Zona: {cuad.zona || "-"} · Tipo: {cuad.tipo || "-"}</div>
        </div>
      ) : (
        <div className="text-sm text-gray-500">Cuadrilla no encontrada</div>
      )}

      <div className="rounded-xl border p-3">
        <div className="font-semibold mb-2">Técnicos en el rango ({desde} → {hasta})</div>
        {Object.keys(agrupadoPorFecha).sort().map((f) => (
          <div key={f} className="mb-3">
            <div className="text-xs font-semibold text-gray-500">{f}</div>
            <ul className="mt-1">
              {agrupadoPorFecha[f].map((d, i) => (
                <li key={`${f}_${i}`} className="flex items-center justify-between border-b py-1">
                  <span>{d.nombre}</span>
                  <span><EstadoPill estado={d.estado} /></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {detalle.length === 0 && <div className="text-sm text-gray-500">Sin registros para este rango.</div>}
      </div>
    </div>
  );
}
