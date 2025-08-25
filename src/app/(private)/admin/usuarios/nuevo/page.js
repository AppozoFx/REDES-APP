"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/firebaseConfig";
import { collection, getDocs ,doc, setDoc, Timestamp, getDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";
import { InputField, SelectField } from "@/app/components/FormFields";

const rolesDisponibles = [
  "TI", "Gerencia", "RRHH", "Seguridad", "Supervisor",
  "Gestor", "Coordinador", "Técnico", "Almacén",
];

export default function NuevoUsuario() {
  const { userData, loading } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState({
    uid: "",
    apellidos: "",
    nombres: "",
    dni_ce: "",
    celular: "",
    direccion: "",
    email: "",
    estado_usuario: "activo",
    fecha_nacimiento: "",
    fecha_ingreso: "",
    genero: "",
    nacionalidad: "PER",
    rol: [],
  });

  const [guardando, setGuardando] = useState(false);

  // 🔐 Protección de ruta
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

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleRoles = (e) => {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
    setForm((prev) => ({ ...prev, rol: selected }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
  
    try {
      const usuarioRef = doc(db, "usuarios", form.uid);
  
      // 1. Verificar si el UID ya está en Firestore
      const usuarioSnap = await getDoc(usuarioRef);
      if (usuarioSnap.exists()) {
        toast.error("❌ El UID ya está registrado en Firestore");
        setGuardando(false);
        return;
      }
  
      // 2. Obtener todos los usuarios para validar correo y DNI/CE duplicado
      const usuariosSnap = await getDocs(collection(db, "usuarios"));
      const usuarios = usuariosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  
      const usuarioCorreo = usuarios.find((u) => u.email === form.email);
      if (usuarioCorreo) {
        toast.error(`❌ El correo ya está registrado por ${usuarioCorreo.nombres} ${usuarioCorreo.apellidos}`);
        setGuardando(false);
        return;
      }
  
      const usuarioDNI = usuarios.find((u) => u.dni_ce === form.dni_ce);
      if (usuarioDNI) {
        toast.error(`❌ El DNI/CE ya está registrado por ${usuarioDNI.nombres} ${usuarioDNI.apellidos}`);
        setGuardando(false);
        return;
      }
  
      // 3. Verificar que el UID exista en Firebase Auth
      const resp = await fetch("https://verificaruid-p7c2u2btmq-uc.a.run.app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: form.uid, email: form.email }),
      });
  
      const data = await resp.json();
  
      if (!data.exists) {
        toast.error(`❌ ${data.error || "UID no válido en Firebase Auth"}`);
        setGuardando(false);
        return;
      }
  
      // 4. Registrar en Firestore
      await setDoc(usuarioRef, {
        ...form,
        fecha_registro: Timestamp.now(),
      });
  
      toast.success("✅ Usuario registrado correctamente");
  
      setForm({
        uid: "",
        apellidos: "",
        nombres: "",
        dni_ce: "",
        celular: "",
        direccion: "",
        email: "",
        estado_usuario: "activo",
        fecha_nacimiento: "",
        fecha_ingreso: "",
        genero: "",
        nacionalidad: "PER",
        rol: [],
      });
  
      setTimeout(() => {
        router.push("/admin/usuarios/nuevo");
      }, 1500);
    } catch (err) {
      console.error(err);
      toast.error("❌ Error al registrar el usuario");
    } finally {
      setGuardando(false);
    }
  };
  
  

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h2 className="text-3xl font-bold text-[#30518c] mb-6 text-center">Registrar Nuevo Usuario</h2>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 shadow-lg rounded-lg"
      >
        <InputField label="UID de Firebase Auth" name="uid" value={form.uid} onChange={handleChange} required />
        <InputField label="Apellidos" name="apellidos" value={form.apellidos} onChange={handleChange} required />
        <InputField label="Nombres" name="nombres" value={form.nombres} onChange={handleChange} required />
        <InputField label="DNI / CE" name="dni_ce" value={form.dni_ce} onChange={handleChange} required />
        <InputField label="Celular" name="celular" value={form.celular} onChange={handleChange} />
        <InputField label="Dirección" name="direccion" value={form.direccion} onChange={handleChange} />
        <InputField label="Correo Electrónico" name="email" type="email" value={form.email} onChange={handleChange} />
        <InputField label="Fecha de Nacimiento" name="fecha_nacimiento" type="date" value={form.fecha_nacimiento} onChange={handleChange} />
        <InputField label="Fecha de Ingreso" name="fecha_ingreso" type="date" value={form.fecha_ingreso} onChange={handleChange} />
        <SelectField label="Género" name="genero" value={form.genero} onChange={handleChange} options={[
          { value: "", label: "Selecciona" },
          { value: "masculino", label: "Masculino" },
          { value: "femenino", label: "Femenino" },
        ]} />
        <InputField label="Nacionalidad" name="nacionalidad" value={form.nacionalidad} onChange={handleChange} />
        <SelectField label="Estado" name="estado_usuario" value={form.estado_usuario} onChange={handleChange} options={[
          { value: "activo", label: "Activo" },
          { value: "inactivo", label: "Inactivo" },
        ]} />

        <div className="md:col-span-2">
          <label htmlFor="rol" className="block mb-1 font-semibold">Roles</label>
          <select
            multiple
            id="rol"
            className="w-full p-2 border rounded-md h-32"
            value={form.rol}
            onChange={handleRoles}
          >
            {rolesDisponibles.map((rol) => (
              <option key={rol} value={rol}>{rol}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={guardando}
            className={`px-6 py-2 rounded-md shadow-md text-white ${
              guardando ? "bg-gray-400 cursor-not-allowed" : "bg-[#30518c] hover:bg-[#25406b]"
            }`}
          >
            {guardando ? "Registrando..." : "Registrar Usuario"}
          </button>
        </div>
      </form>
    </div>
  );
}
