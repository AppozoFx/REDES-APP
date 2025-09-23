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
  limit as fbLimit,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import toast from "react-hot-toast";
dayjs.extend(utc);

/* =========================
   Utilidades
========================= */

// YYYY-MM-DD para string ISO (con/sin Z) o Timestamp
function formatYMD(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const d = /Z$/i.test(v) ? dayjs.utc(v).local() : dayjs(v);
    return d.isValid() ? d.format("YYYY-MM-DD") : "";
  }
  if (typeof v?.toDate === "function") {
    return dayjs(v.toDate()).format("YYYY-MM-DD");
  }
  return "";
}

function toISO(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v?.toDate === "function") return v.toDate().toISOString();
  return "";
}

function toMillis(v) {
  if (!v) return undefined;
  if (typeof v === "string") {
    const d = /Z$/i.test(v) ? dayjs.utc(v).local() : dayjs(v);
    return d.isValid() ? d.valueOf() : undefined;
  }
  if (typeof v?.toDate === "function") {
    return dayjs(v.toDate()).valueOf();
  }
  return undefined;
}

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

// Debounce simple
function useDebouncedValue(value, delay = 300) {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

/* =========================
   Listas de selects
========================= */
const OPC_RESPONSABLE = ["Cuadrilla", "Cliente", "Externo"];
const OPC_CASO = [
  "Cambio de Equipo",
  "Cambio de Conector",
  "Cambio de Roseta",
  "Recableado",
  "Reubicacion",
];
const OPC_IMPUTADO = ["REDES M&D", "WIN"];

/* =========================
   Componente Garantías
========================= */

export default function PaginaGarantias() {
  const { userData } = useAuth();

  // Estado base
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [instalaciones, setInstalaciones] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  // Filtros
  const filtrosIniciales = {
    mes: dayjs().format("YYYY-MM"),
    fecha: "",
    cliente: "", // nombre o código
    estado: "",
    coordinador: "",
    cuadrilla: "",
  };
  const [filtros, setFiltros] = useState(filtrosIniciales);

  // Helpers de filtros
  const clienteDeb = useDebouncedValue(filtros.cliente);
  const cuadrillaDeb = useDebouncedValue(filtros.cuadrilla);

  // Edición
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({});
  const tablaRef = useRef(null);

  // Ordenamiento
  const [sort, setSort] = useState({ field: null, dir: "asc" });
  const toggleSort = (field) =>
    setSort((s) =>
      s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }
    );

  // Cargar usuarios
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const userSnap = await getDocs(collection(db, "usuarios"));
        if (!mounted) return;
        setUsuarios(userSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
        setErrorMsg("No se pudieron cargar usuarios.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Suscripción en vivo a instalaciones del MES seleccionado
  useEffect(() => {
    setLoading(true);
    setErrorMsg("");

    const y = filtros.mes?.slice(0, 4) || dayjs().format("YYYY");
    const m = filtros.mes?.slice(5, 7) || dayjs().format("MM");
    const startMonth = dayjs.utc(`${y}-${m}-01T00:00:00.000Z`).toISOString();
    const endMonth = dayjs.utc(dayjs(`${y}-${m}-01`).endOf("month").toDate()).toISOString();

    const qInst = query(
      collection(db, "instalaciones"),
      where("fechaInstalacion", ">=", startMonth),
      where("fechaInstalacion", "<=", endMonth),
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
        setErrorMsg("No se pudieron cargar las garantías del mes (tiempo real).");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [filtros.mes]);

  // Mapas de usuarios
  const mapaCoordinadores = useMemo(() => {
    const m = {};
    for (const u of usuarios) {
      if (u.id && (u.nombres || u.apellidos)) {
        m[u.id] = `${u.nombres ?? ""} ${u.apellidos ?? ""}`.trim() || u.id;
      }
    }
    return m;
  }, [usuarios]);

  // Filtros base (cliente/código, cuadrilla, coordinador, día)
  const filtraBase = (arr) => {
    const term = (clienteDeb || "").toLowerCase(); // nombre o código
    const cuad = (cuadrillaDeb || "").toLowerCase();
    const { coordinador, fecha } = filtros;

    return arr
      .filter((i) => {
        if (!fecha) return true;
        const ymd = formatYMD(i.fechaInstalacion);
        return ymd === fecha;
      })
      .filter((i) => {
        const byCliente = term === "" || i.cliente?.toLowerCase().includes(term);
        const byCodigo =
          term === "" ||
          (i.codigoCliente ? String(i.codigoCliente).toLowerCase().includes(term) : false);
        const clienteOCodigo = term === "" ? true : byCliente || byCodigo;

        const coordinadorCoincide =
          coordinador === "" || (i.coordinadorCuadrilla || "").includes(coordinador);
        const cuadrillaCoincide =
          cuad === "" ||
          i.cuadrillaNombre?.toLowerCase().includes(cuad) ||
          i.cuadrilla?.toLowerCase().includes(cuad);

        return clienteOCodigo && coordinadorCoincide && cuadrillaCoincide;
      });
  };

  /* =========================
     Caché de F. Instalación (global, fuera del filtro de mes)
     Guardamos { ymd, iso } para escribir en Firestore al guardar
  ========================= */
  const [cacheInstalFinal, setCacheInstalFinal] = useState({}); // key -> {ymd, iso} | "-" 
  const [loadingKey, setLoadingKey] = useState({}); // key -> boolean

  // Usa el índice compuesto (cliente + codigoCliente + estado + fechaInstalacion DESC)
  const ensureRelatedInstallDate = async (codigo, cliente) => {
    const code = codigo ?? "";
    const client = (cliente ?? "").trim();
    const key = `${code}||${client.toLowerCase()}`;
    if (!code || !client) return;

    if (cacheInstalFinal[key] || loadingKey[key]) return;

    try {
      setLoadingKey((s) => ({ ...s, [key]: true }));

      const qRef = query(
        collection(db, "instalaciones"),
        where("cliente", "==", client),
        where("codigoCliente", "==", code),
        where("estado", "==", "Finalizada"),
        orderBy("fechaInstalacion", "desc"),
        fbLimit(10)
      );

      const snap = await getDocs(qRef);
      // Buscar la primera que NO sea garantía
      let ymd = "-";
      let iso = "";
      for (const d of snap.docs) {
        const it = d.data();
        const isGarantia =
          Boolean(it.esGarantia) || (it.tipoServicio || "").toLowerCase().includes("garant");
        if (!isGarantia) {
          iso = toISO(it.fechaInstalacion) || "";
          ymd = formatYMD(iso) || "-";
          break;
        }
      }

      setCacheInstalFinal((m) => ({ ...m, [key]: iso ? { ymd, iso } : "-" }));
    } catch (e) {
      console.error("fetch related install date", e);
      setCacheInstalFinal((m) => ({ ...m, [key]: "-" }));
    } finally {
      setLoadingKey((s) => ({ ...s, [key]: false }));
    }
  };

  // Solo garantías (según filtros)
  const garantiasFiltradas = useMemo(() => {
    const soloGarantias = instalaciones.filter((i) => {
      const ts = (i.tipoServicio || "").toLowerCase();
      const esGarantiaFlag = Boolean(i.esGarantia);
      return esGarantiaFlag || ts.includes("garant");
    });
    return filtraBase(soloGarantias).filter((i) => filtros.estado === "" || i.estado === filtros.estado);
  }, [instalaciones, filtros, clienteDeb, cuadrillaDeb]);

  // Denominador: FINALIZADAS sin garantía (mismos filtros base)
  const totalFinalizadasSinGarantia = useMemo(() => {
    const sinGarantias = instalaciones.filter((i) => {
      const ts = (i.tipoServicio || "").toLowerCase();
      const esGarantiaFlag = Boolean(i.esGarantia);
      return !esGarantiaFlag && !ts.includes("garant");
    });
    return filtraBase(sinGarantias).filter((i) => i.estado === "Finalizada").length;
  }, [instalaciones, filtros, clienteDeb, cuadrillaDeb]);

  // % Garantías
  const porcentajeGarantias = useMemo(() => {
    const num = garantiasFiltradas.length;
    const den = totalFinalizadasSinGarantia;
    if (!den) return 0;
    return (num / den) * 100;
  }, [garantiasFiltradas.length, totalFinalizadasSinGarantia]);

  // Ordenamiento
  const getSortValue = (inst, field) => {
    switch (field) {
      case "fgarantia":
        return toMillis(inst.fechaInstalacion) ?? -Infinity;
      case "plan":
        return inst.plan ?? "";
      case "direccion":
        return inst.direccion ?? "";
      case "cuadrilla":
        return inst.cuadrillaNombre ?? inst.cuadrilla ?? "";
      case "tipoServicio":
        return inst.tipoServicio ?? "";
      case "motivoCancelacion":
        return inst.motivoCancelacion ?? "";
      case "estado":
        return inst.estado ?? "";
      case "motivo":
        return inst.motivoGarantia ?? "";
      case "diagnostico":
        return inst.diagnosticoGarantia ?? "";
      case "solucion":
        return inst.solucionGarantia ?? "";
      case "responsable":
        return inst.responsableGarantia ?? "";
      case "caso":
        return inst.casoGarantia ?? "";
      case "imputado":
        return inst.imputadoGarantia ?? "";
      default:
        return "";
    }
  };

  const garantiasOrdenadas = useMemo(() => {
    const arr = [...garantiasFiltradas];
    if (!sort.field) return arr;
    arr.sort((a, b) => {
      const va = getSortValue(a, sort.field);
      const vb = getSortValue(b, sort.field);
      const na = typeof va === "number";
      const nb = typeof vb === "number";
      if (na && nb) return va - vb;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    });
    if (sort.dir === "desc") arr.reverse();
    return arr;
  }, [garantiasFiltradas, sort]);

  // Paginación
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(garantiasOrdenadas.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [clienteDeb, cuadrillaDeb, filtros.estado, filtros.coordinador, filtros.fecha, sort]);

  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return garantiasOrdenadas.slice(start, start + pageSize);
  }, [garantiasOrdenadas, page]);

  // Precargar F. Instalación SOLO para filas visibles
  useEffect(() => {
    for (const inst of pageData) {
      const code = inst.codigoCliente ?? "";
      const client = inst.cliente ?? "";
      const key = `${code}||${client.toLowerCase()}`;
      if (!cacheInstalFinal[key] && !loadingKey[key]) {
        ensureRelatedInstallDate(code, client);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageData]);

  // Limpiar filtros
  const limpiarFiltros = () => {
    setFiltros(filtrosIniciales);
    setPage(1);
    setEditandoId(null);
    setForm({});
    setSort({ field: null, dir: "asc" });
  };

  // Guardar (optimista) + persistir fechaInstalacionBase y diasDesdeInstalacion
  const handleGuardar = async (id) => {
    // Buscar fila actual
    const inst = instalaciones.find((x) => x.id === id);
    const codigo = inst?.codigoCliente ?? "";
    const cliente = inst?.cliente ?? "";
    const garantiaISO = toISO(inst?.fechaInstalacion) || ""; // ISO de la garantía

    // Asegurar que tenemos la fecha base
    const key = `${codigo}||${(cliente || "").toLowerCase()}`;
    let base = cacheInstalFinal[key];
    if (!base || base === "-") {
      // intenta obtenerla al vuelo
      await ensureRelatedInstallDate(codigo, cliente);
      base = cacheInstalFinal[key];
    }

    // Calcular días
    let diasDesdeInstalacion = null;
    let fechaInstalacionBase = "";
    if (base && base !== "-" && base.iso) {
      fechaInstalacionBase = base.iso;
      if (garantiaISO) {
        const diff = dayjs(garantiaISO).diff(dayjs(fechaInstalacionBase), "day");
        diasDesdeInstalacion = Math.max(0, diff);
      }
    }

    const payload = {
      motivoGarantia: (form.motivoGarantia ?? "").trim(),
      diagnosticoGarantia: (form.diagnosticoGarantia ?? "").trim(),
      solucionGarantia: (form.solucionGarantia ?? "").trim(),
      responsableGarantia: form.responsableGarantia ?? "",
      casoGarantia: form.casoGarantia ?? "",
      imputadoGarantia: form.imputadoGarantia ?? "",
      // Nuevos campos para dashboard:
      fechaInstalacionBase: fechaInstalacionBase || "", // ISO ("" si no se encontró)
      diasDesdeInstalacion: diasDesdeInstalacion ?? null, // number | null
      modificadoPor: userData?.nombres || userData?.email || userData?.uid || "sistema",
      ultimaModificacion: new Date(),
    };

    // Optimista
    setInstalaciones((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...payload } : i))
    );

    try {
      await updateDoc(doc(db, "instalaciones", id), payload);
      toast.success("Garantía actualizada");
      setEditandoId(null);
    } catch (e) {
      console.error(e);
      toast.error("Error al guardar");
    }
  };

  // Atajos de teclado en edición
  useEffect(() => {
    function onKey(e) {
      if (!editandoId) return;
      if (e.key === "Enter") handleGuardar(editandoId);
      else if (e.key === "Escape") setEditandoId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editandoId]);

  // UI helpers de header con orden
  const Header = ({ label, field }) => {
    const active = sort.field === field;
    const arrow = !active ? "↕" : sort.dir === "asc" ? "▲" : "▼";
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={classNames("flex items-center gap-1 select-none", "transition-colors hover:text-yellow-200")}
        title="Ordenar"
      >
        <span>{label}</span>
        <span className="text-[10px]">{arrow}</span>
      </button>
    );
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-[#0f172a] text-gray-900 dark:text-gray-100">
      {/* Header y filtros */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur dark:bg-[#0f0f0f]/80 border-b border-gray-200 dark:border-gray-800">
        <div className="px-4 pt-4">
          <h2 className="text-2xl md:text-3xl font-bold text-[#30518c] text-center">
            Garantías (vista y edición)
          </h2>

          {/* Contadores */}
          <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-center mb-1 mt-2">
            <div className="px-3 py-2 rounded bg-gray-100 dark:bg-gray-800">
              Total del mes (garantías): {garantiasOrdenadas.length}
            </div>
          </div>

          {/* Indicador % Garantías */}
          <div className="flex justify-center mb-3">
            <div className="text-sm rounded-lg px-3 py-2 border bg-white/70 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700">
              % Garantías (sobre finalizadas sin garantía):{" "}
              <b>
                {porcentajeGarantias.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                %
              </b>{" "}
              <span className="text-xs text-gray-500 ml-2">
                ({garantiasFiltradas.length} / {totalFinalizadasSinGarantia || 0})
              </span>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
            <input
              type="month"
              value={filtros.mes}
              onChange={(e) => setFiltros((f) => ({ ...f, mes: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            />
            <input
              type="date"
              value={filtros.fecha}
              onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            />
            <input
              type="text"
              placeholder="Buscar cliente o código…"
              value={filtros.cliente}
              onChange={(e) => setFiltros((f) => ({ ...f, cliente: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600 w-56"
            />
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
                (nombre, idx) => <option key={idx} value={nombre} />
              )}
            </datalist>

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
              value={filtros.coordinador}
              onChange={(e) => setFiltros((f) => ({ ...f, coordinador: e.target.value }))}
              className="px-3 py-2 border rounded-md bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
            >
              <option value="">Todos los coordinadores</option>
              {Array.from(new Set(instalaciones.map((i) => i.coordinadorCuadrilla).filter(Boolean))).map(
                (uid) => (
                  <option key={uid} value={uid}>
                    {mapaCoordinadores[uid] || uid}
                  </option>
                )
              )}
            </select>

            <button
              type="button"
              onClick={limpiarFiltros}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#30518c] to-[#ff6413] text-white font-semibold shadow-md hover:shadow-lg transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-[#30518c]/30"
              aria-label="Limpiar filtros"
              title="Limpiar filtros"
            >
              <span className="text-sm">Limpiar filtros</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
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
            Cargando garantías…
          </div>
        ) : (
          <div className="min-w-[1500px]">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead className="bg-[#30518c] dark:bg-blue-900 text-white text-sm font-semibold sticky top-0 z-[1]">
                <tr>
                  <th className="p-2 whitespace-nowrap">
                    <Header label="F. Garantía / Cliente / Código / F. Instalación" field="fgarantia" />
                  </th>
                  <th className="p-2 whitespace-nowrap"><Header label="Plan" field="plan" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Dirección" field="direccion" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Cuadrilla" field="cuadrilla" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Tipo/Servicio" field="tipoServicio" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Motivo Cancelación" field="motivoCancelacion" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Estado" field="estado" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Motivo" field="motivo" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Diagnóstico" field="diagnostico" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Solución" field="solucion" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Responsable" field="responsable" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Caso" field="caso" /></th>
                  <th className="p-2 whitespace-nowrap"><Header label="Imputado" field="imputado" /></th>
                  <th className="p-2 whitespace-nowrap">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {pageData.map((inst) => {
                  const isEditing = editandoId === inst.id;
                  const fGarantia = formatYMD(inst.fechaInstalacion) || "-";
                  const key = `${inst.codigoCliente ?? ""}||${(inst.cliente ?? "").toLowerCase()}`;
                  const base = cacheInstalFinal[key];
                  const fInstal = base && base !== "-" ? base.ymd : (loadingKey[key] ? "…" : "-");

                  // DÍAS transcurridos = F. Garantía - F. Instalación (clamp >= 0)
                  let dias = loadingKey[key] ? "…" : "-";
                  if (fGarantia !== "-" && base && base !== "-" && base.iso) {
                    const diff = dayjs(toISO(inst.fechaInstalacion)).diff(dayjs(base.iso), "day");
                    dias = Math.max(0, diff);
                  }

                  return (
                    <tr key={inst.id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      {/* Columna compuesta */}
                      <td className="p-2 whitespace-normal max-w-[380px] leading-5">
                        <div><b>F. Garantía:</b> {fGarantia}</div>
                        <div><b>Cliente:</b> {inst.cliente || "-"}</div>
                        <div><b>Código:</b> {inst.codigoCliente || "-"}</div>
                        <div><b>F. Instalación:</b> {fInstal}</div>
                        <div><b>Días:</b> {dias}</div>
                      </td>

                      <td className="p-2 whitespace-normal max-w-[200px]">{inst.plan || "-"}</td>
                      <td className="p-2 whitespace-normal max-w-[260px]">{inst.direccion || "-"}</td>
                      <td className="p-2 whitespace-normal max-w-[200px]">
                        {inst.cuadrillaNombre || inst.cuadrilla || "-"}
                      </td>
                      <td className="p-2">{inst.tipoServicio || "-"}</td>
                      <td className="p-2 whitespace-normal max-w-[220px]">{inst.motivoCancelacion || "-"}</td>

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

                      {/* Motivo Garantía */}
                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={form.motivoGarantia ?? inst.motivoGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, motivoGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.motivoGarantia || "-"
                        )}
                      </td>

                      {/* Diagnóstico */}
                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={form.diagnosticoGarantia ?? inst.diagnosticoGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, diagnosticoGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.diagnosticoGarantia || "-"
                        )}
                      </td>

                      {/* Solución */}
                      <td className="p-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={form.solucionGarantia ?? inst.solucionGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, solucionGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          />
                        ) : (
                          inst.solucionGarantia || "-"
                        )}
                      </td>

                      {/* Responsable (select) */}
                      <td className="p-2">
                        {isEditing ? (
                          <select
                            value={form.responsableGarantia ?? inst.responsableGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, responsableGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          >
                            <option value="">--</option>
                            {OPC_RESPONSABLE.map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                        ) : (
                          inst.responsableGarantia || "-"
                        )}
                      </td>

                      {/* Caso (select) */}
                      <td className="p-2">
                        {isEditing ? (
                          <select
                            value={form.casoGarantia ?? inst.casoGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, casoGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          >
                            <option value="">--</option>
                            {OPC_CASO.map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                        ) : (
                          inst.casoGarantia || "-"
                        )}
                      </td>

                      {/* Imputado (select) */}
                      <td className="p-2">
                        {isEditing ? (
                          <select
                            value={form.imputadoGarantia ?? inst.imputadoGarantia ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, imputadoGarantia: e.target.value }))}
                            className="border px-2 py-1 rounded w-full bg-white dark:bg-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                          >
                            <option value="">--</option>
                            {OPC_IMPUTADO.map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                        ) : (
                          inst.imputadoGarantia || "-"
                        )}
                      </td>

                      {/* Acciones */}
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
                              setForm({
                                motivoGarantia: inst.motivoGarantia || "",
                                diagnosticoGarantia: inst.diagnosticoGarantia || "",
                                solucionGarantia: inst.solucionGarantia || "",
                                responsableGarantia: inst.responsableGarantia || "",
                                casoGarantia: inst.casoGarantia || "",
                                imputadoGarantia: inst.imputadoGarantia || "",
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
                    <td colSpan={14} className="text-center py-6 text-gray-600 dark:text-gray-400">
                      No hay garantías para los filtros seleccionados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!loading && garantiasOrdenadas.length > 0 && (
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
