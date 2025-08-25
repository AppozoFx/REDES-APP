"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";
import { InputField, SelectField } from "@/app/components/FormFields";

const rolesDisponibles = [
  "TI", "Gerencia", "RRHH", "Seguridad", "Supervisor",
  "Gestor", "Coordinador", "Técnico", "Almacén",
];

export default function UsuariosPage() {
  const { userData, loading } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({});
  const [filtro, setFiltro] = useState("");
  const router = useRouter();
  const [modalCorreo, setModalCorreo] = useState({ abierto: false, usuario: null, nuevoCorreo: "" });

  useEffect(() => {
    if (!loading) {
      const rolesPermitidos = ["TI", "Gerencia"];
      const tieneAcceso = userData?.rol?.some((r) => rolesPermitidos.includes(r));
      if (!tieneAcceso) {
        toast.error("Acceso denegado");
        router.push("/");
      }
    }
  }, [userData, loading]);

  useEffect(() => {
    const fetchUsuarios = async () => {
      const snap = await getDocs(collection(db, "usuarios"));
      const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsuarios(data);
    };
    fetchUsuarios();
  }, []);

  const handleEditar = (u) => {
    setEditando(u.id);
    setForm({ ...u });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleRoles = (e) => {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
    setForm((prev) => ({ ...prev, rol: selected }));
  };

  const handleGuardar = async () => {
    try {
      const { id, ...rest } = form;
      await updateDoc(doc(db, "usuarios", id), rest);
      toast.success("✅ Usuario actualizado correctamente");
      setEditando(null);
      const snap = await getDocs(collection(db, "usuarios"));
      const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsuarios(data);
    } catch (error) {
      console.error(error);
      toast.error("❌ Error al actualizar el usuario");
    }
  };

  const confirmarEliminacion = (usuario) => {
    toast((t) => (
      <div className="text-sm max-w-xs">
        <p className="mb-2 font-semibold text-red-700">
          ¿Eliminar a <span className="underline">{usuario.nombres} {usuario.apellidos}</span>?
        </p>
        <p className="text-xs text-red-500 mb-3">
          Esto eliminará al usuario de Firestore y Firebase Auth.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 bg-gray-300 text-black rounded hover:bg-gray-400"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              // TODO: implementar /api/eliminarUsuario para borrar de Auth
              const resp = await fetch("https://eliminarusuario-p7c2u2btmq-uc.a.run.app", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uid: usuario.id }),
              });
              const data = await resp.json();
              if (!data.success) {
                toast.error("❌ No se pudo eliminar de Auth");
                return;
              }
              setUsuarios((prev) => prev.filter((u) => u.id !== usuario.id));
              toast.success("✅ Usuario eliminado");
              toast.dismiss(t.id);
            }}
            className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Sí, eliminar
          </button>
        </div>
      </div>
    ), {
      duration: 10000,
    });
  };

  const usuariosFiltrados = usuarios.filter((u) =>
    `${u.nombres} ${u.apellidos}`.toLowerCase().includes(filtro.toLowerCase())
  );

  if (loading) return null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      
      <h2 className="text-3xl font-bold text-[#30518c] mb-6 text-center">Gestión de Usuarios</h2>

      <input
        type="text"
        placeholder="Buscar por nombre..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="mb-6 px-4 py-2 border rounded-md w-full md:w-1/3 mx-auto block"
      />

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs md:text-sm border-collapse">
          <thead className="bg-[#30518c] text-white text-sm font-semibold sticky top-0">
            <tr>
              <th className="p-2">Apellidos</th>
              <th className="p-2">Nombres</th>
              <th className="p-2">DNI/CE</th>
              <th className="p-2">Celular</th>
              <th className="p-2">Dirección</th>
              <th className="p-2">Email</th>
              <th className="p-2">Nacimiento</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Rol</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuariosFiltrados.map((u) => (
              <tr key={u.id} className="border-b">
                {editando === u.id ? (
                  <>
                    <td className="p-2"><InputField name="apellidos" value={form.apellidos || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="nombres" value={form.nombres || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="dni_ce" value={form.dni_ce || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="celular" value={form.celular || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="direccion" value={form.direccion || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="email" type="email" value={form.email || ""} onChange={handleChange} /></td>
                    <td className="p-2"><InputField name="fecha_nacimiento" type="date" value={form.fecha_nacimiento || ""} onChange={handleChange} /></td>
                    <td className="p-2">
                      <SelectField name="estado_usuario" value={form.estado_usuario} onChange={handleChange} options={[
                        { value: "activo", label: "Activo" },
                        { value: "inactivo", label: "Inactivo" },
                      ]} />
                    </td>
                    <td className="p-2">
                      <select
                        multiple
                        className="w-full p-2 border rounded-md h-24"
                        value={form.rol || []}
                        onChange={handleRoles}
                      >
                        {rolesDisponibles.map((rol) => (
                          <option key={rol} value={rol}>{rol}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 space-x-2">
                      <button onClick={handleGuardar} className="bg-green-600 text-white px-3 py-1 rounded">Guardar</button>
                      <button onClick={() => setEditando(null)} className="bg-gray-400 text-white px-3 py-1 rounded">Cancelar</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-2">{u.apellidos}</td>
                    <td className="p-2">{u.nombres}</td>
                    <td className="p-2">{u.dni_ce}</td>
                    <td className="p-2">{u.celular}</td>
                    <td className="p-2">{u.direccion}</td>
                    <td className="p-2">{u.email}</td>
                    <td className="p-2">{u.fecha_nacimiento}</td>
                    <td className="p-2">{u.estado_usuario}</td>
                    <td className="p-2">{u.rol?.join(", ")}</td>
                    <td className="p-2 space-x-2">
                      <button onClick={() => handleEditar(u)} className="bg-blue-600 text-white px-3 py-1 rounded">Editar</button>
                      <button
                        onClick={() => setModalCorreo({ abierto: true, usuario: u, nuevoCorreo: u.email })}
                        className="bg-yellow-500 text-white px-3 py-1 rounded"
                      >
                        Cambiar Correo
                      </button>
                      <button
                        onClick={() => confirmarEliminacion(u)}
                        className="bg-red-600 text-white px-3 py-1 rounded"
                      >
                        Eliminar
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal para cambiar correo */}
      {modalCorreo.abierto && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl space-y-4">
            <h3 className="text-xl font-semibold text-[#30518c]">Cambiar Correo</h3>
            <p className="text-sm text-gray-700">
              Usuario: <strong>{modalCorreo.usuario.nombres} {modalCorreo.usuario.apellidos}</strong>
            </p>
            <input
              type="email"
              className="w-full p-2 border rounded"
              value={modalCorreo.nuevoCorreo}
              onChange={(e) =>
                setModalCorreo((prev) => ({ ...prev, nuevoCorreo: e.target.value }))
              }
            />
            <div className="flex justify-end gap-2 pt-4">
              <button
                onClick={() => setModalCorreo({ abierto: false, usuario: null, nuevoCorreo: "" })}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    // TODO: implementar API /api/actualizarCorreo para modificar en Firebase Auth y Firestore
                    const resp = await fetch("https://actualizarcorreo-p7c2u2btmq-uc.a.run.app", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        uid: modalCorreo.usuario.id,
                        email: modalCorreo.nuevoCorreo,
                      }),
                    });

                    const data = await resp.json();

                    if (data.success) {
                      toast.success("✅ Correo actualizado");
                      setUsuarios((prev) =>
                        prev.map((u) =>
                          u.id === modalCorreo.usuario.id
                            ? { ...u, email: modalCorreo.nuevoCorreo }
                            : u
                        )
                      );
                    } else {
                      toast.error(`❌ ${data.error}`);
                    }
                  } catch (err) {
                    toast.error("❌ Error al actualizar el correo");
                  } finally {
                    setModalCorreo({ abierto: false, usuario: null, nuevoCorreo: "" });
                  }
                }}
                className="px-4 py-2 bg-[#30518c] text-white rounded"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
