"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

/* =========================
   Utilidades
========================= */

// Rango ISO en UTC para un día YYYY-MM-DD (tu fechaInstalacion es string ISO con Z)
function isoDayRangeUTC(ymd) {
  const start = dayjs.utc(`${ymd}T00:00:00.000Z`).toISOString();
  const end = dayjs.utc(`${ymd}T23:59:59.999Z`).toISOString();
  return [start, end];
}

// Formatea a YYYY-MM-DD tanto strings ISO (con Z) como Timestamps
function safeDateToYMD(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const isISOZ = /Z$/i.test(v);
    const d = isISOZ ? dayjs.utc(v).local() : dayjs(v);
    return d.isValid() ? d.format("YYYY-MM-DD") : "";
  }
  if (typeof v?.toDate === "function") {
    return dayjs(v.toDate()).format("YYYY-MM-DD");
  }
  return "";
}

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

// Debounce simple para inputs intensivos
function useDebouncedValue(value, delay = 300) {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// Estilos visuales del toast según estado de llamada
const estadoStyles = (estado) => {
  switch (estado) {
    case "Contesto":
      return "border-green-200 bg-green-50 dark:border-green-700/50 dark:bg-green-900/30";
    case "No Contesto":
      return "border-orange-200 bg-orange-50 dark:border-orange-700/50 dark:bg-orange-900/30";
    case "No se Registro":
    default:
      return "border-gray-200 bg-gray-50 dark:border-gray-700/50 dark:bg-gray-900/40";
  }
};

/* =========================
   Componente
========================= */

export default function InstalacionesGestor() {
  const { userData } = useAuth();

  // Estado base
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [instalaciones, setInstalaciones] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  const [horaActual, setHoraActual] = useState(dayjs().format("HH:mm:ss"));

  // Filtros
  const filtrosIniciales = {
    fecha: dayjs().format("YYYY-MM-DD"),
    cliente: "",
    gestor: "",
    tramo: "",
    estado: "",
    coordinador: "",
    cuadrilla: "",
    estadoLlamada: "",
  };
  const [filtros, setFiltros] = useState(filtrosIniciales);

  // Helpers de filtros
  const clienteDeb = useDebouncedValue(filtros.cliente);
  const cuadrillaDeb = useDebouncedValue(filtros.cuadrilla);

  // Edición
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({});
  const tablaRef = useRef(null);

  // Reloj visible
  useEffect(() => {
    const i = setInterval(() => setHoraActual(dayjs().format("HH:mm:ss")), 1000);
    return () => clearInterval(i);
  }, []);

  // Cargar usuarios y cuadrillas (una vez)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [cuadSnap, userSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
        ]);
        if (!mounted) return;
        setCuadrillas(cuadSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setUsuarios(userSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
        setErrorMsg("No se pudieron cargar usuarios/cuadrillas.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Suscripción en vivo a instalaciones del día (fechaInstalacion es string ISO con Z)
  useEffect(() => {
    setLoading(true);
    setErrorMsg("");

    const [startISO, endISO] = isoDayRangeUTC(filtros.fecha);
    const qInst = query(
      collection(db, "instalaciones"),
      where("fechaInstalacion", ">=", startISO),
      where("fechaInstalacion", "<=", endISO),
      orderBy("fechaInstalacion", "asc")
    );

    const unsub = onSnapshot(
      qInst,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInstalaciones(rows);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setErrorMsg("No se pudieron cargar instalaciones del día (tiempo real).");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [filtros.fecha]);

  // Mapas de usuarios
  const mapaCoordinadores = useMemo(() => {
    const m = {};
    for (const u of usuarios) {
      if (u.id && u.nombres && u.apellidos) {
        m[u.id] = `${u.nombres} ${u.apellidos}`;
      }
    }
    return m;
  }, [usuarios]);

  const mapaGestores = useMemo(() => {
    const m = {};
    for (const u of usuarios) {
      if (u.rol?.includes?.("Gestor")) {
        m[u.id] = `${u.nombres ?? ""} ${u.apellidos ?? ""}`.trim() || u.id;
      }
    }
    return m;
  }, [usuarios]);

  const gestoresUnicos = useMemo(() => {
    const setU = new Set(instalaciones.map((i) => i.gestorCuadrilla).filter(Boolean));
    return Array.from(setU).map((uid) => ({ uid, nombre: mapaGestores[uid] || uid }));
  }, [instalaciones, mapaGestores]);

  const coordinadoresUnicos = useMemo(() => {
    const setU = new Set(instalaciones.map((i) => i.coordinadorCuadrilla).filter(Boolean));
    return Array.from(setU).map((uid) => ({ uid, nombre: mapaCoordinadores[uid] || uid }));
  }, [instalaciones, mapaCoordinadores]);

  const obtenerNombreTramo = (hora) => {
    switch (hora) {
      case "08:00":
        return "Primer Tramo";
      case "12:00":
        return "Segundo Tramo";
      case "16:00":
        return "Tercer Tramo";
      default:
        return hora || "-";
    }
  };

  // Filtrado client-side
  const instalacionesFiltradas = useMemo(() => {
    const cli = clienteDeb.toLowerCase();
    const cuad = (cuadrillaDeb || "").toLowerCase();
    const { gestor, tramo, estado, coordinador, estadoLlamada } = filtros;

    return instalaciones.filter((i) => {
      const clienteCoincide = cli === "" || i.cliente?.toLowerCase().includes(cli);
      const gestorCoincide = gestor === "" || i.gestorCuadrilla === gestor;
      const tramoCoincide = tramo === "" || i.tramo === tramo;
      const estadoCoincide = estado === "" || i.estado === estado;
      const coordinadorCoincide =
        coordinador === "" ||
        (i.coordinadorCuadrilla || "").toLowerCase().includes(coordinador.toLowerCase());
      const cuadrillaCoincide =
        cuad === "" ||
        i.cuadrillaNombre?.toLowerCase().includes(cuad) ||
        i.cuadrilla?.toLowerCase().includes(cuad);
      const estadoLlamadaCoincide =
        estadoLlamada === "" ||
        (estadoLlamada === "noLlamo" && !i.estadoLlamada) ||
        i.estadoLlamada === estadoLlamada;

      return (
        clienteCoincide &&
        gestorCoincide &&
        tramoCoincide &&
        estadoCoincide &&
        coordinadorCoincide &&
        cuadrillaCoincide &&
        estadoLlamadaCoincide
      );
    });
  }, [instalaciones, filtros, clienteDeb, cuadrillaDeb]);

  // Contadores (del día en vivo)
  const {
    totalInstalacionesDelDia,
    totalNoLlamo,
    totalContesto,
    totalNoContesto,
    totalNoRegistro,
  } = useMemo(() => {
    const total = instalaciones.length;
    const noLlamo = instalaciones.filter((i) => !i.estadoLlamada).length;
    const contesto = instalaciones.filter((i) => i.estadoLlamada === "Contesto").length;
    const noContesto = instalaciones.filter((i) => i.estadoLlamada === "No Contesto").length;
    const noRegistro = instalaciones.filter((i) => i.estadoLlamada === "No se Registro").length;
    return {
      totalInstalacionesDelDia: total,
      totalNoLlamo: noLlamo,
      totalContesto: contesto,
      totalNoContesto: noContesto,
      totalNoRegistro: noRegistro,
    };
  }, [instalaciones]);

  // Paginación simple
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(instalacionesFiltradas.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [
    clienteDeb,
    cuadrillaDeb,
    filtros.gestor,
    filtros.tramo,
    filtros.estado,
    filtros.coordinador,
    filtros.estadoLlamada,
  ]);

  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return instalacionesFiltradas.slice(start, start + pageSize);
  }, [instalacionesFiltradas, page]);

  // Limpiar filtros
  const limpiarFiltros = () => {
    setFiltros(filtrosIniciales);
    setPage(1);
    setEditandoId(null);
    setForm({});
  };

  // Guardar (optimista) + Notificación elegante + registro en "notificaciones"
  const handleGuardar = async (id) => {
    if (!form.estadoLlamada) {
      toast.error("El campo Estado Llamada es obligatorio");
      return;
    }
    const payload = {
      horaInicioLlamada: form.horaInicioLlamada || "",
      horaFinLlamada: form.horaFinLlamada || "",
      estadoLlamada: form.estadoLlamada || "",
      observacionLlamada: form.observacionLlamada || "",
      modificadoPor: userData?.nombres || userData?.email || userData?.uid || "sistema",
      ultimaModificacion: new Date(),
      telefono: form.telefono || "",
    };

    // Optimista
    setInstalaciones((prev) => prev.map((i) => (i.id === id ? { ...i, ...payload } : i)));

    try {
      await updateDoc(doc(db, "instalaciones", id), payload);

      // Construcción de datos para toast y notificación
      const usuarioTxt =
        [userData?.nombres, userData?.apellidos].filter(Boolean).join(" ") ||
        userData?.email ||
        "—";
      const instActual = instalaciones.find((i) => i.id === id) || {};

      const clienteTxt = form.cliente || form.clienteNombre || instActual.cliente || "-";
      const tramoTxt = obtenerNombreTramo(form.tramo || instActual.tramo || "-");
      const cuadrillaTxt =
        form.cuadrillaNombre || form.cuadrilla || instActual.cuadrillaNombre || instActual.cuadrilla || "-";
      const observacionTxt = form.observacionLlamada || "-";
      const estadoTxt = form.estadoLlamada || "-";

      const estadoInst = form.estado ?? instActual.estado ?? "-";
      const codigoCliente = form.codigoCliente ?? instActual.codigoCliente ?? "-";
      const telefono = form.telefono ?? instActual.telefono ?? "-";

      // Toast elegante con color por estado de llamada
      toast.custom(
        (t) => (
          <div
            className={`max-w-md w-full rounded-lg shadow-lg p-4 border
                        ${estadoStyles(estadoTxt)}
                        ${t.visible ? "animate-enter" : "animate-leave"}`}
          >
            <div className="text-sm font-semibold text-[#30518c] mb-1">
              Gestión de Instalación
            </div>
            <div className="text-sm text-gray-800 dark:text-gray-100 leading-5 space-y-1">
              👤 <b>{usuarioTxt}</b> gestionó al cliente <b>{clienteTxt}</b><br />
              📞 Estado de llamada: <b>{estadoTxt}</b><br />
              📅 Tramo: {tramoTxt}<br />
              📋 Estado instalación: <b>{estadoInst}</b><br />
              🆔 Código Cliente: {codigoCliente}<br />
              ☎️ Teléfono: {telefono}<br />
              👷 Cuadrilla: {cuadrillaTxt}<br />
              📝 Observación: {observacionTxt}
            </div>
          </div>
        ),
        { duration: 6000 }
      );

      // Registrar notificación en Firestore (compatible con la campana)
await addDoc(collection(db, "notificaciones"), {
  tipo: "Gestión Instalación",
  mensaje: `🛎️ ${usuarioTxt} gestionó al cliente ${clienteTxt} | Estado Llamada: ${estadoTxt} | Estado Instalación: ${estadoInst} | Código Cliente: ${codigoCliente} | Teléfono: ${telefono} | Tramo: ${tramoTxt} | Cuadrilla: ${cuadrillaTxt} | Obs: ${observacionTxt}`,
  usuario: usuarioTxt,
  fecha: serverTimestamp(), // importante para orden por fecha en campana
  detalles: {
    cliente: clienteTxt,
    estadoLlamada: estadoTxt,
    estadoInstalacion: estadoInst,
    tramo: tramoTxt,
    cuadrilla: cuadrillaTxt,
    codigoCliente,
    telefono,
    instalacionId: id,
    observacion: observacionTxt,
  },
  visto: false,
});


      setEditandoId(null);
    } catch (e) {
      console.error(e);
      toast.error("Error al guardar");
      // onSnapshot actualizará con el estado real
    }
  };

  // Atajos de teclado en edición
  useEffect(() => {
    function onKey(e) {
      if (!editandoId) return;
      if (e.key === "Enter") {
        handleGuardar(editandoId);
      } else if (e.key === "Escape") {
        setEditandoId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editandoId]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-[#0f172a] text-gray-900 dark:text-gray-100">
      {/* Header y filtros */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur dark:bg-[#0f0f0f]/80 border-b border-gray-200 dark:border-gray-800">
        <div className="px-4 pt-4">
          <h2 className="text-2xl md:text-3xl font-bold text-[#30518c] text-center">
            Llamadas de INCONCERT
          </h2>
          <div className="flex flex-col items-center gap-1 pb-2">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              * Horario en formato <strong>24 horas</strong> (Ej: 14:30)
            </p>
            <p className="text-sm">
              <span className="text-[#30518c] font-bold text-xl tracking-widest">
                🕒 {horaActual}
              </span>
            </p>
          </div>

          {/* Contadores */}
          <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-center mb-3">
            <div className="px-3 py-2 rounded bg-gray-100 dark:bg-gray-800">
              Total del día: {totalInstalacionesDelDia}
            </div>
            <div className="px-3 py-2 rounded bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-200">
              📞 No se llamó: {totalNoLlamo}
            </div>
            <div className="px-3 py-2 rounded bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-200">
              ✅ Contestó: {totalContesto}
            </div>
            <div className="px-3 py-2 rounded bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-200">
              ❌ No contestó: {totalNoContesto}
            </div>
            <div className="px-3 py-2 rounded bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100">
              📋 No se registró: {totalNoRegistro}
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
            <input
              type="date"
              value={filtros.fecha}
              onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            />

            <input
              type="text"
              placeholder="Buscar cliente…"
              value={filtros.cliente}
              onChange={(e) => setFiltros((f) => ({ ...f, cliente: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 w-44"
            />

            <select
              value={filtros.tramo}
              onChange={(e) => setFiltros((f) => ({ ...f, tramo: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            >
              <option value="">Todos los tramos</option>
              <option value="08:00">Primer Tramo</option>
              <option value="12:00">Segundo Tramo</option>
              <option value="16:00">Tercer Tramo</option>
            </select>

            <select
              value={filtros.coordinador}
              onChange={(e) => setFiltros((f) => ({ ...f, coordinador: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            >
              <option value="">Todos los coordinadores</option>
              {coordinadoresUnicos.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.nombre}
                </option>
              ))}
            </select>

            <select
              value={filtros.estado}
              onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
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
              value={filtros.gestor}
              onChange={(e) => setFiltros((f) => ({ ...f, gestor: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            >
              <option value="">Todos los gestores</option>
              {gestoresUnicos.map((g) => (
                <option key={g.uid} value={g.uid}>
                  {g.nombre}
                </option>
              ))}
            </select>

            <input
              list="lista-cuadrillas"
              type="text"
              placeholder="Buscar cuadrilla…"
              value={filtros.cuadrilla}
              onChange={(e) => setFiltros((f) => ({ ...f, cuadrilla: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 w-44"
            />
            <datalist id="lista-cuadrillas">
              {[...new Set(instalaciones.map((i) => i.cuadrillaNombre).filter(Boolean))].map(
                (nombre, idx) => (
                  <option key={idx} value={nombre} />
                )
              )}
            </datalist>

            <select
              value={filtros.estadoLlamada}
              onChange={(e) => setFiltros((f) => ({ ...f, estadoLlamada: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            >
              <option value="">Todos los estados de llamada</option>
              <option value="Contesto">Contesto</option>
              <option value="No Contesto">No Contesto</option>
              <option value="No se Registro">No se Registro</option>
              <option value="noLlamo">📞 No se llamó</option>
            </select>

            {/* Botón Limpiar filtros (elegante) */}
            <button
              type="button"
              onClick={limpiarFiltros}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
                         bg-gradient-to-r from-[#30518c] to-[#ff6413]
                         text-white font-semibold shadow-md hover:shadow-lg
                         transition-all duration-150 active:scale-[0.98]
                         focus:outline-none focus:ring-4 focus:ring-[#30518c]/30"
              aria-label="Limpiar filtros"
              title="Limpiar filtros"
            >
              <span className="text-sm">Limpiar filtros</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M3 4h18v2H3zM8 9h8l-3 4v5l-2 2v-7z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto" ref={tablaRef}>
        {errorMsg && (
          <div className="m-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-700 dark:bg-red-950 dark:text-red-200">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-300">
            Cargando instalaciones…
          </div>
        ) : (
          <div className="min-w-[1200px]">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead className="bg-[#30518c] dark:bg-blue-900 text-white text-sm font-semibold sticky top-0 z-[1]">
                <tr>
                  {[
                    "Cliente",
                    "Código",
                    "Documento",
                    "Plan",
                    "Dirección",
                    "Teléfono",
                    "Cuadrilla",
                    "Gestor",
                    "Tipo Servicio",
                    "Tramo",
                    "Estado",
                    "Inicio Llamada",
                    "Fin Llamada",
                    "Estado Llamada",
                    "Observación",
                    "Acciones",
                  ].map((col) => (
                    <th key={col} className="p-2 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageData.map((inst) => {
                  const isEditing = editandoId === inst.id;
                  return (
                    <tr
                      key={inst.id}
                      className="border-b hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    >
                      <td className="p-2 whitespace-normal max-w-[260px]">
                        {inst.cliente}
                      </td>
                      <td className="p-2">{inst.codigoCliente}</td>
                      <td className="p-2">{inst.documento}</td>
                      <td className="p-2">{inst.plan}</td>
                      <td className="p-2 whitespace-normal max-w-[260px]">
                        {inst.direccion}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="text"
                            value={form.telefono ?? inst.telefono ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, telefono: e.target.value }))
                            }
                            className="border border-black/20 px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.telefono || "-"
                        )}
                      </td>
                      <td className="p-2 whitespace-normal max-w-[200px]">
                        {inst.cuadrillaNombre || inst.cuadrilla || "-"}
                      </td>
                      <td className="p-2 whitespace-normal max-w-[200px]">
                        {mapaGestores[inst.gestorCuadrilla] || "-"}
                      </td>
                      <td className="p-2">{inst.tipoServicio || "-"}</td>
                      <td className="p-2">{obtenerNombreTramo(inst.tramo)}</td>
                      <td className="p-2">
                        <span
                          className={classNames(
                            "px-2 py-1 rounded-full text-xs",
                            inst.estado === "Cancelada" &&
                              "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
                            inst.estado === "Finalizada" &&
                              "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                            !["Cancelada", "Finalizada"].includes(inst.estado) &&
                              "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                          )}
                        >
                          {inst.estado || "-"}
                        </span>
                      </td>

                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="time"
                            value={form.horaInicioLlamada ?? inst.horaInicioLlamada ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                horaInicioLlamada: e.target.value,
                              }))
                            }
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.horaInicioLlamada || "-"
                        )}
                      </td>

                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="time"
                            value={form.horaFinLlamada ?? inst.horaFinLlamada ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                horaFinLlamada: e.target.value,
                              }))
                            }
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.horaFinLlamada || "-"
                        )}
                      </td>

                      <td className="p-2">
                        {isEditing ? (
                          <select
                            value={form.estadoLlamada ?? inst.estadoLlamada ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, estadoLlamada: e.target.value }))
                            }
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          >
                            <option value="">--</option>
                            <option value="Contesto">Contesto</option>
                            <option value="No Contesto">No Contesto</option>
                            <option value="No se Registro">No se Registro</option>
                          </select>
                        ) : (
                          inst.estadoLlamada || "-"
                        )}
                      </td>

                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={form.observacionLlamada ?? inst.observacionLlamada ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                observacionLlamada: e.target.value,
                              }))
                            }
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.observacionLlamada || "-"
                        )}
                      </td>

                      <td className="p-2 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleGuardar(inst.id)}
                              className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={() => setEditandoId(null)}
                              className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-1 rounded"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditandoId(inst.id);
                              // Inicializamos form para edición y para el toast/registro
                              setForm({
                                telefono: inst.telefono || "",
                                horaInicioLlamada: inst.horaInicioLlamada || "",
                                horaFinLlamada: inst.horaFinLlamada || "",
                                estadoLlamada: inst.estadoLlamada || "",
                                observacionLlamada: inst.observacionLlamada || "",
                                // Para notificación/toast:
                                cliente: inst.cliente || "",
                                tramo: inst.tramo || "",
                                cuadrillaNombre:
                                  inst.cuadrillaNombre || inst.cuadrilla || "",
                                cuadrilla: inst.cuadrilla || "",
                                // Nuevos (para mostrar/guardar):
                                estado: inst.estado || "",
                                codigoCliente: inst.codigoCliente || "",
                              });
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {pageData.length === 0 && (
                  <tr>
                    <td
                      colSpan={16}
                      className="text-center py-6 text-gray-600 dark:text-gray-400"
                    >
                      No hay instalaciones para los filtros seleccionados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!loading && instalacionesFiltradas.length > 0 && (
          <div className="flex items-center justify-center gap-3 py-3">
            <button
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Anterior
            </button>
            <span className="text-sm">
              Página <strong>{page}</strong> de <strong>{totalPages}</strong>
            </span>
            <button
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
