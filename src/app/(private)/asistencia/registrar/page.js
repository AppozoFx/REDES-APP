"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import dayjs from "dayjs";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";

/* =========================
   Helpers de UI
========================= */
const Chip = ({ color = "gray", children }) => {
  const map = {
    green: "bg-green-50 text-green-700 ring-green-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    yellow: "bg-yellow-50 text-yellow-700 ring-yellow-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    gray: "bg-gray-50 text-gray-700 ring-gray-200",
    orange: "bg-orange-50 text-orange-700 ring-orange-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
        map[color] || map.gray
      }`}
    >
      {children}
    </span>
  );
};

const estadoToColor = (estado) => {
  switch ((estado || "").toLowerCase()) {
    case "asistencia":
      return "green";
    case "falta":
      return "red";
    case "suspendida":
      return "orange";
    case "descanso":
      return "yellow";
    case "descanso medico":
      return "indigo";
    case "vacaciones":
      return "blue";
    case "recuperacion":
      return "gray";
    case "asistencia compensada":
      return "blue";
    default:
      return "gray";
  }
};

/* =========================
   Helpers selector Técnicos
========================= */
function ordenarTecnicos(opciones, { asignadosGlobal, zonaPreferida, cuadrillas }) {
  return [...opciones].sort((a, b) => {
    const aAsignado = asignadosGlobal.has(a.id);
    const bAsignado = asignadosGlobal.has(b.id);

    const aCuad = cuadrillas.find(
      (c) => Array.isArray(c.tecnicos) && c.tecnicos.includes(a.id)
    );
    const bCuad = cuadrillas.find(
      (c) => Array.isArray(c.tecnicos) && c.tecnicos.includes(b.id)
    );

    const aMismaZona = aCuad?.zona === zonaPreferida;
    const bMismaZona = bCuad?.zona === zonaPreferida;

    // 1) libres primero
    if (aAsignado !== bAsignado) return aAsignado ? 1 : -1;
    // 2) misma zona primero
    if (aMismaZona !== bMismaZona) return aMismaZona ? -1 : 1;
    // 3) alfabético
    const an = `${a.nombres || ""} ${a.apellidos || ""}`.trim().toLowerCase();
    const bn = `${b.nombres || ""} ${b.apellidos || ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });
}

function TecnicosSelector({
  value = [],
  onChange,
  opciones = [],
  asignadosGlobal,
  cuadrillas,
  zonaPreferida,
  originales = [],
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modoReemplazo, setModoReemplazo] = useState(null); // id técnico a reemplazar

  const ordenadas = useMemo(
    () => ordenarTecnicos(opciones, { asignadosGlobal, zonaPreferida, cuadrillas }),
    [opciones, asignadosGlobal, zonaPreferida, cuadrillas]
  );

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordenadas;
    return ordenadas.filter((t) => {
      const nombre = `${t.nombres || ""} ${t.apellidos || ""}`.toLowerCase();
      return nombre.includes(q);
    });
  }, [ordenadas, query]);

  const toggle = (id) => {
    if (modoReemplazo) {
      // reemplaza idActual por id nuevo
      const nuevo = value.filter((v) => v !== modoReemplazo);
      if (!nuevo.includes(id)) nuevo.push(id);
      onChange(nuevo);
      setModoReemplazo(null);
      setOpen(false);
      return;
    }
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  const quitar = (id) => onChange(value.filter((v) => v !== id));
  const vaciar = () => onChange([]);
  const restaurar = () => onChange([...originales]);

  return (
    <div className="relative">
      {/* Chips seleccionados */}
      <div className="flex flex-wrap gap-1 mb-2">
        {value.length === 0 && (
          <span className="text-xs text-gray-500">Sin técnicos seleccionados</span>
        )}
        {value.map((id) => {
          const t = opciones.find((o) => o.id === id);
          if (!t) return null;
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs ring-1 ring-inset ring-gray-200"
            >
              {t.nombres} {t.apellidos}
              <button
                className="ml-1 text-gray-500 hover:text-red-600"
                onClick={() => quitar(id)}
                title="Quitar"
              >
                ✕
              </button>
              <button
                className="ml-0.5 text-gray-500 hover:text-blue-600"
                onClick={() => {
                  setModoReemplazo(id);
                  setOpen(true);
                }}
                title="Cambiar por…"
              >
                ↺
              </button>
            </span>
          );
        })}
      </div>

      {/* Botones rápidos */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
        >
          {open ? "Cerrar" : "Agregar / Buscar técnicos"}
        </button>
        <button
          onClick={vaciar}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
        >
          Vaciar
        </button>
        {originales?.length > 0 && (
          <button
            onClick={restaurar}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
          >
            Restaurar
          </button>
        )}
        {modoReemplazo && (
          <span className="text-xs text-blue-600">
            Modo reemplazo activo: elige el reemplazo
          </span>
        )}
      </div>

      {/* Popover */}
      {open && (
        <div className="absolute z-20 mt-1 w-[360px] max-h-[280px] overflow-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre…"
            className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
          />

          <ul className="space-y-1">
            {filtradas.length === 0 && (
              <li className="px-2 py-2 text-xs text-gray-500">Sin resultados</li>
            )}
            {filtradas.map((t) => {
              const checked = value.includes(t.id);
              const asignado = asignadosGlobal.has(t.id);
              const cuad = cuadrillas.find(
                (c) => Array.isArray(c.tecnicos) && c.tecnicos.includes(t.id)
              );
              const libre = !asignado || value.includes(t.id); // permitir ver/usar al propio
              return (
                <li
                  key={t.id}
                  className={`flex items-start justify-between gap-2 rounded-md px-2 py-2 text-sm ${
                    libre ? "hover:bg-gray-50" : "opacity-60"
                  }`}
                >
                  <label className="flex items-start gap-2 w-full cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={!libre && !modoReemplazo}
                      onChange={() => toggle(t.id)}
                    />
                    <div>
                      <div className="font-medium">
                        {t.nombres} {t.apellidos}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {cuad
                          ? `Asignado a ${cuad.nombre} · Zona: ${cuad.zona || "-"}`
                          : "Libre"}
                      </div>
                    </div>
                  </label>
                  {modoReemplazo && (
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      onClick={() => toggle(t.id)}
                      title="Reemplazar por este técnico"
                    >
                      Elegir
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* =========================
   Componente principal
========================= */
export default function RegistrarAsistencia() {
  const { userData } = useAuth();
  const [fecha, setFecha] = useState(dayjs().format("YYYY-MM-DD"));
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroGestor, setFiltroGestor] = useState("");
  const [filtroCoordinador, setFiltroCoordinador] = useState("");
  const [asistencias, setAsistencias] = useState({});
  const [cargando, setCargando] = useState(false);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [seleccionados, setSeleccionados] = useState(new Set());

  /* =========================
     Carga inicial
  ========================= */
  useEffect(() => {
    const fetchData = async () => {
      setCargandoInicial(true);
      try {
        const [cuadrillasSnap, usuariosSnap, zonasSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
          getDocs(collection(db, "zonas")),
        ]);

        const usuariosData = usuariosSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        const zonasData = zonasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const cuadrillasData = cuadrillasSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            gestorNombre:
              usuariosData.find((u) => u.id === data.gestor)?.nombres || "",
            coordinadorNombre:
              usuariosData.find((u) => u.id === data.coordinador)?.nombres ||
              "",
          };
        });

        const estadoInicial = {};
        cuadrillasData.forEach((c) => {
          estadoInicial[c.id] = {
            tipo: c.tipo || "Regular",
            zona: c.zona || "",
            tecnicos: Array.isArray(c.tecnicos) ? c.tecnicos : [],
            estado: "asistencia",
            placa: c.placa || "",
            observaciones: "",
          };
        });

        setUsuarios(usuariosData);
        setZonas(zonasData);
        setCuadrillas(cuadrillasData);
        setAsistencias(estadoInicial);
      } finally {
        setCargandoInicial(false);
      }
    };
    fetchData();
  }, []);

  /* =========================
     Filtros y derivados
  ========================= */
  const cuadrillasFiltradas = useMemo(() => {
    const n = (filtroNombre || "").toLowerCase();
    return cuadrillas.filter((c) => {
      const coincideNombre = (c.nombre || "").toLowerCase().includes(n);
      const coincideGestor = filtroGestor ? c.gestorNombre === filtroGestor : true;
      const coincideCoordinador = filtroCoordinador
        ? c.coordinadorNombre === filtroCoordinador
        : true;
      const esActiva = c.estado === "activo";
      return coincideNombre && coincideGestor && coincideCoordinador && esActiva;
    });
  }, [cuadrillas, filtroNombre, filtroGestor, filtroCoordinador]);

  const gestoresUnicos = useMemo(
    () => [...new Set(cuadrillas.map((c) => c.gestorNombre).filter(Boolean))],
    [cuadrillas]
  );
  const coordinadoresUnicos = useMemo(
    () => [
      ...new Set(cuadrillas.map((c) => c.coordinadorNombre).filter(Boolean)),
    ],
    [cuadrillas]
  );

  const tecnicos = useMemo(
    () =>
      usuarios.filter(
        (u) =>
          Array.isArray(u.rol) &&
          u.rol.includes("Técnico") &&
          typeof u.estado_usuario === "string" &&
          u.estado_usuario.trim().toLowerCase() === "activo"
      ),
    [usuarios]
  );

  const tecnicosAsignadosGlobal = useMemo(
    () => new Set(cuadrillas.flatMap((c) => asistencias[c.id]?.tecnicos || [])),
    [cuadrillas, asistencias]
  );

  // Técnicos originales por cuadrilla (para "Restaurar")
  const tecnicosOriginalesPorCuadrilla = useMemo(() => {
    const m = {};
    cuadrillas.forEach((c) => {
      m[c.id] = Array.isArray(c.tecnicos) ? [...c.tecnicos] : [];
    });
    return m;
  }, [cuadrillas]);

  /* =========================
     Cambios de campos
  ========================= */
  const handleChange = (id, field, value) => {
    setAsistencias((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  /* =========================
     Selección y acciones masivas
  ========================= */
  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  };

  const toggleSeleccionTodos = () => {
    setSeleccionados((prev) => {
      if (prev.size === cuadrillasFiltradas.length) return new Set();
      return new Set(cuadrillasFiltradas.map((c) => c.id));
    });
  };

  const aplicarEstadoMasivo = (estado) => {
    if (!estado) return;
    if (seleccionados.size === 0) {
      toast.error("Selecciona al menos una cuadrilla.");
      return;
    }
    setAsistencias((prev) => {
      const next = { ...prev };
      seleccionados.forEach((id) => {
        next[id] = { ...next[id], estado };
      });
      return next;
    });
  };

  const limpiarFiltros = () => {
    setFiltroNombre("");
    setFiltroGestor("");
    setFiltroCoordinador("");
  };

  /* =========================
     Resumen en vivo (sobre filtradas)
  ========================= */
  const resumenVivo = useMemo(() => {
    const acc = {};
    cuadrillasFiltradas.forEach((c) => {
      const e = (asistencias[c.id]?.estado || "asistencia").toLowerCase();
      acc[e] = (acc[e] || 0) + 1;
    });
    const total = cuadrillasFiltradas.length || 1;
    const asistieron = acc["asistencia"] || 0;
    const porcentaje = ((asistieron / total) * 100).toFixed(1);
    return { conteo: acc, porcentaje, total };
  }, [cuadrillasFiltradas, asistencias]);

  /* =========================
     Confirmar y guardar
  ========================= */
  const registrarAsistencia = () => {
    toast.custom((t) => (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 shadow-xl rounded-2xl w-[360px]">
        <h2 className="font-semibold text-lg text-[#30518c] mb-1">
          ¿Confirmar registro?
        </h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Se registrará la asistencia de <b>{cuadrillasFiltradas.length}</b>{" "}
          cuadrilla(s) filtradas.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-4 py-1 rounded-md bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 text-sm"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-1 rounded-md bg-green-600 text-white text-sm hover:bg-green-700"
            onClick={async () => {
              toast.dismiss(t.id);
              const toastId = toast.loading("Registrando asistencia...");
              setCargando(true);
              try {
                await procesarAsistencia(toastId);
              } catch (err) {
                console.error(err);
                toast.error("❌ Error al registrar la asistencia", { id: toastId });
              } finally {
                setCargando(false);
              }
            }}
          >
            Sí, registrar
          </button>
        </div>
      </div>
    ));
  };

  const procesarAsistencia = async (toastId) => {
    if (cuadrillasFiltradas.length === 0) {
      toast.error("No hay cuadrillas activas para registrar");
      return;
    }

    try {
      const resumenEstado = {};
      const tecnicosAsignados = new Set();

      for (const cuadrilla of cuadrillasFiltradas) {
        const asistencia = asistencias[cuadrilla.id];

        await setDoc(
          doc(db, "asistencia_cuadrillas", `${cuadrilla.id}_${fecha}`),
          {
            cuadrillaId: cuadrilla.id,
            nombre: cuadrilla.nombre,
            fecha,
            estado: asistencia.estado,
            tipo: asistencia.tipo,
            zona: asistencia.zona,
            placa: asistencia.placa,
            observaciones: asistencia.observaciones,
            registradoPor: userData?.uid || "",
            modificadoPor: userData?.uid || "",
            gestor: cuadrilla.gestorNombre || "",
            coordinador: cuadrilla.coordinadorNombre || "",
          }
        );

        resumenEstado[asistencia.estado] =
          (resumenEstado[asistencia.estado] || 0) + 1;

        for (const tecnicoId of asistencia.tecnicos || []) {
          tecnicosAsignados.add(tecnicoId);
          await setDoc(doc(db, "asistencia_tecnicos", `${tecnicoId}_${fecha}`), {
            tecnicoId,
            cuadrillaId: cuadrilla.id,
            estado: asistencia.estado,
            fecha,
            registradoPor: userData?.uid || "",
            modificadoPor: userData?.uid || "",
          });
        }
      }

      const tecnicosActivos = usuarios.filter(
        (u) =>
          Array.isArray(u.rol) &&
          u.rol.includes("Técnico") &&
          typeof u.estado_usuario === "string" &&
          u.estado_usuario.trim().toLowerCase() === "activo"
      );

      for (const tecnico of tecnicosActivos) {
        if (!tecnicosAsignados.has(tecnico.id)) {
          resumenEstado["falta"] = (resumenEstado["falta"] || 0) + 1;
          await setDoc(doc(db, "asistencia_tecnicos", `${tecnico.id}_${fecha}`), {
            tecnicoId: tecnico.id,
            cuadrillaId: null,
            estado: "falta",
            fecha,
            registradoPor: userData?.uid || "",
            modificadoPor: userData?.uid || "",
          });
        }
      }

      const totalCuadrillas = cuadrillas.length;
      const asistieron = resumenEstado["asistencia"] || 0;
      const porcentaje = ((asistieron / totalCuadrillas) * 100).toFixed(1);

      toast.dismiss(toastId);
      toast.custom((t) => (
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl border w-[420px]">
          <div className="flex justify-between gap-2">
            <div>
              <h3 className="text-green-600 font-bold">✅ Asistencia registrada</h3>
              <p>
                <strong>Registrado por:</strong>{" "}
                {`${userData?.nombres || ""} ${userData?.apellidos || ""}`}
              </p>
              <p>
                <strong>Fecha:</strong> {fecha}
              </p>
              <p className="mt-2 font-semibold">📋 Resumen:</p>
              <ul className="text-sm">
                {Object.entries(resumenEstado).map(([estado, count]) => (
                  <li key={estado} className="flex items-center gap-2">
                    <Chip color={estadoToColor(estado)}>{estado}</Chip>{" "}
                    <span>× {count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-semibold">
                📊 Porcentaje asistencia: {porcentaje}%
              </p>
            </div>
            <button
              className="bg-red-500 text-white px-3 py-1 rounded h-fit"
              onClick={() => toast.dismiss(t.id)}
            >
              Cerrar
            </button>
          </div>
        </div>
      ));
    } catch (error) {
      console.error(error);
      toast.error("❌ Error al registrar la asistencia", { id: toastId });
    }
  };

  /* =========================
     Render
  ========================= */
  if (cargandoInicial) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div className="h-14 w-full bg-gray-100 dark:bg-gray-900 rounded-xl animate-pulse" />
        <div className="h-[420px] w-full bg-gray-50 dark:bg-gray-900 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Título + Resumen vivo */}
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h2 className="text-2xl font-bold text-[#30518c]">
          Registrar Asistencia - Cuadrillas
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Chip color="green">
            Asistencia: {resumenVivo.conteo["asistencia"] || 0}
          </Chip>
          <Chip color="red">Falta: {resumenVivo.conteo["falta"] || 0}</Chip>
          <Chip color="yellow">Descanso: {resumenVivo.conteo["descanso"] || 0}</Chip>
          <Chip color="blue">
            Vacaciones: {resumenVivo.conteo["vacaciones"] || 0}
          </Chip>
          <Chip color="orange">
            Suspendida: {resumenVivo.conteo["suspendida"] || 0}
          </Chip>
          <Chip color="indigo">
            Desc. Médico: {resumenVivo.conteo["descanso medico"] || 0}
          </Chip>
          <Chip color="gray">Total: {resumenVivo.total}</Chip>
          <Chip color="green">Asist.% {resumenVivo.porcentaje}%</Chip>
        </div>
      </div>

      {/* Toolbar filtros y acciones */}
      <div className="mb-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="px-3 py-2 border rounded-md"
            />
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Buscar cuadrilla..."
              value={filtroNombre}
              onChange={(e) => setFiltroNombre(e.target.value)}
              className="px-3 py-2 border rounded-md"
            />
            <select
              value={filtroGestor}
              onChange={(e) => setFiltroGestor(e.target.value)}
              className="px-3 py-2 border rounded-md"
            >
              <option value="">Todos los Gestores</option>
              {gestoresUnicos.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select
              value={filtroCoordinador}
              onChange={(e) => setFiltroCoordinador(e.target.value)}
              className="px-3 py-2 border rounded-md"
            >
              <option value="">Todos los Coordinadores</option>
              {coordinadoresUnicos.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={limpiarFiltros}
              className="px-3 py-2 rounded-md border hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
            <button
              onClick={registrarAsistencia}
              disabled={cargando}
              className={`px-4 py-2 rounded-md text-white ${
                cargando ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {cargando ? "Registrando..." : "Registrar asistencia"}
            </button>
          </div>
        </div>

        {/* Acciones masivas */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={toggleSeleccionTodos}
            className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
          >
            {seleccionados.size === cuadrillasFiltradas.length
              ? "Quitar selección"
              : "Seleccionar todas (filtradas)"}
          </button>
          <span className="text-sm text-gray-600">
            Seleccionadas: <b>{seleccionados.size}</b>
          </span>
          <span className="mx-2 text-gray-300">|</span>
          <span className="text-sm">Marcar estado:</span>
          {[
            "asistencia",
            "falta",
            "suspendida",
            "descanso",
            "descanso medico",
            "vacaciones",
            "recuperacion",
            "asistencia compensada",
          ].map((e) => (
            <button
              key={e}
              onClick={() => aplicarEstadoMasivo(e)}
              className="px-2.5 py-1.5 rounded-md border text-xs hover:bg-gray-50"
              title={`Aplicar "${e}" a seleccionadas`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {cuadrillasFiltradas.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No hay cuadrillas activas que coincidan con los filtros.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#30518c] text-white text-left sticky top-0 z-10">
                <th className="p-2 w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas"
                    checked={
                      seleccionados.size === cuadrillasFiltradas.length &&
                      cuadrillasFiltradas.length > 0
                    }
                    onChange={toggleSeleccionTodos}
                  />
                </th>
                <th className="p-2">Cuadrilla</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Zona</th>
                <th className="p-2">Técnicos</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Placa</th>
                <th className="p-2">Observaciones</th>
                <th className="p-2">Gestor</th>
                <th className="p-2">Coordinador</th>
              </tr>
            </thead>
            <tbody>
              {cuadrillasFiltradas.map((c, idx) => {
                const a = asistencias[c.id] || {};
                const changed =
                  a.estado !== "asistencia" ||
                  a.observaciones ||
                  (a.placa || "") !== (c.placa || "") ||
                  (a.zona || "") !== (c.zona || "") ||
                  (a.tipo || "Regular") !== (c.tipo || "Regular") ||
                  (Array.isArray(a.tecnicos) &&
                    a.tecnicos.length !==
                      (Array.isArray(c.tecnicos) ? c.tecnicos.length : 0));

                return (
                  <tr
                    key={c.id}
                    className={`border-b ${
                      idx % 2
                        ? "bg-gray-50/50 dark:bg-gray-800/30"
                        : ""
                    } hover:bg-gray-50 dark:hover:bg-gray-800`}
                  >
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={seleccionados.has(c.id)}
                        onChange={() => toggleSeleccion(c.id)}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <div className="flex items-center gap-2">
                        {changed && (
                          <span className="h-4 w-1.5 rounded bg-blue-500" />
                        )}
                        <div>
                          <div className="font-medium">{c.nombre}</div>
                          <div className="text-xs text-gray-500">ID: {c.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 align-top">
                      <select
                        value={a.tipo}
                        onChange={(e) => handleChange(c.id, "tipo", e.target.value)}
                        className="px-2 py-1 border rounded-md"
                      >
                        <option value="Regular">Regular</option>
                        <option value="TOP">TOP</option>
                        <option value="Alto Valor">Alto Valor</option>
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <select
                        value={a.zona}
                        onChange={(e) => handleChange(c.id, "zona", e.target.value)}
                        className="px-2 py-1 border rounded-md min-w-[160px]"
                      >
                        <option value="">— Selecciona zona —</option>
                        {zonas.map((z) => (
                          <option key={z.id} value={z.zona}>
                            {z.zona}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* --- Técnicos (selector mejorado) --- */}
                    <td className="p-2 align-top">
                      <TecnicosSelector
                        value={a.tecnicos || []}
                        onChange={(lista) => handleChange(c.id, "tecnicos", lista)}
                        opciones={tecnicos}
                        asignadosGlobal={tecnicosAsignadosGlobal}
                        cuadrillas={cuadrillas}
                        zonaPreferida={a.zona || c.zona}
                        originales={tecnicosOriginalesPorCuadrilla[c.id] || []}
                      />
                    </td>

                    <td className="p-2 align-top">
                      <div className="flex items-center gap-2">
                        <Chip color={estadoToColor(a.estado)}>{a.estado}</Chip>
                      </div>
                      <select
                        value={a.estado}
                        onChange={(e) => handleChange(c.id, "estado", e.target.value)}
                        className="mt-1 px-2 py-1 border rounded-md"
                      >
                        <option value="asistencia">asistencia</option>
                        <option value="falta">falta</option>
                        <option value="suspendida">suspendida</option>
                        <option value="descanso">descanso</option>
                        <option value="descanso medico">descanso medico</option>
                        <option value="vacaciones">vacaciones</option>
                        <option value="recuperacion">recuperación</option>
                        <option value="asistencia compensada">asistencia compensada</option>
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <input
                        value={a.placa || ""}
                        onChange={(e) => handleChange(c.id, "placa", e.target.value)}
                        className="w-full px-2 py-1 border rounded-md"
                        placeholder="ABC-123"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        value={a.observaciones || ""}
                        onChange={(e) =>
                          handleChange(c.id, "observaciones", e.target.value)
                        }
                        className="w-full px-2 py-1 border rounded-md"
                        placeholder="Observaciones…"
                      />
                    </td>
                    <td className="p-2 align-top">{c.gestorNombre || "-"}</td>
                    <td className="p-2 align-top">{c.coordinadorNombre || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
