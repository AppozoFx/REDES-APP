"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";


export default function InstalacionesGerencia() {
  const { userData } = useAuth();
  const [instalaciones, setInstalaciones] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [horaActual, setHoraActual] = useState(dayjs());
  const [filtros, setFiltros] = useState({
    fecha: dayjs().format("YYYY-MM-DD"),
    gestor: "",
    coordinador: "",
    cuadrilla: "",
    estado: "",
    alerta: "",
    estadoLlamada: "", // Agregado para evitar undefined
    tramo: "" // ✅ nuevo filtro agregado
  });
  
  

  useEffect(() => {
    const fetchData = async () => {
      const [instSnap, cuadSnap, userSnap] = await Promise.all([
        getDocs(collection(db, "instalaciones")),
        getDocs(collection(db, "cuadrillas")),
        getDocs(collection(db, "usuarios")),
      ]);

      setInstalaciones(instSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setCuadrillas(cuadSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setUsuarios(userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchData();
  }, []);

  // Mapa de usuarios por UID
  const mapaUsuarios = {};
  usuarios.forEach(u => {
    if (u.id && u.nombres && u.apellidos) {
      mapaUsuarios[u.id] = `${u.nombres} ${u.apellidos}`;
    }
  });
  


  useEffect(() => {
    const intervalo = setInterval(() => {
      setHoraActual(dayjs());
    }, 1000);
    return () => clearInterval(intervalo);
  }, []);

  const obtenerNombreTramo = (hora) => {
    switch (hora) {
      case "08:00": return "Primer Tramo";
      case "12:00": return "Segundo Tramo";
      case "16:00": return "Tercer Tramo";
      default: return hora || "-";
    }
  };

  const gestoresUnicos = [
    ...new Set(instalaciones.map(i => i.gestorCuadrilla).filter(Boolean))
  ].map(uid => ({
    uid,
    nombre: mapaUsuarios[uid] || uid
  }));
  
  const coordinadoresUnicos = [
    ...new Set(instalaciones.map(i => i.coordinadorCuadrilla).filter(Boolean))
  ].map(uid => ({
    uid,
    nombre: mapaUsuarios[uid] || uid,
  }));
  

  const fueraDeToleranciaEnCamino = (inst) => {
    if (!inst.tramo || !inst.horaEnCamino) return false;
    const horaTramo = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.tramo}`);
    const horaEnCamino = dayjs(`${dayjs().format('YYYY-MM-DD')} ${inst.horaEnCamino}`, 'YYYY-MM-DD HH:mm');
    return horaEnCamino.isAfter(horaTramo.add(15, 'minute'));
  };

  const sinGestionTotal = (inst) => {
    return !inst.horaEnCamino && !inst.horaInicio && !inst.horaFin;
  };

  const instalacionesFiltradas = instalaciones.filter((inst) => {
    let fechaInst = "";
    if (inst.fechaInstalacion) {
      if (typeof inst.fechaInstalacion === "string") {
        fechaInst = dayjs(inst.fechaInstalacion).format("YYYY-MM-DD");
      } else if (typeof inst.fechaInstalacion.toDate === "function") {
        fechaInst = dayjs(inst.fechaInstalacion.toDate()).format("YYYY-MM-DD");
      }
    }
  
    const fechaCoincide = fechaInst === filtros.fecha;
    const gestorCoincide =
  filtros.gestor === "" || inst.gestorCuadrilla === filtros.gestor;

      const tramoCoincide = filtros.tramo === "" || inst.tramo === filtros.tramo;
      const cuadrillaCoincide = 
  filtros.cuadrilla === "" || 
  (inst.cuadrillaNombre?.toLowerCase().includes(filtros.cuadrilla.toLowerCase())) || 
  (inst.cuadrilla?.toLowerCase().includes(filtros.cuadrilla.toLowerCase()));

    
    const estadoCoincide = filtros.estado === "" || inst.estado === filtros.estado;
  
    const alertaCoincide =
      filtros.alerta === "" ||
      (filtros.alerta === "tolerancia" && fueraDeToleranciaEnCamino(inst)) ||
      (filtros.alerta === "sinaction" && sinGestionTotal(inst));
  
    const estadoLlamadaCoincide =
      filtros.estadoLlamada === "" ||
      (filtros.estadoLlamada === "noLlamo" && !inst.estadoLlamada) ||
      inst.estadoLlamada === filtros.estadoLlamada;
  
      const coordinadorCoincide =
      filtros.coordinador === "" || inst.coordinadorCuadrilla === filtros.coordinador;
    

  
    return (
      fechaCoincide &&
      gestorCoincide &&
      cuadrillaCoincide &&
      estadoCoincide &&
      coordinadorCoincide &&
      alertaCoincide &&
      estadoLlamadaCoincide &&
      tramoCoincide // ✅ agregado aquí
    );
  });
  

  const totalFueraTolerancia = instalacionesFiltradas.filter(fueraDeToleranciaEnCamino).length;
  const totalSinGestion = instalacionesFiltradas.filter(sinGestionTotal).length;
  const totalNoLlamo = instalacionesFiltradas.filter(i => !i.estadoLlamada).length;
  const totalContesto = instalacionesFiltradas.filter(i => i.estadoLlamada === "Contesto").length;
  const totalNoContesto = instalacionesFiltradas.filter(i => i.estadoLlamada === "No Contesto").length;
  const totalNoRegistro = instalacionesFiltradas.filter(i => i.estadoLlamada === "No se Registro").length;

  const exportarExcel = () => {
    const data = instalacionesFiltradas.map(inst => ({
      Fecha: inst.fechaInstalacion?.toDate
        ? dayjs(inst.fechaInstalacion.toDate()).format("YYYY-MM-DD")
        : inst.fechaInstalacion || "",
      Cliente: inst.cliente,
      CódigoCliente: inst.codigoCliente,
      Documento: inst.documento,
      Cuadrilla: inst.cuadrilla,
      TipoServicio: inst.tipoServicio,
      Tramo: obtenerNombreTramo(inst.tramo),
      Estado: inst.estado,
      HoraEnCamino: inst.horaEnCamino || "-",
      HoraInicio: inst.horaInicio || "-",
      HoraFin: inst.horaFin || "-",
      Gestor: mapaUsuarios[inst.gestorCuadrilla] || "-",  // 👈 CORREGIDO
      EstadoLlamada: inst.estadoLlamada || "No se llamó",
      HoraInicioLlamada: inst.horaInicioLlamada || "-",
      HoraFinLlamada: inst.horaFinLlamada || "-",
      ObservacionLlamada: inst.observacionLlamada || "-",
      Plan: inst.plan,
      Dirección: inst.direccion
    }));
  
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte Gerencia");
  
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, `REPORTE-GERENCIA-${dayjs().format("YYYY-MM-DD_HH-mm-ss")}.xlsx`);
  };
  

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <h2 className="text-2xl font-bold text-center text-[#30518c]">Instalaciones - Gerencia</h2>
      <p className="text-center text-shadow-md"><span className="text-[#30518c] font-bold text-2xl tracking-widest">🕒 Hora actual: {horaActual.format("HH:mm:ss")}</span></p>

      <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-center text-gray-700 mt-4 mb-6">
  <div className="bg-gray-100 px-3 py-2 rounded">Total: {instalacionesFiltradas.length}</div>
  <div className="bg-red-100 px-3 py-2 rounded">📌 Fuera de tolerancia: {totalFueraTolerancia}</div>
  <div className="bg-red-200 px-3 py-2 rounded">🛠️ Sin gestión: {totalSinGestion}</div>
  <div className="bg-yellow-100 px-3 py-2 rounded">📞 No se llamó: {totalNoLlamo}</div>
  <div className="bg-green-100 px-3 py-2 rounded">✅ Contestó: {totalContesto}</div>
  <div className="bg-orange-100 px-3 py-2 rounded">❌ No contestó: {totalNoContesto}</div>
  <div className="bg-gray-200 px-3 py-2 rounded">📋 No se registró: {totalNoRegistro}</div>
</div>

      <div className="text-center text-sm text-gray-700 mt-2 mb-4">
        <p><span className="text-red-700 font-bold">📌 Fuera de tolerancia</span> :Pasado 15 minutos de inicio de tramo</p>
        <p><span className="text-red-900 font-bold">💤 Sin gestión</span> : Sin gestión</p>
      </div>

      <div className="flex flex-wrap gap-4 justify-center mb-6">
        <input type="date" value={filtros.fecha} onChange={(e) => setFiltros({ ...filtros, fecha: e.target.value })} className="px-4 py-2 border rounded-md" />
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
  value={filtros.tramo}
  onChange={(e) => setFiltros({ ...filtros, tramo: e.target.value })}
  className="px-4 py-2 border rounded-md"
>
  <option value="">Todos los tramos</option>
  <option value="08:00">Primer Tramo</option>
  <option value="12:00">Segundo Tramo</option>
  <option value="16:00">Tercer Tramo</option>
</select>

        <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })} className="px-4 py-2 border rounded-md">
          <option value="">Todos los estados</option>
          <option value="Agendada">Agendada</option>
          <option value="En camino">En camino</option>
          <option value="Cancelada">Cancelada</option>
          <option value="Finalizada">Finalizada</option>
          <option value="Reprogramada">Reprogramada</option>
          <option value="Iniciada">Iniciada</option>
          <option value="Regestión">Regestión</option>
        </select>
        <select value={filtros.estadoLlamada} onChange={(e) => setFiltros({ ...filtros, estadoLlamada: e.target.value })} className="px-4 py-2 border rounded-md">
          <option value="">Todos los estados de llamada</option>
          <option value="Contesto">Contesto</option>
          <option value="No Contesto">No Contesto</option>
          <option value="No se Registro">No se Registro</option>
          <option value="noLlamo">📞 No se llamó</option>
        </select>
        <select value={filtros.alerta} onChange={(e) => setFiltros({ ...filtros, alerta: e.target.value })} className="px-4 py-2 border rounded-md">
          <option value="">Todas las alertas</option>
          <option value="tolerancia">📌 Fuera de tolerancia</option>
          <option value="sinaction">💤 Sin gestión</option>
        </select>
        


        <input
  list="lista-cuadrillas"
  type="text"
  placeholder="Buscar cuadrilla..."
  value={filtros.cuadrilla}
  onChange={(e) => setFiltros({ ...filtros, cuadrilla: e.target.value })}
  className="px-4 py-2 border rounded-md"
/>

<datalist id="lista-cuadrillas">
  {[...new Set(instalaciones.map(i => i.cuadrillaNombre).filter(Boolean))].map((nombre, idx) => (
    <option key={idx} value={nombre} />
  ))}
</datalist>




        <button
  onClick={exportarExcel}
  className="px-4 py-2 bg-[#30518c] text-white rounded-md hover:bg-[#24406d] transition"
>
  📥 Exportar a Excel
</button>
      </div>




      <div className="overflow-auto">
   

        <table className="w-full text-xs md:text-sm border">
          <thead className="bg-[#30518c] text-white sticky top-0">
            <tr>
              {['Cliente', 'Código', 'Documento', 'Cuadrilla', 'Tipo Servicio', 'Tramo', 'Estado', 'En Camino', 'Inicio', 'Fin', 'Gestor', 'Estado Llamada', 'Inicio Llamada', 'Fin Llamada', 'Observación', 'Plan', 'Dirección'].map(col => (
                <th key={col} className="p-2 whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instalacionesFiltradas.map(inst => (
              <tr key={inst.id} className="border-b">
                <td className="p-2">{inst.cliente}</td>
                <td className="p-2">{inst.codigoCliente}</td>
                <td className="p-2">{inst.documento}</td>
                <td className="p-2">{inst.cuadrillaNombre || inst.cuadrilla || "-"}</td>
                <td className="p-2">{inst.tipoServicio}</td>
                <td className="p-2">{obtenerNombreTramo(inst.tramo)}</td>
                <td className="p-2">
  <span className={`px-2 py-1 rounded-full text-xs border border-gray-300
    ${inst.estado === "Cancelada" ? "bg-red-100 text-red-800" : ""}
    ${inst.estado === "Iniciada" ? "bg-green-100 text-green-800" : ""}
    ${inst.estado === "En camino" ? "bg-purple-100 text-purple-800" : ""}
    ${inst.estado === "Finalizada" ? "bg-blue-100 text-blue-800" : ""}
    ${inst.estado === "Reprogramada" ? "bg-yellow-100 text-yellow-800" : ""}
    ${inst.estado === "Agendada" ? "bg-orange-100 text-orange-800" : ""}
    ${inst.estado === "Regestión" ? "bg-gray-200 text-gray-800" : ""}
  `}>
    {inst.estado || "-"}
  </span>
</td>

                <td className={`p-2 text-center ${
  fueraDeToleranciaEnCamino(inst)
    ? 'bg-red-100 text-red-700 font-bold'
    : sinGestionTotal(inst)
    ? 'bg-red-200 text-red-900 font-bold'
    : inst.horaEnCamino && !fueraDeToleranciaEnCamino(inst)
    ? 'bg-green-100 text-green-800 font-bold'
    : ''
}`}>
  {inst.horaEnCamino || '-'}
  {fueraDeToleranciaEnCamino(inst) && <span title="Fuera de hora"> ⚠️</span>}
  {sinGestionTotal(inst) && <span title="Sin gestión"> ⚠️</span>}
  {!fueraDeToleranciaEnCamino(inst) && inst.horaEnCamino && <span title="Dentro del horario"> ✅</span>}
</td>
                <td className="p-2">{inst.horaInicio || '-'}</td>
                <td className="p-2">{inst.horaFin || '-'}</td>
                <td className="p-2">{mapaUsuarios[inst.gestorCuadrilla] || "-"}</td>
                <td className="p-2">{inst.estadoLlamada}</td>
                <td className="p-2">{inst.horaInicioLlamada}</td>
                <td className="p-2">{inst.horaFinLlamada}</td>
                <td className="p-2">{inst.observacionLlamada}</td>
                <td className="p-2">{inst.plan}</td>
                <td className="p-2">{inst.direccion}</td>
              </tr>
            ))}
            {instalacionesFiltradas.length === 0 && (
              <tr>
                <td colSpan={17} className="text-center py-4">No hay resultados con los filtros aplicados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}