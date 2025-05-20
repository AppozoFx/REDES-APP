"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";


export default function CuadrillasPage() {
  const [cuadrillas, setCuadrillas] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [gestores, setGestores] = useState([]);
  const [coordinadores, setCoordinadores] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({});
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroGestor, setFiltroGestor] = useState("");
  const [filtroCoordinador, setFiltroCoordinador] = useState("");
  const [tecnicosAsignados, setTecnicosAsignados] = useState(new Set());
  const { userData } = useAuth();


  // Función para obtener nombre completo desde ID
  const getNombreCompleto = (uid, usuarios) => {
    const u = usuarios.find((u) => u.id === uid);
    return u ? `${u.nombres} ${u.apellidos}` : uid;
  };

  useEffect(() => {
    const fetchData = async () => {
      const [cuadrillaSnap, usuariosSnap, zonasSnap] = await Promise.all([
        getDocs(collection(db, "cuadrillas")),
        getDocs(collection(db, "usuarios")),
        getDocs(collection(db, "zonas")),
      ]);

      const zonasData = zonasSnap.docs.map(doc => doc.data());
      setZonas(zonasData);

      const usuarios = usuariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const gestoresData = usuarios.filter(u => u.rol?.includes("Gestor"));
      const coordinadoresData = usuarios.filter(u => u.rol?.includes("Coordinador"));
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

      const cuadrillasData = cuadrillaSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          gestorNombre: getNombreCompleto(data.gestor, usuarios),
          coordinadorNombre: getNombreCompleto(data.coordinador, usuarios),
          tecnicosNombres: (data.tecnicos || []).map(tid => getNombreCompleto(tid, usuarios)),
        };
      });

      // Detectar técnicos ya asignados
      const asignados = new Set();
      cuadrillasData.forEach(c => (c.tecnicos || []).forEach(t => asignados.add(t)));
      setTecnicosAsignados(asignados);
      setCuadrillas(cuadrillasData);
    };

    fetchData();
  }, []);

  const handleEditar = (id) => {
    const c = cuadrillas.find(c => c.id === id);
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

  const handleGuardar = async (id) => {
    const ref = doc(db, "cuadrillas", id);
    const cleanForm = Object.fromEntries(Object.entries(form).filter(([_, v]) => v !== undefined));

    try {
      await updateDoc(ref, cleanForm);

      const nuevasCuadrillas = cuadrillas.map(c =>
        c.id === id
          ? {
              ...c,
              ...cleanForm,
              gestorNombre: getNombreCompleto(cleanForm.gestor, gestores),
              coordinadorNombre: getNombreCompleto(cleanForm.coordinador, coordinadores),
              tecnicosNombres: (cleanForm.tecnicos || []).map(tid => getNombreCompleto(tid, tecnicos)),
            }
          : c
      );

      setCuadrillas(nuevasCuadrillas);
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

  const cuadrillasFiltradas = cuadrillas.filter((c) => {
    const coincideNombre = c.nombre?.toLowerCase().includes(filtroNombre.toLowerCase());
    const coincideGestor = filtroGestor ? c.gestorNombre === filtroGestor : true;
    const coincideCoordinador = filtroCoordinador ? c.coordinadorNombre === filtroCoordinador : true;
    return coincideNombre && coincideGestor && coincideCoordinador;
  });

  const gestoresUnicos = [...new Set(cuadrillas.map(c => c.gestorNombre))];
  const coordinadoresUnicos = [...new Set(cuadrillas.map(c => c.coordinadorNombre))];

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <h2 className="text-2xl font-bold mb-4 text-[#30518c]">Cuadrillas</h2>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={filtroNombre}
          onChange={(e) => setFiltroNombre(e.target.value)}
          className="px-4 py-2 border rounded-md w-full md:w-1/3"
        />
        <select
          value={filtroGestor}
          onChange={(e) => setFiltroGestor(e.target.value)}
          className="px-4 py-2 border rounded-md w-full md:w-1/3"
        >
          <option value="">Todos los Gestores</option>
          {gestoresUnicos.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select
          value={filtroCoordinador}
          onChange={(e) => setFiltroCoordinador(e.target.value)}
          className="px-4 py-2 border rounded-md w-full md:w-1/3"
        >
          <option value="">Todos los Coordinadores</option>
          {coordinadoresUnicos.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#30518c] text-white text-left sticky top-0">
              <th className="p-2">Nombre</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">R/C</th>
              <th className="p-2">Zona</th>
              <th className="p-2">Placa</th>
              <th className="p-2">Gestor</th>
              <th className="p-2">Coordinador</th>
              <th className="p-2">Técnicos</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cuadrillasFiltradas.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="p-2">{c.nombre}</td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                      <option value="Regular">Regular</option>
                      <option value="TOP">TOP</option>
                      <option value="Alto Valor">Alto Valor</option>
                    </select>
                  ) : c.tipo}
                </td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                      <option value="Condominio">Condominio</option>
                      <option value="Residencial">Residencial</option>
                    </select>
                  ) : c.categoria}
                </td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })}>
                      {zonas.map((z, i) => <option key={i} value={z.zona}>{z.zona}</option>)}
                    </select>
                  ) : (c.zona || "-")}
                </td>
                <td className="p-2">{editando === c.id ? (
                  <input value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value })} />
                ) : c.placa}</td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.gestor} onChange={(e) => setForm({ ...form, gestor: e.target.value })}>
                      {gestores.map(g => <option key={g.id} value={g.id}>{g.nombres}</option>)}
                    </select>
                  ) : c.gestorNombre}
                </td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.coordinador} onChange={(e) => setForm({ ...form, coordinador: e.target.value })}>
                      {coordinadores.map(co => <option key={co.id} value={co.id}>{co.nombres}</option>)}
                    </select>
                  ) : c.coordinadorNombre}
                </td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select
                      multiple
                      value={form.tecnicos}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tecnicos: Array.from(e.target.selectedOptions, option => option.value),
                        })
                      }
                    >
                      {tecnicos
                        .filter(t => !tecnicosAsignados.has(t.id) || form.tecnicos.includes(t.id))
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.nombres} {t.apellidos}
                          </option>
                        ))}
                    </select>
                  ) : (
                    c.tecnicosNombres?.join(", ") || "-"
                  )}
                </td>
                <td className="p-2">
                  {editando === c.id ? (
                    <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                      <option value="activo">activo</option>
                      <option value="inactivo">inactivo</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      c.estado === "activo" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {c.estado}
                    </span>
                  )}
                </td>
                <td className="p-2 flex gap-2">
  {["TI", "Gerencia", "RRHH", "Almacén", "Gestor"].some(r => userData?.rol?.includes(r)) ? (
    editando === c.id ? (
      <>
        <button onClick={() => handleGuardar(c.id)} className="bg-green-600 text-white px-2 rounded">
          Guardar
        </button>
        <button onClick={handleCancelar} className="bg-gray-400 text-white px-2 rounded">
          Cancelar
        </button>
      </>
    ) : (
      <button onClick={() => handleEditar(c.id)} className="bg-blue-600 text-white px-2 rounded">
        Editar
      </button>
    )
  ) : (
    <span className="text-xs text-gray-400 italic">Solo lectura</span>
  )}
</td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
