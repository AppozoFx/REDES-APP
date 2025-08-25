"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export default function InstalacionesGerencia() {
  const { userData } = useAuth();
  const [instalaciones, setInstalaciones] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [inconcert, setInconcert] = useState([]);
  const [inconcertIndex, setInconcertIndex] = useState(new Map()); // telNorm -> { latest, list[] }

  const [horaActual, setHoraActual] = useState(dayjs());
  const [filtros, setFiltros] = useState({
    fecha: dayjs().format("YYYY-MM-DD"),
    gestor: "",
    coordinador: "",
    cuadrilla: "",
    estado: "",
    alerta: "",
    estadoLlamada: "",
    tramo: "",
    acciones: "" // '', 'con', 'sin' (SOLO registros InConcert)
  });

  // Modal de llamadas InConcert
  const [showICModal, setShowICModal] = useState(false);
  const [icModalData, setIcModalData] = useState({ tel: "", list: [] });

  // Ranking colapsable (por defecto oculto)
  const [mostrarRanking, setMostrarRanking] = useState(false);

  // ---- Helpers de fechas/horas y teléfono ----
  const toISOish = (s) => {
    if (!s) return null;
    const v = String(s).trim();
    if (!v || v.toUpperCase() === "N/A") return null;
    return v.includes(" ") && !v.includes("T") ? v.replace(" ", "T") : v;
  };

  const formatHora = (s) => {
    const iso = toISOish(s);
    if (!iso) return "-";
    const d = dayjs(iso);
    return d.isValid() ? d.format("HH:mm:ss") : "-";
  };

  const normalizePhone = (v) => {
    if (!v) return null;
    const d = String(v).replace(/\D/g, "");
    if (!d) return null;
    return d.slice(-9); // últimos 9 (móviles en Perú)
  };

  const getInstPhone = (inst) =>
    inst.telefono ??
    inst.telefonoCliente ??
    inst.celular ??
    inst.telefonoContacto ??
    null;

  const parseFechaICtoTs = (r) => {
    const cands = [
      r?.inicioLlamadaInconcert,
      r?.entraLlamadaInconcert,
      r?.finLlamadaInconcert,
    ].filter(Boolean);
    for (const c of cands) {
      const iso = toISOish(c);
      const d = iso ? dayjs(iso) : null;
      if (d?.isValid()) return d.valueOf();
    }
    return 0;
  };

  // ---- Carga inicial ----
  useEffect(() => {
    const fetchData = async () => {
      const [instSnap, cuadSnap, userSnap, icSnap] = await Promise.all([
        getDocs(collection(db, "instalaciones")),
        getDocs(collection(db, "cuadrillas")),
        getDocs(collection(db, "usuarios")),
        getDocs(collection(db, "inconcert")),
      ]);

      const instalacionesArr = instSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const cuadrillasArr = cuadSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const usuariosArr = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const inconcertArr = icSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Índice: telNorm -> { latest, list[] }
      const mapIdx = new Map();
      for (const r of inconcertArr) {
        const tel = normalizePhone(r.telefonoCliente ?? r._dirCrudo);
        if (!tel) continue;
        const ts = parseFechaICtoTs(r);
        const item = { ...r, _ts: ts };
        const cur = mapIdx.get(tel);
        if (!cur) {
          mapIdx.set(tel, { latest: item, list: [item] });
        } else {
          cur.list.push(item);
          if (ts > (cur.latest?._ts ?? 0)) cur.latest = item;
        }
      }
      for (const [, bucket] of mapIdx) {
        bucket.list.sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0));
      }

      setInstalaciones(instalacionesArr);
      setCuadrillas(cuadrillasArr);
      setUsuarios(usuariosArr);
      setInconcert(inconcertArr);
      setInconcertIndex(mapIdx);
    };
    fetchData();
  }, []);

  // Usuarios por UID
  const mapaUsuarios = {};
  usuarios.forEach(u => {
    if (u.id && (u.nombres || u.apellidos)) {
      const full = [u.nombres, u.apellidos].filter(Boolean).join(" ");
      mapaUsuarios[u.id] = full || u.id;
    }
  });

  useEffect(() => {
    const intervalo = setInterval(() => setHoraActual(dayjs()), 1000);
    return () => clearInterval(intervalo);
  }, []);

  const obtenerNombreTramo = (hora) => {
    switch (hora) {
      case "08:00": return "Primer Tramo";
      case "12:00": return "Segundo Tramo";
      case "16:00": return "Tercer Tramo";
      default: return hora || "-";
    }
  };

  // Instalaciones + cruce con InConcert (latest por teléfono)
  const instalacionesConInconcert = useMemo(() => {
    return instalaciones.map(inst => {
      const tel = getInstPhone(inst);
      const telNorm = normalizePhone(tel);
      const bucket = telNorm ? inconcertIndex.get(telNorm) : null;
      const latest = bucket?.latest ?? null;
      return {
        ...inst,
        _telefono: tel ?? "-",
        _telNorm: telNorm,
        _icLatest: latest,
        _icList: bucket?.list ?? []
      };
    });
  }, [instalaciones, inconcertIndex]);

  // ===== ACCIÓN (SOLO registros InConcert) =====
  const tieneAccion = (inst) => Array.isArray(inst?._icList) && inst._icList.length > 0;

  // -------------------
  // Filtros
  // -------------------
  const fueraDeToleranciaEnCamino = (inst) => {
    if (!inst.tramo || !inst.horaEnCamino) return false;
    const horaTramo = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.tramo}`);
    const horaEnCamino = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.horaEnCamino}`, 'YYYY-MM-DD HH:mm');
    return horaEnCamino.isAfter(horaTramo.add(15, 'minute'));
  };

  const sinGestionTotal = (inst) => !inst.horaEnCamino && !inst.horaInicio && !inst.horaFin;

  const coincideConFiltros = (inst, { omitirGestor = false } = {}) => {
    let fechaInst = "";
    if (inst.fechaInstalacion) {
      if (typeof inst.fechaInstalacion === "string") {
        fechaInst = dayjs(inst.fechaInstalacion).format("YYYY-MM-DD");
      } else if (typeof inst.fechaInstalacion.toDate === "function") {
        fechaInst = dayjs(inst.fechaInstalacion.toDate()).format("YYYY-MM-DD");
      }
    }

    const fechaCoincide = fechaInst === filtros.fecha;
    const gestorCoincide = omitirGestor || filtros.gestor === "" || inst.gestorCuadrilla === filtros.gestor;
    const tramoCoincide = filtros.tramo === "" || inst.tramo === filtros.tramo;

    const cuadrillaCoincide =
      filtros.cuadrilla === "" ||
      (inst.cuadrillaNombre?.toLowerCase().includes(filtros.cuadrilla.toLowerCase())) ||
      (inst.cuadrilla?.toLowerCase().includes(filtros.cuadrilla.toLowerCase()));

    const estadoCoincide = filtros.estado === "" || inst.estado === filtros.estado;

    const alertaCoincide =
      filtros.alerta === "" ||
      (filtros.alerta === "tolerancia" && fueraDeToleranciaEnCamino(inst)) ||
      (filtros.alerta === "sinaction" && sinGestionTotal(inst));

    const estadoLlamadaCoincide =
      filtros.estadoLlamada === "" ||
      (filtros.estadoLlamada === "noLlamo" && !inst.estadoLlamada) ||
      inst.estadoLlamada === filtros.estadoLlamada;

    // Acciones SOLO por registros IC
    const accionesCoincide =
      filtros.acciones === "" ||
      (filtros.acciones === "con" && tieneAccion(inst)) ||
      (filtros.acciones === "sin" && !tieneAccion(inst));

    const coordinadorCoincide = filtros.coordinador === "" || inst.coordinadorCuadrilla === filtros.coordinador;

    return (
      fechaCoincide &&
      gestorCoincide &&
      cuadrillaCoincide &&
      estadoCoincide &&
      coordinadorCoincide &&
      alertaCoincide &&
      estadoLlamadaCoincide &&
      tramoCoincide &&
      accionesCoincide
    );
  };

  // Listas filtradas
  const instalacionesFiltradas = useMemo(
    () => instalacionesConInconcert.filter((inst) => coincideConFiltros(inst)),
    [instalacionesConInconcert, filtros]
  );

  // Ranking por gestoras (omite el filtro “gestor”, respeta los demás)
  const instalacionesParaRanking = useMemo(
    () => instalacionesConInconcert.filter((inst) => coincideConFiltros(inst, { omitirGestor: true })),
    [instalacionesConInconcert, filtros]
  );

  const gestoresUnicos = useMemo(() => (
    [...new Set(instalacionesConInconcert.map(i => i.gestorCuadrilla).filter(Boolean))]
      .map(uid => ({ uid, nombre: mapaUsuarios[uid] || uid }))
  ), [instalacionesConInconcert, mapaUsuarios]);

  const coordinadoresUnicos = useMemo(() => (
    [...new Set(instalacionesConInconcert.map(i => i.coordinadorCuadrilla).filter(Boolean))]
      .map(uid => ({ uid, nombre: mapaUsuarios[uid] || uid }))
  ), [instalacionesConInconcert, mapaUsuarios]);

  // KPIs (SOLO IC)
  const totalFueraTolerancia = instalacionesFiltradas.filter(fueraDeToleranciaEnCamino).length;
  const totalSinGestion = instalacionesFiltradas.filter(sinGestionTotal).length;
  const totalConAccion = instalacionesFiltradas.filter(tieneAccion).length;
  const totalSinAccion = instalacionesFiltradas.length - totalConAccion;
  const pctConAccion = instalacionesFiltradas.length
    ? Math.round((totalConAccion / instalacionesFiltradas.length) * 100)
    : 0;

  // ======= RESUMEN POR GESTOR (RANKING) =======
  const resumenPorGestor = useMemo(() => {
    const mapa = new Map();
    for (const inst of instalacionesParaRanking) {
      const key = inst.gestorCuadrilla || "—";
      const nombre = mapaUsuarios[key] || "—";
      if (!mapa.has(key)) {
        mapa.set(key, { gestor: key, nombre, total: 0, con: 0, sin: 0, pct: 0 });
      }
      const agg = mapa.get(key);
      agg.total += 1;
      if (tieneAccion(inst)) agg.con += 1;
      else agg.sin += 1;
      mapa.set(key, agg);
    }
    const arr = Array.from(mapa.values()).map(r => ({
      ...r,
      pct: r.total ? Math.round((r.con * 100) / r.total) : 0
    }));
    arr.sort((a, b) => (b.pct - a.pct) || (b.con - a.con));
    return arr;
  }, [instalacionesParaRanking, mapaUsuarios]);

  // Exportación (agrega hoja de “Cumplimiento por Gestor”)
  const exportarExcel = () => {
    const data = instalacionesFiltradas.map(inst => ({
      Fecha: inst.fechaInstalacion?.toDate
        ? dayjs(inst.fechaInstalacion.toDate()).format("YYYY-MM-DD")
        : inst.fechaInstalacion || "",
      Cliente: inst.cliente,
      CódigoCliente: inst.codigoCliente,
      Documento: inst.documento,
      Teléfono: inst._telefono || "",
      Cuadrilla: inst.cuadrillaNombre || inst.cuadrilla || "",
      TipoServicio: inst.tipoServicio,
      Tramo: obtenerNombreTramo(inst.tramo),
      Estado: inst.estado,
      HoraEnCamino: inst.horaEnCamino || "-",
      HoraInicio: inst.horaInicio || "-",
      HoraFin: inst.horaFin || "-",
      Gestor: mapaUsuarios[inst.gestorCuadrilla] || "-",
      EstadoLlamada: inst.estadoLlamada || "-", // referencial
      InicioLlamada: inst.horaInicioLlamada || "-",
      FinLlamada: inst.horaFinLlamada || "-",
      ObservacionLlamada: inst.observacionLlamada || "-",
      INC_Usuario: inst._icLatest?.usuaruioInconcert || "",
      INC_Inicio: formatHora(inst._icLatest?.inicioLlamadaInconcert),
      INC_Entra: formatHora(inst._icLatest?.entraLlamadaInconcert),
      INC_Fin: formatHora(inst._icLatest?.finLlamadaInconcert),
      INC_Duración: inst._icLatest?.duracion || "",
      INC_BO: inst._icLatest?.bo || "",
      INC_Observación: inst._icLatest?.observacionInconcert || "",
      TieneAccionIC: tieneAccion(inst) ? "Sí" : "No",
    }));
    const wsDetalle = XLSX.utils.json_to_sheet(data);

    const dataRanking = resumenPorGestor.map(r => ({
      GestorUID: r.gestor,
      Gestor: r.nombre,
      Total: r.total,
      ConLlamadas: r.con,
      SinLlamadas: r.sin,
      Porcentaje: `${r.pct}%`
    }));
    const wsRanking = XLSX.utils.json_to_sheet(dataRanking);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Reporte Gerencia");
    XLSX.utils.book_append_sheet(wb, wsRanking, "Cumplimiento por Gestor");

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, `REPORTE-GERENCIA-${dayjs().format("YYYY-MM-DD_HH-mm-ss")}.xlsx`);
  };

  // Abrir modal de intentos InConcert
  const abrirModalIC = (inst) => {
    setIcModalData({
      tel: inst._telefono || "-",
      list: inst._icList || []
    });
    setShowICModal(true);
  };

  // Toggle rápido “Solo sin llamadas” — SOLO IC
  const toggleSoloSinLlamadas = () => {
    setFiltros(prev => ({
      ...prev,
      acciones: prev.acciones === "sin" ? "" : "sin",
    }));
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-[#0f172a] text-gray-900 dark:text-slate-100">
      <h2 className="text-2xl font-bold text-center text-[#30518c]">Instalaciones - Gerencia</h2>
      <p className="text-center text-shadow-md">
        <span className="text-[#30518c] font-bold text-2xl tracking-widest">
          🕒 Hora actual: {horaActual.format("HH:mm:ss")}
        </span>
      </p>

      {/* Encabezado superior (no sticky, para simplificar alturas) */}
      <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-center text-gray-700 mt-4 mb-2">
        <div className="bg-gray-100 dark:bg-gray-800 dark:text-white px-3 py-2 rounded">Total: {instalacionesFiltradas.length}</div>
        <div className="bg-gray-100 dark:bg-gray-800 dark:text-white px-3 py-2 rounded">📌 Fuera de tolerancia: {totalFueraTolerancia}</div>
        <div className="bg-gray-100 dark:bg-gray-800 dark:text-white px-3 py-2 rounded">🛠️ Sin gestión: {totalSinGestion}</div>
        <div className="bg-gray-100 dark:bg-gray-800 dark:text-white px-3 py-2 rounded">🎯 Con llamadas: {totalConAccion}</div>
        <div className="bg-gray-100 dark:bg-gray-800 dark:text-white px-3 py-2 rounded">🗒️ Sin llamadas: {totalSinAccion}</div>
      </div>

      {/* Barra % Con llamadas */}
      <div className="mx-auto w-full max-w-5xl px-4 mb-4">
        <div className="flex items-center justify-between text-xs font-semibold mb-1">
          <span className="text-gray-700 dark:text-slate-200">Porcentaje con llamadas (registros IC)</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMostrarRanking(!mostrarRanking)}
              className="px-3 py-1.5 rounded bg-[#30518c] text-white hover:bg-[#24406d] transition"
            >
              {mostrarRanking ? "⬆️ Ocultar cumplimiento por gestoras" : "⬇️ Mostrar cumplimiento por gestoras"}
            </button>
            <span className="text-[#30518c] dark:text-blue-300">{pctConAccion}% ({totalConAccion}/{instalacionesFiltradas.length || 0})</span>
          </div>
        </div>
        <div className="w-full h-3 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#30518c] to-[#ff6413] transition-all duration-500"
            style={{ width: `${pctConAccion}%` }}
          />
        </div>
      </div>

      {/* Ranking por gestora (colapsable) */}
      {mostrarRanking && (
        <div className="mx-auto w-full max-w-5xl px-4 mt-2 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm md:text-base">🏆 Cumplimiento por Gestora (respeta filtros, excepto “Gestor”)</h3>
            <span className="text-xs text-gray-500">
              Tramo: <b>{filtros.tramo ? obtenerNombreTramo(filtros.tramo) : "Todos"}</b> • Fecha: <b>{filtros.fecha}</b>
            </span>
          </div>

          {resumenPorGestor.length === 0 ? (
            <div className="text-xs text-gray-500">No hay datos para el ranking con los filtros actuales.</div>
          ) : (
            <div className="space-y-2">
              {resumenPorGestor.map((g) => (
                <div key={g.gestor} className="p-3 rounded-lg border bg-white dark:bg-slate-800 dark:border-slate-700">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{g.nombre}</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700">
                        {g.con}/{g.total} con llamadas
                      </span>
                    </div>
                    <span className="font-bold text-[#30518c]">{g.pct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#16a34a] to-[#60a5fa] transition-all duration-500"
                      style={{ width: `${g.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-center text-sm text-gray-700 mt-1 mb-4">
        <p><span className="text-red-700 font-bold">📌 Fuera de tolerancia</span> : Pasado 15 minutos de inicio de tramo</p>
        <p><span className="text-red-900 font-bold">💤 Sin gestión</span> : Sin gestión</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-4 justify-center mb-4 px-4">
        <input
          type="date"
          value={filtros.fecha}
          onChange={(e) => setFiltros({ ...filtros, fecha: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        />

        <select
          value={filtros.gestor}
          onChange={(e) => setFiltros({ ...filtros, gestor: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todos los gestores</option>
          {gestoresUnicos.map(g => (
            <option key={g.uid} value={g.uid}>{g.nombre}</option>
          ))}
        </select>

        <select
          value={filtros.coordinador}
          onChange={(e) => setFiltros({ ...filtros, coordinador: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todos los coordinadores</option>
          {coordinadoresUnicos.map(c => (
            <option key={c.uid} value={c.uid}>{c.nombre}</option>
          ))}
        </select>

        <select
          value={filtros.tramo}
          onChange={(e) => setFiltros({ ...filtros, tramo: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todos los tramos</option>
          <option value="08:00">Primer Tramo</option>
          <option value="12:00">Segundo Tramo</option>
          <option value="16:00">Tercer Tramo</option>
        </select>

        <select
          value={filtros.estado}
          onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todos los estados</option>
          <option value="Agendada">Agendada</option>
          <option value="En camino">En camino</option>
          <option value="Cancelada">Cancelada</option>
          <option value="Finalizada">Finalizada</option>
          <option value="Reprogramada">Reprogramada</option>
          <option value="Iniciada">Iniciada</option>
          <option value="Regestión">Regestión</option>
        </select>

        <select
          value={filtros.estadoLlamada}
          onChange={(e) => setFiltros({ ...filtros, estadoLlamada: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todos los estados de llamada</option>
          <option value="Contesto">Contesto</option>
          <option value="No Contesto">No Contesto</option>
          <option value="No se Registro">No se Registro</option>
          <option value="noLlamo">📞 No se llamó</option>
        </select>

        {/* Filtro Acciones (con/sin llamadas) — SOLO IC */}
        <select
          value={filtros.acciones}
          onChange={(e) => setFiltros({ ...filtros, acciones: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
          title="Filtra instalaciones con o sin llamadas (según registros InConcert)"
        >
          <option value="">Acciones: Todas</option>
          <option value="con">Acciones: Con llamadas</option>
          <option value="sin">Acciones: Sin llamadas</option>
        </select>

        <select
          value={filtros.alerta}
          onChange={(e) => setFiltros({ ...filtros, alerta: e.target.value })}
          className="px-4 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Todas las alertas</option>
          <option value="tolerancia">📌 Fuera de tolerancia</option>
          <option value="sinaction">💤 Sin gestión</option>
        </select>

        <input
          list="lista-cuadrillas"
          type="text"
          placeholder="Buscar cuadrilla..."
          value={filtros.cuadrilla}
          onChange={(e) => setFiltros({ ...filtros, cuadrilla: e.target.value })}
          className="px-4 py-2 border rounded-md"
        />
        <datalist id="lista-cuadrillas">
          {[...new Set(instalaciones.map(i => i.cuadrillaNombre).filter(Boolean))].map((nombre, idx) => (
            <option key={idx} value={nombre} />
          ))}
        </datalist>

        <button
          onClick={exportarExcel}
          className="px-4 py-2 bg-[#30518c] text-white rounded-md hover:bg-[#24406d] transition dark:bg-blue-900 dark:hover:bg-blue-800"
        >
          📥 Exportar a Excel
        </button>

        {/* Botón rápido: Solo sin llamadas (SOLO IC) */}
        <button
          onClick={toggleSoloSinLlamadas}
          className={`px-4 py-2 rounded-md border transition ${
            filtros.acciones === "sin"
              ? "bg-red-600 text-white border-red-700 hover:bg-red-700"
              : "bg-white dark:bg-slate-800 text-red-700 border-red-400 hover:bg-red-50 dark:hover:bg-slate-700"
          }`}
          title="Mostrar solo instalaciones sin llamadas (sin registros InConcert)"
        >
          🚫 Solo sin llamadas
        </button>
      </div>

      {/* ⬇️ CONTENEDOR DE SCROLL DE LA TABLA + THEAD STICKY top-0 */}
      <div className="relative max-h-[70vh] overflow-y-auto">
        <table className="w-full text-xs md:text-sm border">
          <thead className="sticky top-0 z-20 bg-[#30518c] dark:bg-blue-900 text-white shadow">
            <tr>
              {[
                'Cliente','Código','Documento','Teléfono','Cuadrilla','Tipo Servicio','Tramo','Estado',
                'En Camino','Inicio','Fin','Gestor','Estado Llamada','Inicio Llamada','Fin Llamada','Observación',
                'INC Usuario','INC Inicio','INC Entra','INC Fin','INC Duración','INC BO','INC Observación',
                'Acciones'
              ].map(col => (
                <th key={col} className="p-2 whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instalacionesFiltradas.map(inst => (
              <tr key={inst.id} className={`border-b ${tieneAccion(inst) ? "" : "bg-yellow-50 dark:bg-yellow-900/20"}`}>
                <td className="p-2">{inst.cliente}</td>
                <td className="p-2">{inst.codigoCliente}</td>
                <td className="p-2">{inst.documento}</td>
                <td className="p-2">{inst._telefono || '-'}</td>
                <td className="p-2">{inst.cuadrillaNombre || inst.cuadrilla || "-"}</td>
                <td className="p-2">{inst.tipoServicio}</td>
                <td className="p-2">{obtenerNombreTramo(inst.tramo)}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded-full text-xs border border-gray-300
                    ${inst.estado === "Cancelada" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "Iniciada" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "En camino" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "Finalizada" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "Reprogramada" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "Agendada" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                    ${inst.estado === "Regestión" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" : ""}
                  `}>
                    {inst.estado || "-"}
                  </span>
                </td>

                <td className={`p-2 text-center ${
                  (!inst.horaEnCamino && !inst.horaInicio && !inst.horaFin)
                    ? 'bg-red-200 text-red-900 font-bold'
                    : (inst.horaEnCamino && !(() => {
                        const horaTramo = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.tramo}`);
                        const horaEnCamino = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.horaEnCamino}`, 'YYYY-MM-DD HH:mm');
                        return horaEnCamino.isAfter(horaTramo.add(15, 'minute'));
                      })())
                    ? 'bg-green-100 text-green-800 font-bold'
                    : (inst.horaEnCamino)
                    ? 'bg-red-100 text-red-700 font-bold'
                    : ''
                }`}>
                  {inst.horaEnCamino || '-'}
                  {(!inst.horaEnCamino && !inst.horaInicio && !inst.horaFin) && <span title="Sin gestión"> ⚠️</span>}
                </td>

                <td className="p-2">{inst.horaInicio || '-'}</td>
                <td className="p-2">{inst.horaFin || '-'}</td>
                <td className="p-2">{mapaUsuarios[inst.gestorCuadrilla] || "-"}</td>
                <td className="p-2">{inst.estadoLlamada || '-'}</td>
                <td className="p-2">{inst.horaInicioLlamada || '-'}</td>
                <td className="p-2">{inst.horaFinLlamada || '-'}</td>
                <td className="p-2">{inst.observacionLlamada || '-'}</td>

                {/* InConcert (último registro) */}
                <td className="p-2">{inst._icLatest?.usuaruioInconcert || '-'}</td>
                <td className="p-2">{formatHora(inst._icLatest?.inicioLlamadaInconcert)}</td>
                <td className="p-2">{formatHora(inst._icLatest?.entraLlamadaInconcert)}</td>
                <td className="p-2">{formatHora(inst._icLatest?.finLlamadaInconcert)}</td>
                <td className="p-2">{inst._icLatest?.duracion || '-'}</td>
                <td className="p-2">{inst._icLatest?.bo || '-'}</td>
                <td className="p-2">{inst._icLatest?.observacionInconcert || '-'}</td>

                {/* Acciones */}
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => abrirModalIC(inst)}
                      disabled={!inst._icList?.length}
                      className={`px-2 py-1 rounded text-white disabled:opacity-50 ${
                        inst._icList?.length ? "bg-indigo-700" : "bg-indigo-400"
                      }`}
                      title={inst._icList?.length ? "Ver llamadas InConcert" : "Sin llamadas"}
                    >
                      Ver llamadas ({inst._icList?.length || 0})
                    </button>
                    <span
                      className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
                        tieneAccion(inst)
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                      }`}
                      title={tieneAccion(inst) ? "Con llamadas" : "Sin llamadas"}
                    >
                      {tieneAccion(inst) ? "Con llamadas" : "Sin llamadas"}
                    </span>
                  </div>
                </td>
              </tr>
            ))}

            {instalacionesFiltradas.length === 0 && (
              <tr>
                <td colSpan={23} className="text-center py-4 text-gray-500 dark:text-gray-400">
                  No hay resultados con los filtros aplicados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal InConcert */}
      {showICModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-5xl w-full mx-4">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Llamadas InConcert — Tel: <span className="font-mono">{icModalData.tel}</span>
              </h3>
              <button
                onClick={() => setShowICModal(false)}
                className="px-3 py-1 rounded bg-gray-700 text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="p-4 overflow-auto max-h-[70vh]">
              <table className="w-full text-xs md:text-sm border">
                <thead className="bg-gray-100 dark:bg-slate-800">
                  <tr>
                    {[
                      'Usuario','Inicio (h)','Entra (h)','Fin (h)',
                      'Duración','Espera','Timbrado','Atención',
                      'BO','Observación'
                    ].map(col => (
                      <th key={col} className="p-2 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(icModalData.list || []).map((r) => (
                    <tr key={r.id ?? `${r._ts}-${r.telefonoCliente ?? ''}`} className="border-b">
                      <td className="p-2">{r.usuaruioInconcert || '-'}</td>
                      <td className="p-2">{formatHora(r.inicioLlamadaInconcert)}</td>
                      <td className="p-2">{formatHora(r.entraLlamadaInconcert)}</td>
                      <td className="p-2">{formatHora(r.finLlamadaInconcert)}</td>
                      <td className="p-2">{r.duracion || '-'}</td>
                      <td className="p-2">{r.espera || '-'}</td>
                      <td className="p-2">{r.timbrado || '-'}</td>
                      <td className="p-2">{r.atencion || '-'}</td>
                      <td className="p-2">{r.bo || '-'}</td>
                      <td className="p-2">{r.observacionInconcert || '-'}</td>
                    </tr>
                  ))}

                  {!icModalData.list?.length && (
                    <tr>
                      <td colSpan={10} className="text-center p-4 text-gray-500">Sin llamadas</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t text-right">
              <button
                onClick={() => setShowICModal(false)}
                className="px-4 py-2 rounded bg-indigo-600 text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
