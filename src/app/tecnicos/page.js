"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";

export default function TecnicosPage() {
  const [tecnicos, setTecnicos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({});
  const [cargando, setCargando] = useState(true);

  // Cargar técnicos y cuadrillas
  useEffect(() => {
    const fetchData = async () => {
      setCargando(true);

      const snapUsuarios = await getDocs(collection(db, "usuarios"));
      const snapCuadrillas = await getDocs(collection(db, "cuadrillas"));

      const tecnicos = snapUsuarios.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(user => Array.isArray(user.rol) && user.rol.includes("Técnico"));

      const cuadrillas = snapCuadrillas.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      setTecnicos(tecnicos);
      setCuadrillas(cuadrillas);
      setCargando(false);
    };

    fetchData();
  }, []);

  const filtrados = tecnicos.filter(t =>
    `${t.nombres} ${t.apellidos}`.toLowerCase().includes(filtro.toLowerCase())
  );

  const getCuadrillaAsignada = (tecnicoId) => {
    const cuadrilla = cuadrillas.find((c) =>
      Array.isArray(c.tecnicos) && c.tecnicos.includes(tecnicoId)
    );
    return cuadrilla?.nombre || "-";
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
          t.id === id ? { ...t, celular: form.celular, estado_usuario: form.estado_usuario } : t
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

  if (cargando) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Cargando técnicos...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <h2 className="text-2xl font-bold mb-4 text-[#30518c]">Técnicos</h2>

      <input
        type="text"
        placeholder="Buscar por nombre"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="mb-4 px-4 py-2 border rounded-md w-full md:w-1/3 dark:bg-[#1e1e1e] dark:text-white"
      />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#30518c] text-white text-left sticky top-0">
              <th className="p-2">DNI/CE</th>
              <th className="p-2">Nombres</th>
              <th className="p-2">Apellidos</th>
              <th className="p-2">Celular</th>
              <th className="p-2">Email</th>
              <th className="p-2">Fecha Nac.</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Cuadrilla Asignada</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((t) => (
              <tr key={t.id} className="border-b dark:border-gray-700">
                <td className="p-2">{t.dni_ce || "-"}</td>
                <td className="p-2">{t.nombres}</td>
                <td className="p-2">{t.apellidos}</td>
                <td className="p-2">
                  {editandoId === t.id ? (
                    <input
                      value={form.celular}
                      onChange={(e) => setForm({ ...form, celular: e.target.value })}
                      className="w-full px-2 py-1 border rounded"
                    />
                  ) : (
                    t.celular || "-"
                  )}
                </td>
                <td className="p-2">{t.email || "-"}</td>
                <td className="p-2">{t.fecha_nacimiento || "-"}</td>
                <td className="p-2">
                  {editandoId === t.id ? (
                    <select
                      value={form.estado_usuario}
                      onChange={(e) => setForm({ ...form, estado_usuario: e.target.value })}
                      className="w-full px-2 py-1 border rounded"
                    >
                      <option value="activo">activo</option>
                      <option value="inactivo">inactivo</option>
                    </select>
                  ) : (
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        t.estado_usuario === "activo"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {t.estado_usuario || "sin estado"}
                    </span>
                  )}
                </td>
                <td className="p-2">{getCuadrillaAsignada(t.id)}</td>
                <td className="p-2">
                  {editandoId === t.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleGuardar(t.id)}
                        className="bg-green-600 text-white px-2 py-1 rounded"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={handleCancelar}
                        className="bg-gray-400 text-white px-2 py-1 rounded"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEditar(t)}
                      className="bg-blue-600 text-white px-2 py-1 rounded"
                    >
                      Editar
                    </button>
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
