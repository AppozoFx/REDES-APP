"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import dayjs from "dayjs";
import toast from "react-hot-toast";

export default function InstalacionesGestor() {
  const { userData } = useAuth();
  const [instalaciones, setInstalaciones] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  
  const mapaCoordinadores = {};
  usuarios.forEach((u) => {
    if (u.id && u.nombres && u.apellidos) {
      mapaCoordinadores[u.id] = `${u.nombres} ${u.apellidos}`;
    }
  });
  const mapaGestores = {};
  usuarios
    .filter((u) => u.rol?.includes("Gestor"))
    .forEach((u) => {
      mapaGestores[u.id] = `${u.nombres} ${u.apellidos}`;
    });

  const [filtros, setFiltros] = useState({
    fecha: dayjs().format("YYYY-MM-DD"),
    cliente: "",
    gestor: "",
    tramo: "",
    estado: "",
    coordinador: "",
    cuadrilla: "",
    estadoLlamada: "" // <--- AÑADIDO: estado inicial para el filtro de llamada
  });
  
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({});
  const [horaActual, setHoraActual] = useState(dayjs().format("HH:mm:ss"));
  // const [cuadrillasFiltradas, setCuadrillasFiltradas] = useState([]); // Ya no necesitas este estado, se calcula directamente

  useEffect(() => {
    const fetchData = async () => {
      const [instSnap, cuadSnap, userSnap] = await Promise.all([
        getDocs(collection(db, "instalaciones")),
        getDocs(collection(db, "cuadrillas")),
        getDocs(collection(db, "usuarios")),
      ]);

      const instalacionesData = instSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const cuadrillasData = cuadSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const usuariosData = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // No es necesario redefinir mapaCoordinadores aquí, ya está afuera y se actualiza con usuarios.
      // De hecho, la definición de mapaCoordinadores y mapaGestores debería ir DENTRO del useEffect
      // o ser recalculada cuando `usuarios` cambie, usando useMemo por ejemplo.
      // Por ahora, lo dejamos para no desviarnos, pero es un punto de mejora.

      setInstalaciones(instalacionesData);
      setCuadrillas(cuadrillasData);
      setUsuarios(usuariosData);
    };

    fetchData();
  }, []);

  useEffect(() => {
    const intervalo = setInterval(() => {
      setHoraActual(dayjs().format("HH:mm:ss"));
    }, 1000);
    return () => clearInterval(intervalo);
  }, []);
  
  const obtenerGestorPorCuadrilla = (nombreCuadrilla) => {
    const cuadrilla = cuadrillas.find(c => c.nombre === nombreCuadrilla);
    const gestorUID = cuadrilla?.gestor;
    const usuarioGestor = usuarios.find(u => u.id === gestorUID);
    return usuarioGestor ? `${usuarioGestor.nombres} ${usuarioGestor.apellidos}` : '';
  };

  const instalacionesFiltradas = instalaciones.filter(i => {
    let fechaFormateada = "";
    if (i.fechaInstalacion) {
      if (typeof i.fechaInstalacion === "string") {
        fechaFormateada = dayjs(i.fechaInstalacion).format("YYYY-MM-DD");
      } else if (typeof i.fechaInstalacion.toDate === "function") {
        fechaFormateada = dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
      }
    }
  
    const fechaCoincide = fechaFormateada === filtros.fecha;
    const clienteCoincide = i.cliente?.toLowerCase().includes(filtros.cliente.toLowerCase());
    const gestorCoincide = filtros.gestor === "" || i.gestorCuadrilla === filtros.gestor;
    const tramoCoincide = filtros.tramo === "" || i.tramo === filtros.tramo;
    const estadoCoincide = filtros.estado === "" || i.estado === filtros.estado;
    const coordinadorCoincide = filtros.coordinador === "" || (i.coordinadorCuadrilla?.toLowerCase() || '').includes(filtros.coordinador.toLowerCase());
    const cuadrillaCoincide = filtros.cuadrilla === "" || 
      (i.cuadrillaNombre?.toLowerCase().includes(filtros.cuadrilla.toLowerCase())) ||
      (i.cuadrilla?.toLowerCase().includes(filtros.cuadrilla.toLowerCase()));

    // --- MODIFICADO: Lógica para el filtro de estadoLlamada ---
    const estadoLlamadaCoincide = 
      filtros.estadoLlamada === "" || // Si no hay filtro, todos coinciden
      (filtros.estadoLlamada === "noLlamo" && !i.estadoLlamada) || // Si el filtro es "noLlamo" y no hay estadoLlamada
      i.estadoLlamada === filtros.estadoLlamada; // Si el estadoLlamada coincide con el filtro
    // --- FIN MODIFICADO ---
  
    return (
      fechaCoincide &&
      clienteCoincide &&
      gestorCoincide &&
      tramoCoincide &&
      estadoCoincide &&
      coordinadorCoincide &&
      cuadrillaCoincide &&
      estadoLlamadaCoincide // <--- AÑADIDO AL RETORNO DEL FILTRO
    );
  });

  // --- Los contadores para las LEYENDAS siguen calculándose sobre las instalaciones DEL DÍA ---
  const instalacionesDelDiaParaContadores = instalaciones.filter(i => {
    let fechaFormateada = "";
    if (i.fechaInstalacion) {
      if (typeof i.fechaInstalacion === "string") {
        fechaFormateada = dayjs(i.fechaInstalacion).format("YYYY-MM-DD");
      } else if (typeof i.fechaInstalacion.toDate === "function") {
        fechaFormateada = dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
      }
    }
    return fechaFormateada === filtros.fecha;
  });

  const totalInstalacionesDelDia = instalacionesDelDiaParaContadores.length;
  const totalNoLlamo = instalacionesDelDiaParaContadores.filter(i => !i.estadoLlamada).length;
  const totalContesto = instalacionesDelDiaParaContadores.filter(i => i.estadoLlamada === "Contesto").length;
  const totalNoContesto = instalacionesDelDiaParaContadores.filter(i => i.estadoLlamada === "No Contesto").length;
  const totalNoRegistro = instalacionesDelDiaParaContadores.filter(i => i.estadoLlamada === "No se Registro").length;
  // --- FIN Contadores para leyendas ---

  const gestoresUnicos = [
    ...new Set(instalaciones.map(i => i.gestorCuadrilla).filter(Boolean))
  ].map(uid => ({
    uid,
    nombre: mapaGestores[uid] || uid,
  }));
  
  const coordinadoresUnicos = [
    ...new Set(instalaciones.map(i => i.coordinadorCuadrilla).filter(Boolean))
  ].map(uid => ({
    uid,
    nombre: mapaCoordinadores[uid] || uid,
  }));
  
  const handleGuardar = async (id) => {
    if (!form.estadoLlamada) {
      toast.error("El campo Estado Llamada es obligatorio");
      return;
    }
    try {
      await updateDoc(doc(db, "instalaciones", id), {
        ...form,
        modificadoPor: userData?.nombres || userData?.email || userData?.uid,
        ultimaModificacion: new Date(),
      });
      toast.success("Instalación actualizada");
      setEditandoId(null);
      setInstalaciones(prev => prev.map(i => i.id === id ? { ...i, ...form, modificadoPor: userData?.nombres || userData?.email || userData?.uid } : i));
    } catch (error) {
      toast.error("Error al guardar");
      console.error(error);
    }
  };

  const handleChange = (id, campo, valor) => {
    if (editandoId === id) {
      setForm({ ...form, [campo]: valor });
    }
  };

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
  
  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="sticky top-0 z-10 bg-white dark:bg-[#0f0f0f] pb-3">
        <h2 className="text-3xl font-bold text-[#30518c] mb-2 text-center">Llamadas de INCONCERT</h2>
        <p className="text-center text-sm text-gray-600 mb-4">* Las horas deben ingresarse en formato <strong>24 horas</strong> (Ejemplo: 14:30)</p>
        <p className="text-center text-sm text-gray-600 mb-4"> <span className="text-[#30518c] font-bold text-2xl tracking-widest">🕒 Hora actual: {horaActual}</span></p>

        <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-center text-gray-700 mt-4 mb-6">
          <div className="bg-gray-100 px-3 py-2 rounded">Total del día: {totalInstalacionesDelDia}</div>
          <div className="bg-yellow-100 px-3 py-2 rounded">📞 No se llamó: {totalNoLlamo}</div>
          <div className="bg-green-100 px-3 py-2 rounded">✅ Contestó: {totalContesto}</div>
          <div className="bg-orange-100 px-3 py-2 rounded">❌ No contestó: {totalNoContesto}</div>
          <div className="bg-gray-200 px-3 py-2 rounded">📋 No se registró: {totalNoRegistro}</div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
          <input
            type="date"
            value={filtros.fecha}
            onChange={(e) => setFiltros({ ...filtros, fecha: e.target.value })}
            className="px-4 py-2 border rounded-md"
          />
          <input
            type="text"
            placeholder="Buscar cliente..."
            value={filtros.cliente}
            onChange={(e) => setFiltros({ ...filtros, cliente: e.target.value })}
            className="px-4 py-2 border rounded-md"
          />
          
          <select
            value={filtros.tramo}
            onChange={(e) => setFiltros({ ...filtros, tramo: e.target.value })}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los tramos</option>
            <option value="08:00">Primer Tramo</option>
            <option value="12:00">Segundo Tramo</option>
            <option value="16:00">Tercer Tramo</option>
          </select>

          <select
            value={filtros.coordinador}
            onChange={(e) => setFiltros({ ...filtros, coordinador: e.target.value })}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los coordinadores</option>
            {coordinadoresUnicos.map(c => (
              <option key={c.uid} value={c.uid}>{c.nombre}</option>
            ))}
          </select>

          <select
            value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
            className="px-4 py-2 border rounded-md"
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
            onChange={(e) => setFiltros({ ...filtros, gestor: e.target.value })}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los gestores</option>
            {gestoresUnicos.map(g => (
              <option key={g.uid} value={g.uid}>{g.nombre}</option>
            ))}
          </select>

          <input
            list="lista-cuadrillas"
            type="text"
            placeholder="Buscar cuadrilla..."
            value={filtros.cuadrilla || ""}
            onChange={(e) => setFiltros({ ...filtros, cuadrilla: e.target.value })}
            className="px-4 py-2 border rounded-md"
          />
          <datalist id="lista-cuadrillas">
            {[...new Set(instalaciones.map(i => i.cuadrillaNombre).filter(Boolean))].map((nombre, idx) => (
              <option key={idx} value={nombre} />
            ))}
          </datalist>

          {/* ESTE ES EL SELECT QUE YA HABÍAS AÑADIDO EN EL PASO ANTERIOR */}
          <select 
            value={filtros.estadoLlamada} 
            onChange={(e) => setFiltros({ ...filtros, estadoLlamada: e.target.value })} 
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los estados de llamada</option>
            <option value="Contesto">Contesto</option>
            <option value="No Contesto">No Contesto</option>
            <option value="No se Registro">No se Registro</option>
            <option value="noLlamo">📞 No se llamó</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ... (resto de tu tabla, que ya usa `instalacionesFiltradas`) ... */}
        <table className="w-full text-xs md:text-sm border-collapse">
          <thead className="bg-[#30518c] text-white text-sm font-semibold sticky top-0">
            <tr>
              {['Cliente', 'Código', 'Documento', 'Plan', 'Dirección', 'Teléfono', 'Cuadrilla', 'Gestor', 'Tipo Servicio', 'Tramo', 'Estado', 'Inicio Llamada', 'Fin Llamada', 'Estado Llamada', 'Observación', 'Acciones'].map((col) => (
                <th key={col} className="p-2 whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instalacionesFiltradas.map((inst) => (
              <tr key={inst.id} className="border-b">
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.cliente}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.codigoCliente}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.documento}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.plan}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.direccion}</td>
                <td className="p-2 whitespace-nowrap">
                  {editandoId === inst.id ? (
                    <input type="text" value={form.telefono || ""} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="border border-black px-2 py-1 rounded w-full" />
                  ) : inst.telefono}
                </td>
                <td className="p-2 whitespace-normal max-w-[250px]">
                  {inst.cuadrillaNombre || inst.cuadrilla || "-"}
                </td>
                <td className="p-2 whitespace-normal max-w-[250px]">
                  {mapaGestores[inst.gestorCuadrilla] || "-"}
                </td>
                <td className="p-2 whitespace-normal max-w-[250px]">{inst.tipoServicio}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">
                  {obtenerNombreTramo(inst.tramo)}
                </td>
                <td className="p-2 whitespace-normal max-w-[250px]">
                  <span className={`px-2 py-1 rounded-full text-xs ${inst.estado === "Cancelada" ? "bg-red-100 text-red-800" : inst.estado === "Finalizada" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                    {inst.estado || "-"}
                  </span>
                </td>
                <td className="p-2 whitespace-normal max-w-[250px]">{editandoId === inst.id ? (
                  <input type="time" value={form.horaInicioLlamada || ""} onChange={(e) => setForm({ ...form, horaInicioLlamada: e.target.value })} className="border border-black px-2 py-1 rounded w-full" />
                ) : inst.horaInicioLlamada || '-'}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{editandoId === inst.id ? (
                  <input type="time" value={form.horaFinLlamada || ""} onChange={(e) => setForm({ ...form, horaFinLlamada: e.target.value })} className="border border-black px-2 py-1 rounded w-full" />
                ) : inst.horaFinLlamada || '-'}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{editandoId === inst.id ? (
                  <select value={form.estadoLlamada || ""} onChange={(e) => setForm({ ...form, estadoLlamada: e.target.value })} className="border border-black px-2 py-1 rounded w-full">
                    <option value="">--</option>
                    <option value="Contesto">Contesto</option>
                    <option value="No Contesto">No Contesto</option>
                    <option value="No se Registro">No se Registro</option>
                  </select>
                ) : inst.estadoLlamada || '-'}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">{editandoId === inst.id ? (
                  <input type="text" value={form.observacionLlamada || ""} onChange={(e) => setForm({ ...form, observacionLlamada: e.target.value })}  className="border border-black px-2 py-1 rounded w-full" />
                ) : inst.observacionLlamada || '-'}</td>
                <td className="p-2 whitespace-normal max-w-[250px]">
                  {editandoId === inst.id ? (
                    <>
                      <button onClick={() => handleGuardar(inst.id)} className="bg-green-600 text-white px-2 py-1 rounded">Guardar</button>
                      <button onClick={() => setEditandoId(null)} className="bg-gray-400 text-white px-2 py-1 rounded">Cancelar</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditandoId(inst.id); setForm(inst); }} className="bg-blue-600 text-white px-2 py-1 rounded">Editar</button>
                  )}
                </td>
              </tr>
            ))}
            {instalacionesFiltradas.length === 0 && (
              <tr>
                <td colSpan={16} className="text-center py-4"> {/* Actualizado colSpan a 16 */}
                  No hay instalaciones para los filtros seleccionados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}