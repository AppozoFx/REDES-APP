"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";

/* =========================
   Mini UI Helpers (solo estilos)
========================= */
const Toolbar = ({ children }) => (
  <div className="mb-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
    {children}
  </div>
);

const Chip = ({ color = "slate", children }) => {
  const map = {
    green: "bg-green-100 text-green-700 ring-green-200 dark:bg-green-900/20 dark:text-green-300 dark:ring-green-800/50",
    red: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800/50",
    slate:
      "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800/40 dark:text-slate-200 dark:ring-slate-700",
    indigo:
      "bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:ring-indigo-800/50",
    orange:
      "bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:ring-orange-800/50",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${map[color]}`}>
      {children}
    </span>
  );
};

const IconBtn = ({ onClick, children, variant = "primary", className = "", ...rest }) => {
  const styles = {
    primary:
      "bg-[#30518c] hover:bg-[#274271] text-white shadow-sm",
    ghost:
      "bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200",
    success:
      "bg-emerald-600 hover:bg-emerald-700 text-white",
    cancel:
      "bg-slate-700 hover:bg-slate-800 text-white",
  };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

const SkeletonRow = () => (
  <tr className="animate-pulse">
    {Array.from({ length: 9 }).map((_, i) => (
      <td key={i} className="p-3">
        <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
      </td>
    ))}
  </tr>
);

export default function TecnicosPage() {
  const [tecnicos, setTecnicos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({});
  const [cargando, setCargando] = useState(true);

  // Cargar técnicos y cuadrillas (misma lógica)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setCargando(true);
        const snapUsuarios = await getDocs(collection(db, "usuarios"));
        const snapCuadrillas = await getDocs(collection(db, "cuadrillas"));

        const tecnicosData = snapUsuarios.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => Array.isArray(u.rol) && u.rol.includes("Técnico"));

        const cuadrillasData = snapCuadrillas.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        setTecnicos(tecnicosData);
        setCuadrillas(cuadrillasData);
      } catch (e) {
        console.error(e);
        toast.error("No se pudo cargar la información.");
      } finally {
        setCargando(false);
      }
    };
    fetchData();
  }, []);

  // Filtro por nombre/apellido (misma idea, con memo)
  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return tecnicos;
    return tecnicos.filter((t) =>
      `${t.nombres || ""} ${t.apellidos || ""}`.toLowerCase().includes(q)
    );
  }, [tecnicos, filtro]);

  const getCuadrillaAsignada = (tecnicoId) => {
    const c = cuadrillas.find(
      (c) => Array.isArray(c.tecnicos) && c.tecnicos.includes(tecnicoId)
    );
    return c?.nombre || "-";
  };

  const handleEditar = (tecnico) => {
    setEditandoId(tecnico.id);
    setForm({
      celular: tecnico.celular || "",
      estado_usuario: tecnico.estado_usuario || "activo",
    });
  };

  const handleCancelar = () => {
    setEditandoId(null);
    setForm({});
  };

  const handleGuardar = async (id) => {
    try {
      const ref = doc(db, "usuarios", id);
      await updateDoc(ref, {
        celular: form.celular,
        estado_usuario: form.estado_usuario,
      });

      setTecnicos((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, celular: form.celular, estado_usuario: form.estado_usuario }
            : t
        )
      );

      setEditandoId(null);
      setForm({});
      toast.success("✅ Datos actualizados correctamente");
    } catch (error) {
      toast.error("❌ Error al guardar cambios");
      console.error("Error al guardar:", error);
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#30518c] leading-tight">Técnicos</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Gestiona la información básica de tu equipo técnico.
          </p>
        </div>
        <Chip color="indigo">
          Total: {tecnicos.length}
        </Chip>
      </div>

      {/* Toolbar */}
      <Toolbar>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <input
              type="text"
              placeholder="Buscar por nombre…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-10 py-2.5 text-sm text-slate-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-orange-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400"
              xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
            >
              <path fillRule="evenodd" d="M10 4a6 6 0 014.472 9.966l4.28 4.281a1 1 0 01-1.414 1.414l-4.281-4.28A6 6 0 1110 4zm0 2a4 4 0 100 8 4 4 0 000-8z" clipRule="evenodd"/>
            </svg>
            {filtro && (
              <button
                onClick={() => setFiltro("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <IconBtn
              variant="ghost"
              onClick={() => window.location.reload()}
              title="Recargar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 6V3L8 7l4 4V8a4 4 0 11-4 4H6a6 6 0 106-6z"/></svg>
              Recargar
            </IconBtn>
          </div>
        </div>
      </Toolbar>

      {/* Tabla */}
      <div className="relative flex-1 overflow-hidden">
        <div className="h-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-[#30518c] text-white dark:bg-[#1e3a8a]">
                <th className="p-3 text-left font-semibold">DNI/CE</th>
                <th className="p-3 text-left font-semibold">Nombres</th>
                <th className="p-3 text-left font-semibold">Apellidos</th>
                <th className="p-3 text-left font-semibold">Celular</th>
                <th className="p-3 text-left font-semibold">Email</th>
                <th className="p-3 text-left font-semibold">Fecha Nac.</th>
                <th className="p-3 text-left font-semibold">Estado</th>
                <th className="p-3 text-left font-semibold">Cuadrilla Asignada</th>
                <th className="p-3 text-left font-semibold">Acciones</th>
              </tr>
            </thead>

            <tbody className="[&>tr:nth-child(even)]:bg-slate-50/60 dark:[&>tr:nth-child(even)]:bg-slate-800/30">
              {cargando &&
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={`sk-${i}`} />)}

              {!cargando && filtrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 00-7 7v3.586l-1.707 1.707A1 1 0 004 16h16a1 1 0 00.707-1.707L19 12.586V9a7 7 0 00-7-7zM7 20a1 1 0 100 2h10a1 1 0 100-2H7z"/></svg>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No se encontraron técnicos con ese criterio.
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!cargando &&
                filtrados.map((t) => {
                  const cuadrilla = getCuadrillaAsignada(t.id);
                  const estado = t.estado_usuario || "sin estado";
                  const estadoColor =
                    estado === "activo" ? "green" : estado === "inactivo" ? "red" : "slate";

                  return (
                    <tr key={t.id} className="border-b border-slate-100 hover:bg-orange-50/40 dark:border-slate-800 dark:hover:bg-slate-800/40">
                      <td className="p-3">{t.dni_ce || "-"}</td>
                      <td className="p-3">{t.nombres || "-"}</td>
                      <td className="p-3">{t.apellidos || "-"}</td>
                      <td className="p-3">
                        {editandoId === t.id ? (
                          <input
                            value={form.celular}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, celular: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        ) : (
                          t.celular || "-"
                        )}
                      </td>
                      <td className="p-3">
                        <span className="block max-w-[220px] truncate" title={t.email || "-"}>
                          {t.email || "-"}
                        </span>
                      </td>
                      <td className="p-3">{t.fecha_nacimiento || "-"}</td>
                      <td className="p-3">
                        {editandoId === t.id ? (
                          <select
                            value={form.estado_usuario}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, estado_usuario: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value="activo">activo</option>
                            <option value="inactivo">inactivo</option>
                          </select>
                        ) : (
                          <Chip color={estadoColor}>{estado}</Chip>
                        )}
                      </td>
                      <td className="p-3">
                        {cuadrilla !== "-" ? (
                          <Chip color="orange">{cuadrilla}</Chip>
                        ) : (
                          <Chip>{cuadrilla}</Chip>
                        )}
                      </td>
                      <td className="p-3">
                        {editandoId === t.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <IconBtn variant="success" onClick={() => handleGuardar(t.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17l-3.88-3.88a1 1 0 10-1.42 1.42l4.59 4.59a1 1 0 001.41 0l10.59-10.6a1 1 0 10-1.41-1.41L9 16.17z"/></svg>
                              Guardar
                            </IconBtn>
                            <IconBtn variant="cancel" onClick={handleCancelar}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6.225 4.811a1 1 0 00-1.414 1.414L10.586 12l-5.775 5.775a1 1 0 101.414 1.414L12 13.414l5.775 5.775a1 1 0 001.414-1.414L13.414 12l5.775-5.775a1 1 0 10-1.414-1.414L12 10.586 6.225 4.811z"/></svg>
                              Cancelar
                            </IconBtn>
                          </div>
                        ) : (
                          <IconBtn onClick={() => handleEditar(t)}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.76 3.76 1.83-1.83z"/></svg>
                            Editar
                          </IconBtn>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
