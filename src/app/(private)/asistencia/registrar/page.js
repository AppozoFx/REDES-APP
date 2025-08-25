"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  setDoc,
} from "firebase/firestore";
import dayjs from "dayjs";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";


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
    const [resumen, setResumen] = useState(null);
    const [cargando, setCargando] = useState(false);
  
  
    useEffect(() => {
      const fetchData = async () => {
        const [cuadrillasSnap, usuariosSnap, zonasSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
          getDocs(collection(db, "zonas")),
        ]);
  
        const usuariosData = usuariosSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const zonasData = zonasSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const cuadrillasData = cuadrillasSnap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            gestorNombre: usuariosData.find((u) => u.id === data.gestor)?.nombres || "",
            coordinadorNombre: usuariosData.find((u) => u.id === data.coordinador)?.nombres || "",
          };
        });
  
        const estadoInicial = {};
        cuadrillasData.forEach((c) => {
          estadoInicial[c.id] = {
            tipo: c.tipo || "Regular",
            zona: c.zona || "",
            tecnicos: c.tecnicos || [],
            estado: "asistencia",
            placa: c.placa || "",
            observaciones: "",
          };
        });
  
        setUsuarios(usuariosData);
        setZonas(zonasData);
        setCuadrillas(cuadrillasData);
        setAsistencias(estadoInicial);
      };
  
      fetchData();
    }, []);
  
    const handleChange = (id, field, value) => {
      setAsistencias((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          [field]: value,
        },
      }));
    };
  
    const cuadrillasFiltradas = cuadrillas.filter((c) => {
      const coincideNombre = c.nombre
        .toLowerCase()
        .includes(filtroNombre.toLowerCase());
      const coincideGestor = filtroGestor ? c.gestorNombre === filtroGestor : true;
      const coincideCoordinador = filtroCoordinador ? c.coordinadorNombre === filtroCoordinador : true;
      const esActiva = c.estado === "activo";
      return coincideNombre && coincideGestor && coincideCoordinador && esActiva;
    });
  
    
    const registrarAsistencia = () => {
      toast.custom((t) => (
        <div className="bg-white p-4 shadow-md rounded border w-[320px]">
          <h2 className="font-semibold text-lg text-[#30518c] mb-2">¿Confirmar registro?</h2>
          <p className="text-sm text-gray-700">¿Deseas registrar toda la asistencia mostrada?</p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              className="px-4 py-1 rounded bg-gray-300 hover:bg-gray-400 text-sm"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancelar
            </button>
            <button
    className="px-4 py-1 rounded bg-green-600 text-white text-sm hover:bg-green-700"
    onClick={async () => {
      toast.dismiss(t.id); // Cierra el toast de confirmación
      const toastId = toast.loading("Registrando asistencia..."); // ✅ lo defines aquí
      setCargando(true); // ✅ lo defines aquí
      try {
        await procesarAsistencia(toastId); // ✅ lo pasas a la función
      } catch (error) {
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
    
      setCargando(true);
    
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
    
          resumenEstado[asistencia.estado] = (resumenEstado[asistencia.estado] || 0) + 1;
    
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
    
        const tecnicos = usuarios.filter(
          (u) =>
            Array.isArray(u.rol) &&
            u.rol.includes("Técnico") &&
            typeof u.estado_usuario === "string" &&
            u.estado_usuario.trim().toLowerCase() === "activo"
        );
        
        for (const tecnico of tecnicos) {
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
          <div className="bg-white p-4 rounded shadow-md border w-[400px]">
            <div className="flex justify-between">
              <div>
                <h3 className="text-green-600 font-bold">✅ Asistencia registrada exitosamente</h3>
                <p><strong>Registrado por:</strong> {`${userData?.nombres || ""} ${userData?.apellidos || ""}`}</p>
                <p><strong>Fecha:</strong> {fecha}</p>
                <p className="mt-2 font-semibold">📋 Resumen:</p>
                <ul>
                  {Object.entries(resumenEstado).map(([estado, count]) => (
                    <li key={estado}>
                      {estado === "asistencia" && "🟢 "}
                      {estado === "falta" && "🔴 "}
                      {estado === "descanso" && "🟡 "}
                      {estado === "vacaciones" && "🏖️ "}
                      {estado === "suspendida" && "⛔ "}
                      {estado === "descanso medico" && "⚕️ "}
                      {estado === "recuperacion" && "♻️ "}
                      {estado === "asistencia compensada" && "📘 "}
                      {estado}: {count}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-semibold">📊 Porcentaje asistencia: {porcentaje}%</p>
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
      } finally {
        setCargando(false);
      }
    };
    
    
    
    const tecnicos = usuarios.filter(
      (u) =>
        Array.isArray(u.rol) &&
        u.rol.includes("Técnico") &&
        typeof u.estado_usuario === "string" &&
        u.estado_usuario.trim().toLowerCase() === "activo"
    );
    
  const tecnicosAsignados = new Set(
    cuadrillas.flatMap((c) => asistencias[c.id]?.tecnicos || [])
  );
  const gestoresUnicos = [...new Set(cuadrillas.map((c) => c.gestorNombre).filter(Boolean))];
  const coordinadoresUnicos = [...new Set(cuadrillas.map((c) => c.coordinadorNombre).filter(Boolean))];
  
  
  
    
  
    return (
      <div className="h-full w-full flex flex-col overflow-hidden">
        <h2 className="text-2xl font-bold mb-4 text-[#30518c]">
          Registrar Asistencia - Cuadrillas
        </h2>
  
        <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
          <label className="text-sm font-semibold">Fecha general:</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="px-4 py-2 border rounded-md"
          />
          <button
    onClick={registrarAsistencia}
    disabled={cargando}
    className={`px-4 py-2 rounded-md text-white ${cargando ? "bg-gray-400" : "bg-green-600"}`}
  >
    {cargando ? "Registrando..." : "Registrar asistencia"}
  </button>
  
        </div>
  
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <input
            type="text"
            placeholder="Buscar cuadrilla..."
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
            {gestoresUnicos.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select
            value={filtroCoordinador}
            onChange={(e) => setFiltroCoordinador(e.target.value)}
            className="px-4 py-2 border rounded-md w-full md:w-1/3"
          >
            <option value="">Todos los Coordinadores</option>
            {coordinadoresUnicos.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
  
       
  
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#30518c] text-white text-left sticky top-0">
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
              {cuadrillasFiltradas.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="p-2 whitespace-normal max-w-[250px]">{c.nombre}</td>
                  <td className="p-2 whitespace-normal max-w-[250px]">
                    <select
                      value={asistencias[c.id]?.tipo}
                      onChange={(e) => handleChange(c.id, "tipo", e.target.value)}
                    >
                      <option value="Regular">Regular</option>
                      <option value="TOP">TOP</option>
                      <option value="Alto Valor">Alto Valor</option>
                    </select>
                  </td>
                  <td className="p-2 whitespace-normal max-w-[250px]">
                    <select
                      value={asistencias[c.id]?.zona}
                      onChange={(e) => handleChange(c.id, "zona", e.target.value)}
                    >
                      {zonas.map((z) => (
                        <option key={z.id} value={z.zona}>{z.zona}</option>
                      ))}
                    </select>
                  </td>



                  <td className="p-2">
                    <select
                      multiple
                      value={asistencias[c.id]?.tecnicos || []}
                      onChange={(e) =>
                        handleChange(
                          c.id,
                          "tecnicos",
                          Array.from(e.target.selectedOptions, (opt) => opt.value)
                        )
                      }
                    >
                      {tecnicos
    .filter(
      (t) =>
        !tecnicosAsignados.has(t.id) ||
        asistencias[c.id]?.tecnicos?.includes(t.id)
    )
    .map((t) => (
      <option key={t.id} value={t.id}>
        {`${t.nombres} ${t.apellidos}`}
        {(() => {
          const cuadrillaAsignada = cuadrillas.find(
            (cuad) => Array.isArray(cuad.tecnicos) && cuad.tecnicos.includes(t.id)
          );
          return cuadrillaAsignada
            ? ` (Asignado a ${cuadrillaAsignada.nombre})`
            : "";
        })()}
      </option>
    ))}
  
                    </select>
                  </td>


                  
                  <td className="p-2 whitespace-normal max-w-[250px]">
                    <select
                      value={asistencias[c.id]?.estado}
                      onChange={(e) => handleChange(c.id, "estado", e.target.value)}
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
                  <td className="p-2 whitespace-normal max-w-[250px]">
                    <input
                      value={asistencias[c.id]?.placa || ""}
                      onChange={(e) => handleChange(c.id, "placa", e.target.value)}
                      className="w-full px-2 py-1 border rounded"
                    />
                  </td>
                  <td className="p-2 whitespace-normal max-w-[250px]">
                    <input
                      value={asistencias[c.id]?.observaciones || ""}
                      onChange={(e) =>
                        handleChange(c.id, "observaciones", e.target.value)
                      }
                      className="w-full px-2 py-1 border rounded"
                    />
                  </td>
                  <td className="p-2 whitespace-normal max-w-[250px]">{c.gestorNombre || "-"}</td>
                  <td className="p-2 whitespace-normal max-w-[250px]">{c.coordinadorNombre || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }