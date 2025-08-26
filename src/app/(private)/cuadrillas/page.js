"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  deleteDoc, // 👈 añadido
} from "firebase/firestore";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";

/* =========================
   Helpers de UI
========================= */
const Toolbar = ({ children }) => (
  <div className="mb-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
    {children}
  </div>
);

const Pill = ({ children }) => (
  <span className="inline-flex items-center rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:ring-orange-800">
    {children}
  </span>
);

export default function CuadrillasPage() {
  const [cuadrillas, setCuadrillas] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [gestores, setGestores] = useState([]);
  const [coordinadores, setCoordinadores] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [tecnicosAsignados, setTecnicosAsignados] = useState(new Set());

  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({});

  // filtros
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroGestor, setFiltroGestor] = useState("");
  const [filtroCoordinador, setFiltroCoordinador] = useState("");

  // crear cuadrilla (modal)
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [formCrear, setFormCrear] = useState({
    nombre: "",
    tipo: "Regular",
    categoria: "Condominio",
    zona: "",
    placa: "",
    gestor: "",
    coordinador: "",
    tecnicos: [],
    estado: "activo",
  });

  // eliminar cuadrilla (modal)
  const [confirmEliminar, setConfirmEliminar] = useState({
    open: false,
    id: null,
    nombre: "",
  });

  const { userData } = useAuth();

  // Contadores activo/inactivo
  const { activos, inactivos } = useMemo(() => {
    const a = cuadrillas.filter(
      (c) => (c.estado || "").toLowerCase() === "activo"
    ).length;
    const i = cuadrillas.filter(
      (c) => (c.estado || "").toLowerCase() === "inactivo"
    ).length;
    return { activos: a, inactivos: i };
  }, [cuadrillas]);

  // Permisos
  const puedeEditar = useMemo(
    () =>
      ["TI", "Gerencia", "RRHH", "Almacén", "Gestor"].some((r) =>
        userData?.rol?.includes(r)
      ),
    [userData]
  );

  // Permite crear/eliminar a: Almacén, Gerencia y TI
  const puedeCrear = useMemo(
    () => ["Almacén", "Gerencia", "TI"].some((r) => userData?.rol?.includes(r)),
    [userData]
  );

  // Obtener nombre completo desde ID contra un arreglo de usuarios (gestores, coordinadores o técnicos)
  const getNombreCompleto = (uid, usuarios) => {
    const u = usuarios.find((x) => x.id === uid);
    return u ? `${u.nombres} ${u.apellidos}` : uid || "-";
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [cuadrillaSnap, usuariosSnap, zonasSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
          getDocs(collection(db, "zonas")),
        ]);

        const zonasData = zonasSnap.docs.map((d) => d.data());
        setZonas(zonasData);

        const usuarios = usuariosSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const gestoresData = usuarios.filter((u) => u.rol?.includes("Gestor"));
        const coordinadoresData = usuarios.filter((u) =>
          u.rol?.includes("Coordinador")
        );
        const tecnicosData = usuarios.filter(
          (u) =>
            Array.isArray(u.rol) &&
            u.rol.includes("Técnico") &&
            typeof u.estado_usuario === "string" &&
            u.estado_usuario.trim().toLowerCase() === "activo"
        );

        setGestores(gestoresData);
        setCoordinadores(coordinadoresData);
        setTecnicos(tecnicosData);

        const cuadrillasData = cuadrillaSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            gestorNombre: getNombreCompleto(data.gestor, usuarios),
            coordinadorNombre: getNombreCompleto(data.coordinador, usuarios),
            tecnicosNombres: (data.tecnicos || []).map((tid) =>
              getNombreCompleto(tid, usuarios)
            ),
          };
        });

        // Detectar técnicos ya asignados
        const asignados = new Set();
        cuadrillasData.forEach((c) =>
          (c.tecnicos || []).forEach((t) => asignados.add(t))
        );
        setTecnicosAsignados(asignados);
        setCuadrillas(cuadrillasData);

        // Defaults para crear
        setFormCrear((prev) => ({
          ...prev,
          zona: zonasData?.[0]?.zona || "",
          gestor: gestoresData?.[0]?.id || "",
          coordinador: coordinadoresData?.[0]?.id || "",
        }));
      } catch (e) {
        console.error(e);
        toast.error("No se pudieron cargar los datos.");
      }
    };
    fetchData();
  }, []);

  const handleEditar = (id) => {
    const c = cuadrillas.find((x) => x.id === id);
    setEditando(id);
    setForm({
      tipo: c.tipo || "Regular",
      categoria: c.categoria || "Condominio",
      zona: c.zona || "",
      placa: c.placa || "",
      gestor: c.gestor || "",
      coordinador: c.coordinador || "",
      tecnicos: c.tecnicos || [],
      estado: c.estado || "activo",
    });
  };

  const recomputarAsignadosDesde = (lista) => {
    const s = new Set();
    lista.forEach((c) => (c.tecnicos || []).forEach((t) => s.add(t)));
    setTecnicosAsignados(s);
  };

  const handleGuardar = async (id) => {
    const ref = doc(db, "cuadrillas", id);
    const cleanForm = Object.fromEntries(
      Object.entries(form).filter(([_, v]) => v !== undefined)
    );

    try {
      await updateDoc(ref, cleanForm);

      const nuevas = cuadrillas.map((c) =>
        c.id === id
          ? {
              ...c,
              ...cleanForm,
              gestorNombre: getNombreCompleto(cleanForm.gestor, [
                ...gestores,
                ...coordinadores,
                ...tecnicos,
              ]),
              coordinadorNombre: getNombreCompleto(cleanForm.coordinador, [
                ...gestores,
                ...coordinadores,
                ...tecnicos,
              ]),
              tecnicosNombres: (cleanForm.tecnicos || []).map((tid) =>
                getNombreCompleto(tid, tecnicos)
              ),
            }
          : c
      );

      setCuadrillas(nuevas);
      recomputarAsignadosDesde(nuevas);
      setEditando(null);
      setForm({});
      toast.success("✅ Cambios guardados correctamente");
    } catch (error) {
      toast.error("❌ Error al guardar cambios");
      console.error("Error al guardar:", error);
    }
  };

  const handleCancelar = () => {
    setEditando(null);
    setForm({});
  };

  const cuadrillasFiltradas = useMemo(() => {
    return cuadrillas.filter((c) => {
      const coincideNombre = c.nombre?.toLowerCase().includes(filtroNombre.toLowerCase());
      const coincideGestor = filtroGestor ? c.gestorNombre === filtroGestor : true;
      const coincideCoordinador = filtroCoordinador ? c.coordinadorNombre === filtroCoordinador : true;
      return coincideNombre && coincideGestor && coincideCoordinador;
    });
  }, [cuadrillas, filtroNombre, filtroGestor, filtroCoordinador]);

  const gestoresUnicos = useMemo(
    () => [...new Set(cuadrillas.map((c) => c.gestorNombre).filter(Boolean))],
    [cuadrillas]
  );
  const coordinadoresUnicos = useMemo(
    () => [...new Set(cuadrillas.map((c) => c.coordinadorNombre).filter(Boolean))],
    [cuadrillas]
  );

  /* =========================
     Crear cuadrilla
  ========================= */
  const crearCuadrilla = async () => {
    if (!puedeCrear) {
      toast.error("No tienes permiso para crear cuadrillas");
      return;
    }
    if (!formCrear.nombre?.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    try {
      const payload = {
        nombre: formCrear.nombre.trim(),
        tipo: formCrear.tipo,
        categoria: formCrear.categoria,
        zona: formCrear.zona || "",
        placa: formCrear.placa || "",
        gestor: formCrear.gestor || "",
        coordinador: formCrear.coordinador || "",
        tecnicos: formCrear.tecnicos || [],
        estado: formCrear.estado,
      };

      const ref = await addDoc(collection(db, "cuadrillas"), payload);

      const nuevo = {
        id: ref.id,
        ...payload,
        gestorNombre: getNombreCompleto(payload.gestor, [
          ...gestores,
          ...coordinadores,
          ...tecnicos,
        ]),
        coordinadorNombre: getNombreCompleto(payload.coordinador, [
          ...gestores,
          ...coordinadores,
          ...tecnicos,
        ]),
        tecnicosNombres: (payload.tecnicos || []).map((tid) =>
          getNombreCompleto(tid, tecnicos)
        ),
      };

      const nuevas = [nuevo, ...cuadrillas];
      setCuadrillas(nuevas);
      recomputarAsignadosDesde(nuevas);

      setMostrarCrear(false);
      setFormCrear((prev) => ({
        ...prev,
        nombre: "",
        placa: "",
        tecnicos: [],
      }));
      toast.success("✅ Cuadrilla creada");
    } catch (e) {
      console.error(e);
      toast.error("❌ No se pudo crear la cuadrilla");
    }
  };

  /* =========================
     Eliminar cuadrilla
  ========================= */
  const solicitarEliminar = (id, nombre) => {
    if (!puedeCrear) {
      toast.error("No tienes permiso para eliminar cuadrillas");
      return;
    }
    setConfirmEliminar({ open: true, id, nombre });
  };

  const eliminarCuadrilla = async () => {
    if (!puedeCrear || !confirmEliminar.id) return;
    try {
      await deleteDoc(doc(db, "cuadrillas", confirmEliminar.id));
      const nuevas = cuadrillas.filter((c) => c.id !== confirmEliminar.id);
      setCuadrillas(nuevas);
      recomputarAsignadosDesde(nuevas);
      toast.success("🗑️ Cuadrilla eliminada");
    } catch (e) {
      console.error(e);
      toast.error("❌ No se pudo eliminar la cuadrilla");
    } finally {
      setConfirmEliminar({ open: false, id: null, nombre: "" });
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#30518c]">Cuadrillas</h2>
        <div className="space-x-2">
          <Pill>Total: {cuadrillas.length}</Pill>
          <Pill>Activas: {activos}</Pill>
          <Pill>Inactivas: {inactivos}</Pill>
          {filtroNombre || filtroGestor || filtroCoordinador ? <Pill>Filtrado</Pill> : null}
        </div>
      </div>

      {/* Toolbar Filtros + Crear */}
      <Toolbar>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4 w-full md:w-3/4">
            <input
              type="text"
              placeholder="Buscar por nombre..."
              value={filtroNombre}
              onChange={(e) => setFiltroNombre(e.target.value)}
              className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />

            <select
              value={filtroGestor}
              onChange={(e) => setFiltroGestor(e.target.value)}
              className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Todos los Gestores</option>
              {gestoresUnicos.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>

            <select
              value={filtroCoordinador}
              onChange={(e) => setFiltroCoordinador(e.target.value)}
              className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Todos los Coordinadores</option>
              {coordinadoresUnicos.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          {puedeCrear && (
            <div className="flex gap-2">
              <button
                onClick={() => setMostrarCrear(true)}
                className="inline-flex items-center justify-center rounded-xl bg-[#ff6413] px-4 py-2 text-white font-semibold shadow hover:bg-[#e65a10] transition"
              >
                + Nueva cuadrilla
              </button>
            </div>
          )}
        </div>
      </Toolbar>

      {/* Tabla */}
      <div className="overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#30518c] dark:bg-[#1e3a8a] text-white text-left sticky top-0 z-10">
              <th className="p-3">Nombre</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">R/C</th>
              <th className="p-3">Zona</th>
              <th className="p-3">Placa</th>
              <th className="p-3">Gestor</th>
              <th className="p-3">Coordinador</th>
              <th className="p-3">Técnicos</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cuadrillasFiltradas.map((c, idx) => (
              <tr
                key={c.id}
                className={`border-b border-gray-100 dark:border-gray-800 ${
                  idx % 2 === 0 ? "bg-white/50 dark:bg-gray-900/50" : ""
                } hover:bg-orange-50/50 dark:hover:bg-gray-800/50 transition`}
              >
                <td className="p-3 font-medium text-gray-800 dark:text-gray-100">
                  {c.nombre}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.tipo}
                      onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Regular">Regular</option>
                      <option value="TOP">TOP</option>
                      <option value="Alto Valor">Alto Valor</option>
                    </select>
                  ) : (
                    <span className="text-gray-800 dark:text-gray-100">
                      {c.tipo}
                    </span>
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.categoria}
                      onChange={(e) =>
                        setForm({ ...form, categoria: e.target.value })
                      }
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Condominio">Condominio</option>
                      <option value="Residencial">Residencial</option>
                    </select>
                  ) : (
                    c.categoria
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.zona}
                      onChange={(e) => setForm({ ...form, zona: e.target.value })}
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      {zonas.map((z, i) => (
                        <option key={i} value={z.zona}>
                          {z.zona}
                        </option>
                      ))}
                    </select>
                  ) : (
                    c.zona || "-"
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <input
                      value={form.placa}
                      onChange={(e) => setForm({ ...form, placa: e.target.value })}
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    c.placa || "-"
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.gestor}
                      onChange={(e) =>
                        setForm({ ...form, gestor: e.target.value })
                      }
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      {gestores.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nombres} {g.apellidos}
                        </option>
                      ))}
                    </select>
                  ) : (
                    c.gestorNombre
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.coordinador}
                      onChange={(e) =>
                        setForm({ ...form, coordinador: e.target.value })
                      }
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      {coordinadores.map((co) => (
                        <option key={co.id} value={co.id}>
                          {co.nombres} {co.apellidos}
                        </option>
                      ))}
                    </select>
                  ) : (
                    c.coordinadorNombre
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      multiple
                      value={form.tecnicos}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tecnicos: Array.from(
                            e.target.selectedOptions,
                            (option) => option.value
                          ),
                        })
                      }
                      className="w-full min-h-24 border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      {tecnicos
                        .filter(
                          (t) =>
                            !tecnicosAsignados.has(t.id) ||
                            form.tecnicos.includes(t.id)
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nombres} {t.apellidos}
                          </option>
                        ))}
                    </select>
                  ) : (
                    c.tecnicosNombres?.join(", ") || "-"
                  )}
                </td>

                <td className="p-3">
                  {editando === c.id ? (
                    <select
                      value={form.estado}
                      onChange={(e) =>
                        setForm({ ...form, estado: e.target.value })
                      }
                      className="w-full border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="activo">activo</option>
                      <option value="inactivo">inactivo</option>
                    </select>
                  ) : (
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        c.estado === "activo"
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      }`}
                    >
                      {c.estado}
                    </span>
                  )}
                </td>

                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {puedeEditar ? (
                      editando === c.id ? (
                        <>
                          <button
                            onClick={() => handleGuardar(c.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md transition"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={handleCancelar}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-md transition dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleEditar(c.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md transition"
                        >
                          Editar
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-gray-400 italic">
                        Solo lectura
                      </span>
                    )}

                    {/* Botón Eliminar solo para puedeCrear */}
                    {puedeCrear && editando !== c.id && (
                      <button
                        onClick={() => solicitarEliminar(c.id, c.nombre)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md transition"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {cuadrillasFiltradas.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            No hay cuadrillas para mostrar.
          </div>
        )}
      </div>

      {/* Modal Crear Cuadrilla */}
      {mostrarCrear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMostrarCrear(false)}
          />
          {/* Card */}
          <div className="relative z-10 w-[95%] max-w-3xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Nueva cuadrilla</h3>
              <button
                onClick={() => setMostrarCrear(false)}
                className="rounded-md px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Nombre *
                </label>
                <input
                  value={formCrear.nombre}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, nombre: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Ej. K12 MOTO"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                <select
                  value={formCrear.tipo}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, tipo: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Regular">Regular</option>
                  <option value="TOP">TOP</option>
                  <option value="Alto Valor">Alto Valor</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">R/C</label>
                <select
                  value={formCrear.categoria}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, categoria: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Condominio">Condominio</option>
                  <option value="Residencial">Residencial</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Zona</label>
                <select
                  value={formCrear.zona}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, zona: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {zonas.map((z, i) => (
                    <option key={i} value={z.zona}>
                      {z.zona}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Placa</label>
                <input
                  value={formCrear.placa}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, placa: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ABC-123"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Gestor
                </label>
                <select
                  value={formCrear.gestor}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, gestor: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {gestores.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nombres} {g.apellidos}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Coordinador
                </label>
                <select
                  value={formCrear.coordinador}
                  onChange={(e) =>
                    setFormCrear({
                      ...formCrear,
                      coordinador: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {coordinadores.map((co) => (
                    <option key={co.id} value={co.id}>
                      {co.nombres} {co.apellidos}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Técnicos (Ctrl/Cmd + click para múltiples)
                </label>
                <select
                  multiple
                  value={formCrear.tecnicos}
                  onChange={(e) =>
                    setFormCrear({
                      ...formCrear,
                      tecnicos: Array.from(
                        e.target.selectedOptions,
                        (o) => o.value
                      ),
                    })
                  }
                  className="w-full min-h-28 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {tecnicos
                    .filter((t) => !tecnicosAsignados.has(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombres} {t.apellidos}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Estado
                </label>
                <select
                  value={formCrear.estado}
                  onChange={(e) =>
                    setFormCrear({ ...formCrear, estado: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="activo">activo</option>
                  <option value="inactivo">inactivo</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setMostrarCrear(false)}
                className="rounded-xl bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 transition dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={crearCuadrilla}
                className="rounded-xl bg-[#30518c] px-4 py-2 text-white hover:bg-[#27426f] transition"
              >
                Crear cuadrilla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Eliminar */}
      {confirmEliminar.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setConfirmEliminar({ open: false, id: null, nombre: "" })}
          />
          <div className="relative z-10 w-[95%] max-w-md rounded-2xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
              Eliminar cuadrilla
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              ¿Seguro que deseas eliminar la cuadrilla{" "}
              <span className="font-semibold">{confirmEliminar.nombre}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmEliminar({ open: false, id: null, nombre: "" })}
                className="rounded-xl bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 transition dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={eliminarCuadrilla}
                className="rounded-xl bg-red-600 px-4 py-2 text-white hover:bg-red-700 transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
