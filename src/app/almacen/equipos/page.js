"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/context/AuthContext";
import {
  addDoc,
  collection,
  getDocs,
  updateDoc,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  limit,
  startAfter,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { format } from "date-fns";
import toast, { Toaster } from "react-hot-toast";
import { differenceInDays, startOfDay } from "date-fns";
import * as XLSX from "xlsx";



export default function EquiposEditable() {
  const [equipos, setEquipos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [editing, setEditing] = useState({});
  const [editandoId, setEditandoId] = useState(null);
  const [filtro, setFiltro] = useState("");
const [filtroEstado, setFiltroEstado] = useState("");
const [filtroUbicacion, setFiltroUbicacion] = useState("");
const [filtroPriTec, setFiltroPriTec] = useState("");
const [filtroTecLiq, setFiltroTecLiq] = useState("");
const [filtroInv, setFiltroInv] = useState("");
const { userData } = useAuth();


  const [ultimoDoc, setUltimoDoc] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [filtroAlerta, setFiltroAlerta] = useState(false);



  const opcionesExtra = ["garantía", "avería", "robo", "pérdida"];

  // 🚀 Cargar equipos con paginación
  const cargarEquipos = async () => {
    setCargando(true);
    try {
      const snap = await getDocs(collection(db, "equipos"));
      const todos = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setEquipos(todos);
      setHasMore(false);  // Ya no se usa
    } catch (error) {
      console.error("Error cargando equipos:", error);
      toast.error("Error al cargar equipos");
    } finally {
      setCargando(false);
    }
  };

   // 📊 Filtro simple por SN o tipo de equipo
   const filtrarEquipos = useMemo(() => {
    return equipos.filter(e =>
      (e.SN?.toLowerCase().includes(filtro.toLowerCase()) ||
       e.equipo?.toLowerCase().includes(filtro.toLowerCase())) &&
    
      (filtroEstado ? e.estado === filtroEstado : true) &&
      (filtroUbicacion ? e.ubicacion === filtroUbicacion : true) &&
      (filtroPriTec ? e["pri-tec"] === filtroPriTec : true) &&
      (filtroTecLiq ? e["tec-liq"] === filtroTecLiq : true) &&
      (filtroInv ? e["inv"] === filtroInv : true) &&
      (filtroAlerta ? esEquipoEnAlerta(e) : true)   // ✅ Aquí el && correcto
    );
    
  }, [equipos, filtro, filtroEstado, filtroUbicacion, filtroPriTec, filtroTecLiq, filtroInv, filtroAlerta]);
  


  
  // 1️⃣ Primero este
const filtrarEquiposUnicos = useMemo(() => {
  return Array.from(new Map(filtrarEquipos.map((e) => [e.id, e])).values());
}, [filtrarEquipos]);

// 2️⃣ Luego este
const equiposParaTabla = useMemo(() => {
  // Mostrar solo los que NO sean instalados en estado ni en ubicación (si no hay filtros)
  if (!filtro && !filtroEstado && !filtroUbicacion) {
    return filtrarEquiposUnicos.filter(
      e => e.estado !== "instalado" && e.ubicacion !== "instalado"
    );
  }

  // Si aplicas filtros o búsqueda, mostramos todo
  return filtrarEquiposUnicos;
}, [filtrarEquiposUnicos, filtro, filtroEstado, filtroUbicacion]);



const actualizarStockCuadrilla = async (nombreCuadrilla, cantidad, tipoEquipo) => {
  const cuadrillaDoc = cuadrillas.find(c => c.nombre === nombreCuadrilla);
  if (!cuadrillaDoc) {
    console.warn(`⚠️ No se encontró la cuadrilla: ${nombreCuadrilla}`);
    return;
  }

  const stockRef = doc(db, `cuadrillas/${cuadrillaDoc.id}/stock_equipos/${tipoEquipo}`);

  const stockSnap = await getDoc(stockRef);

  if (stockSnap.exists()) {
    const actual = stockSnap.data().cantidad || 0;
    const nuevaCantidad = actual + cantidad;
    await setDoc(stockRef, { cantidad: Math.max(nuevaCantidad, 0), tipo: tipoEquipo });
  } else {
    // Si no existe, lo creamos solo si la cantidad es positiva
    if (cantidad > 0) {
      await setDoc(stockRef, { cantidad: cantidad, tipo: tipoEquipo });
    }
  }
};

  

  
  

  useEffect(() => {
    const fetchData = async () => {
      const cuadrillaSnap = await getDocs(
        query(collection(db, "cuadrillas"), where("estado", "==", "activo"))
      );
      setCuadrillas(
        cuadrillaSnap.docs.map((doc) => ({
          id: doc.id,   // 👈 Agrega esto
          nombre: doc.data().nombre?.trim(),
          tecnicos: doc.data().tecnicos,
        }))
      );
      

      const usuariosSnap = await getDocs(collection(db, "usuarios"));
      setUsuarios(
        usuariosSnap.docs.map((doc) => ({
          uid: doc.id,
          ...doc.data(),
        }))
      );
    };

    fetchData();
    cargarEquipos();
  }, []);


const esEquipoEnAlerta = (equipo) => {
  if (!equipo.f_ingreso) return false;  // Si no hay fecha, no marcamos alerta.

  const hoy = startOfDay(new Date());
  const fechaIngreso = startOfDay(equipo.f_ingreso?.toDate?.() || new Date(equipo.f_ingreso));

  const diasEnSistema = differenceInDays(hoy, fechaIngreso);

  // ✅ Solo si estado es "campo" y supera los 15 días
  return equipo.estado === "campo" && diasEnSistema > 15;
};

  

 
  


  // 🗓️ Formatear fechas
  const parseFecha = (val) => {
    if (!val) return "";
    if (val.toDate) return format(val.toDate(), "d/M/yyyy");
    const fecha = new Date(val);
    return isNaN(fecha.getTime()) ? "" : format(fecha, "d/M/yyyy");
  };

  // 👥 Mostrar técnicos según lógica combinada
  const mostrarTecnicos = (equipo) => {
    if (equipo.tecnicos && equipo.tecnicos.length > 0) {
      return Array.isArray(equipo.tecnicos) ? equipo.tecnicos.join(", ") : equipo.tecnicos;
    }

    const cuadrilla = cuadrillas.find((c) => c.nombre === equipo.ubicacion);
    if (!cuadrilla || !cuadrilla.tecnicos) return "-";

    const nombres = cuadrilla.tecnicos
      .map((uid) => {
        const usuario = usuarios.find((u) => u.uid === uid);
        return usuario ? `${usuario.nombres} ${usuario.apellidos}` : null;
      })
      .filter(Boolean);

    return nombres.length ? nombres.join(", ") : "-";
  };

  // 📍 Opciones de ubicación
  const generarOpcionesUbicacion = (ubicacionActual) => {
    const nombresCuadrillas = cuadrillas.map((c) => c.nombre).filter(Boolean);
    const baseOpciones = [...nombresCuadrillas, ...opcionesExtra];
  
    // Si la ubicación actual es "almacen", la añadimos dinámicamente
    if (ubicacionActual === "almacen") {
      baseOpciones.push("almacen");
    }
  
    return [...new Set(baseOpciones)].sort((a, b) => a.localeCompare(b));
  };
  

  // 📝 Manejar cambios en campos editables
  const handleChange = (id, field, value) => {
    setEditing((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
        ...(field === "ubicacion"
          ? {
              estado: cuadrillas.map((c) => c.nombre).includes(value)
                ? "campo"
                : "almacen",
            }
          : {}),
      },
    }));
  };

  // ✅ Confirmar y guardar cambios

const confirmarGuardado = (id) => {
  toast(
    (t) => (
      <div>
        <p>💾 ¿Estás seguro de <strong>guardar</strong> los cambios?</p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => {
              guardarCambios(id);
              setEditandoId(null);
              toast.dismiss(t.id);
            }}
            className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition"
          >
            Sí, guardar
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400 transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    ),
    { duration: 10000 }
  );
};


// 🔹 Función principal
const guardarCambios = async (id) => {
  if (!editing[id]) return;

  const equipoOriginal = equipos.find(e => e.id === id);
  const cambios = editing[id];

  try {
    await updateDoc(doc(db, "equipos", id), cambios);

    // ⚡️ Detectar cambio de ubicación
    if (cambios.ubicacion && cambios.ubicacion !== equipoOriginal.ubicacion) {
      const cuadrillasNombres = cuadrillas.map(c => c.nombre);

      const origenEsCuadrilla = cuadrillasNombres.includes(equipoOriginal.ubicacion);
      const destinoEsCuadrilla = cuadrillasNombres.includes(cambios.ubicacion);

      // ➖ Restar stock si sale de una cuadrilla válida
      if (origenEsCuadrilla) {
        await actualizarStockCuadrilla(equipoOriginal.ubicacion, -1, equipoOriginal.equipo);
      }

      // ➕ Sumar stock si llega a una cuadrilla válida
      if (destinoEsCuadrilla) {
        await actualizarStockCuadrilla(cambios.ubicacion, 1, equipoOriginal.equipo);
      }

      // 🚚 Mover el documento del equipo (SN) entre cuadrillas
      if (origenEsCuadrilla || destinoEsCuadrilla) {
        await moverEquipoEntreCuadrillas(equipoOriginal.SN, equipoOriginal, equipoOriginal.ubicacion, cambios.ubicacion);
      }

      // 🚨 Crear Notificación por movimiento
      await addDoc(collection(db, "notificaciones"), {
        tipo: "Movimiento de Equipo",
        mensaje: `🚚 ${userData?.nombres} ${userData?.apellidos} movió ${equipoOriginal.equipo} (SN: ${equipoOriginal.SN}) de "${equipoOriginal.ubicacion}" a "${cambios.ubicacion}"`,
        usuario: `${userData?.nombres} ${userData?.apellidos}`,
        fecha: serverTimestamp(),
        detalles: {
          sn: equipoOriginal.SN,
          equipo: equipoOriginal.equipo,
          de: equipoOriginal.ubicacion,
          a: cambios.ubicacion
        },
        visto: false
      });
      







    }

    toast.success("✅ Cambios guardados y stock actualizado");
    setEquipos((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...cambios } : e))
    );
    setEditing((prev) => {
      const nuevo = { ...prev };
      delete nuevo[id];
      return nuevo;
    });
  } catch (error) {
    toast.error("Error al guardar");
    console.error(error);
  }
};



  const exportarEquipos = () => {
    const fecha = new Date();
    const fechaTexto = `${fecha.getDate()}-${fecha.getMonth() + 1}-${fecha.getFullYear()}`;
    const nombreArchivo = `EQUIPOS-REDES-${fechaTexto}.xlsx`;
  
    if (filtrarEquiposUnicos.length === 0) {
      toast.error("No hay equipos para exportar.");
      return;
    }
  
    const dataExcel = filtrarEquiposUnicos.map(e => ({
      SN: e.SN,
      Estado: e.estado,
      Tecnicos: mostrarTecnicos(e),
      Ubicación: e.ubicacion,
      Equipo: e.equipo,
      "F. Ingreso": parseFecha(e.f_ingreso),
      "F. Despacho": parseFecha(e.f_despacho),
      Cliente: e.cliente,
      "Pri-Tec": e["pri-tec"],
      "Tec-Liq": e["tec-liq"],
      Inv: e["inv"]
    }));
  
    const ws = XLSX.utils.json_to_sheet(dataExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipos");
    XLSX.writeFile(wb, nombreArchivo);
  
    toast.success("📤 Equipos exportados correctamente");
  };


  const exportarPriTec = async () => {
    if (filtrarEquiposUnicos.length === 0) {
      toast.error("No hay equipos para exportar.");
      return;
    }
  
    toast(
      (t) => (
        <div>
          <p>⚠️ Vas a exportar y actualizar la columna <strong>PRI-TEC</strong> a si.</p>
          <p>Esto no se puede revertir.</p>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                segundaConfirmacionPriTec();
              }}
              className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
            >
              Confirmar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };
  
  const segundaConfirmacionPriTec = async () => {
    if (window.confirm("🤔 ¿Estás seguro, individuo? Esta acción actualizará PRI-TEC.")) {
      const fechaTexto = new Date().toLocaleDateString('es-PE').replaceAll('/', '-');
      const nombreArchivo = `PRI-TEC-${filtroPriTec || "Todos"}-${fechaTexto}.xlsx`;
  
      const dataExcel = filtrarEquiposUnicos.map(e => ({
        SN: e.SN,
        "F. Despacho": parseFecha(e.f_despacho),
        Técnicos: mostrarTecnicos(e),
        Ubicación: e.ubicacion
      }));
  
      const ws = XLSX.utils.json_to_sheet(dataExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "PRI-TEC");
      XLSX.writeFile(wb, nombreArchivo);
  
      await Promise.all(
        filtrarEquiposUnicos.map(e => updateDoc(doc(db, "equipos", e.id), { "pri-tec": "si" }))
      );
  
      toast.success("⚡ PRI-TEC exportado y actualizado");
    } else {
      toast("Operación cancelada. 😅", { icon: "❌" });
    }
  };
  
  

  const exportarTecLiq = async () => {
    if (filtrarEquiposUnicos.length === 0) {
      toast.error("No hay equipos para exportar.");
      return;
    }
  
    toast(
      (t) => (
        <div>
          <p>⚠️ Vas a exportar y actualizar la columna <strong>TEC-LIQ</strong> a si.</p>
          <p>Esto no tiene vuelta atrás.</p>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                segundaConfirmacionTecLiq();
              }}
              className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
            >
              Confirmar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };
  
  const segundaConfirmacionTecLiq = async () => {
    if (window.confirm("🤔 ¿Estás seguro, individuo? Esto actualizará TEC-LIQ.")) {
      const fechaTexto = new Date().toLocaleDateString('es-PE').replaceAll('/', '-');
      const nombreArchivo = `TEC-LIQ-${filtroPriTec || "Todos"}-${fechaTexto}.xlsx`;
  
      const dataExcel = filtrarEquiposUnicos.map(e => ({
        SN: e.SN,
        "F. Despacho": parseFecha(e.f_despacho),
        Técnicos: mostrarTecnicos(e),
        Ubicación: e.ubicacion,
        "F. Instalación": parseFecha(e.f_instalado),
        Cliente: e.cliente
      }));

      const ws = XLSX.utils.json_to_sheet(dataExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "TEC-LIQ");
      XLSX.writeFile(wb, nombreArchivo);
  
      await Promise.all(
        filtrarEquiposUnicos.map(e => updateDoc(doc(db, "equipos", e.id), { "tec-liq": "si" }))
      );
  
      toast.success("📦 TEC-LIQ exportado y actualizado");
    } else {
      toast("Operación cancelada. 😅", { icon: "❌" });
    }
  };

  // 🔹 Función auxiliar para mover el documento del equipo entre cuadrillas
const moverEquipoEntreCuadrillas = async (sn, equipoData, origen, destino) => {
  const origenDoc = cuadrillas.find(c => c.nombre === origen);
  const destinoDoc = cuadrillas.find(c => c.nombre === destino);

  if (origenDoc) {
    // Eliminar el documento del equipo en la cuadrilla origen
    await setDoc(doc(db, `cuadrillas/${origenDoc.id}/stock_equipos/${sn}`), {}, { merge: false });
  }

  if (destinoDoc) {
    // Crear el documento del equipo en la cuadrilla destino
    await setDoc(doc(db, `cuadrillas/${destinoDoc.id}/stock_equipos/${sn}`), {
      SN: equipoData.SN,
      descripcion: equipoData.descripcion,
      equipo: equipoData.equipo,
      estado: "campo",
      f_ingreso: equipoData.f_ingreso
    });
  }
};
  
  
  
  

  
  

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h2 className="text-2xl font-semibold mb-4">📋 Equipos (Optimizado)</h2>

      <div className="flex flex-wrap gap-4 mb-4">

    

  {/* Buscar por SN o Tipo */}
  <Input
    value={filtro}
    onChange={(e) => setFiltro(e.target.value)}
    placeholder="🔍 Buscar SN o tipo de equipo"
    className="w-full max-w-xs"
  />

  {/* Estado */}
  <select
    value={filtroEstado}
    onChange={(e) => setFiltroEstado(e.target.value)}
    className="border rounded px-3 py-2"
  >
    <option value="">Estado</option>
    {[...new Set(equipos.map(e => e.estado).filter(Boolean))].map((estado, idx) => (
      <option key={idx} value={estado}>{estado}</option>
    ))}
  </select>

  {/* Ubicación */}
  <select
    value={filtroUbicacion}
    onChange={(e) => setFiltroUbicacion(e.target.value)}
    className="border rounded px-3 py-2"
  >
    <option value="">Ubicación</option>
    {generarOpcionesUbicacion().map((ubic, idx) => (
      <option key={idx} value={ubic}>{ubic}</option>
    ))}
  </select>

  {/* Pri-Tec */}
  <select
    value={filtroPriTec}
    onChange={(e) => setFiltroPriTec(e.target.value)}
    className="border rounded px-3 py-2"
  >
    <option value="">Pri-Tec</option>
    <option value="si">si</option>
    <option value="no">no</option>
  </select>

  {/* Tec-Liq */}
  <select
    value={filtroTecLiq}
    onChange={(e) => setFiltroTecLiq(e.target.value)}
    className="border rounded px-3 py-2"
  >
    <option value="">Tec-Liq</option>
    <option value="si">si</option>
    <option value="no">no</option>
  </select>

  {/* Inv */}
  <select
    value={filtroInv}
    onChange={(e) => setFiltroInv(e.target.value)}
    className="border rounded px-3 py-2"
  >
    <option value="">Inv</option>
    <option value="si">si</option>
    <option value="no">no</option>
  </select>


  
  
  {/* ✅ Filtro de Alerta */}
  <div className="flex items-center gap-2 bg-yellow-100 px-3 py-1 rounded">
  <input
    type="checkbox"
    checked={filtroAlerta}
    onChange={(e) => setFiltroAlerta(e.target.checked)}
    className="accent-yellow-500"
  />
  <label className="text-sm font-medium text-yellow-700">Equipos con Antiguamiento ⚠️</label>
</div>



<Button
  size="sm"
  className="flex items-center gap-2 bg-[#30518c] hover:bg-[#27406f] text-white font-semibold rounded-full px-4 py-2 transition shadow"
  onClick={() => {
    setFiltro("");
    setFiltroEstado("");
    setFiltroUbicacion("");
    setFiltroPriTec("");
    setFiltroTecLiq("");
    setFiltroInv("");
    setFiltroAlerta(false);   // ✅ Añadimos esto
  }}
>
  🧹 Limpiar filtros
</Button>
<div className="flex flex-wrap gap-4 mb-6">
  <Button
    onClick={exportarEquipos}
    className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white font-semibold rounded-xl px-5 py-2 shadow-md transition"
  >
    📁 Exportar Equipos
  </Button>

  <Button
    onClick={exportarPriTec}
    className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-purple-700 hover:from-purple-600 hover:to-purple-800 text-white font-semibold rounded-xl px-5 py-2 shadow-md transition"
  >
    ⚡ Exportar PRI-TEC
  </Button>

  <Button
    onClick={exportarTecLiq}
    className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 text-white font-semibold rounded-xl px-5 py-2 shadow-md transition"
  >
    📦 Exportar TEC-LIQ
  </Button>
</div>




</div>

{(filtro || filtroEstado || filtroUbicacion || filtroPriTec || filtroTecLiq || filtroInv) && (
  <div className="mb-4 text-sm text-gray-600 flex flex-wrap gap-2">
    <span>🔎 <strong>Filtros aplicados:</strong></span>
    {filtro && <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">Buscar: {filtro}</span>}
    {filtroEstado && <span className="bg-green-100 text-green-800 px-2 py-1 rounded">Estado: {filtroEstado}</span>}
    {filtroUbicacion && <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Ubicación: {filtroUbicacion}</span>}
    {filtroPriTec && <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">Pri-Tec: {filtroPriTec}</span>}
    {filtroTecLiq && <span className="bg-pink-100 text-pink-800 px-2 py-1 rounded">Tec-Liq: {filtroTecLiq}</span>}
    {filtroInv && <span className="bg-red-100 text-red-800 px-2 py-1 rounded">Inv: {filtroInv}</span>}
  </div>
)}



     

      <div className="overflow-auto max-h-[80vh] border rounded">
       <table className="min-w-[1500px] text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="p-2">SN</th>
              <th className="p-2">F. Despacho</th>
              <th className="p-2">Técnicos</th>
              <th className="p-2">F. Instalación</th>
              <th className="p-2">Cliente</th>
              <th className="p-2">F. Ingreso</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Ubicación</th>
              <th className="p-2">Equipo</th>
              <th className="p-2">Caso</th>
              <th className="p-2">Observación</th>
              <th className="p-2">Pri-Tec</th>
              <th className="p-2">Tec-Liq</th>
              <th className="p-2">Inv</th>
              <th className="p-2">Acción</th>
            </tr>
          </thead>
          <tbody>
          {equiposParaTabla.map((e) => ( 
              <tr key={e.id} className="border-t">
                <td className="p-2 font-mono">{e.SN}</td>
                <td className="p-2">{parseFecha(e.f_despacho)}</td>
                <td className="p-2">{mostrarTecnicos(e)}</td>
                <td className="p-2">{parseFecha(e.f_instalado)}</td>
                <td className="p-2">{e.cliente}</td>
                <td className={`p-2 font-semibold ${esEquipoEnAlerta(e) ? 'bg-red-100 text-red-700 rounded' : ''}`}>
  {parseFecha(e.f_ingreso)}
  {esEquipoEnAlerta(e) && <span className="ml-2">⚠️</span>}
</td>

                <td className={`p-2 font-semibold ${esEquipoEnAlerta(e) ? 'bg-red-100 text-red-700 rounded' : ''}`}>
  {e.estado}
  {esEquipoEnAlerta(e) && <span className="ml-2"></span>}
</td>

                <td className="p-2">
                <select
  value={editing[e.id]?.ubicacion ?? e.ubicacion ?? ""}
  onChange={(ev) => handleChange(e.id, "ubicacion", ev.target.value)}
  disabled={editandoId !== e.id}
  className="border rounded px-2 py-1"
>
  <option value="">Selecciona ubicación</option>
  {generarOpcionesUbicacion(editing[e.id]?.ubicacion ?? e.ubicacion).map((op, idx) => (
    <option key={`${op}-${idx}`} value={op}>{op}</option>
  ))}
</select>

                </td>
                <td className="p-2">{e.equipo}</td>
                <td className="p-2">
                  <Input
                    value={editing[e.id]?.caso ?? e.caso ?? ""}
                    onChange={(ev) => handleChange(e.id, "caso", ev.target.value)}
                    disabled={editandoId !== e.id}
                  />
                </td>
                <td className="p-2">
                  <Input
                    value={editing[e.id]?.observacion ?? e.observacion ?? ""}
                    onChange={(ev) => handleChange(e.id, "observacion", ev.target.value)}
                    disabled={editandoId !== e.id}
                  />
                </td>
                {["pri-tec", "tec-liq", "inv"].map((key) => (
  <td className="p-2" key={key}>
    <select
      value={
        (editing[e.id]?.[key] ?? e[key] ?? "no") === "si" ? "si" : "no"
      }
      onChange={(ev) => handleChange(e.id, key, ev.target.value)}
      disabled={editandoId !== e.id}
      className="border rounded px-2 py-1"
    >
      <option value="no">no</option>
      <option value="si">si</option>
    </select>
  </td>
))}

<td className="p-2">
  {editandoId === e.id ? (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg px-4 py-2 transition"
        onClick={() => confirmarGuardado(e.id)}   
      >
        <span>💾</span> Guardar
      </Button>
      <Button
        size="sm"
        className="flex items-center gap-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg px-4 py-2 transition"
        onClick={() => setEditandoId(null)}
      >
        <span>✖</span> Cancelar
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 transition"
      onClick={() => setEditandoId(e.id)}
    >
      <span>✏️</span> Editar
    </Button>
  )}
</td>



              </tr>
            ))}
          </tbody>
        </table>

        {!cargando && filtrarEquiposUnicos.length === 0 && (
          <p className="text-center text-gray-500 my-4">No hay equipos disponibles.</p>
        )}

        {hasMore && (
          <div className="text-center my-4">
            <Button onClick={cargarEquipos} disabled={cargando}>
              {cargando ? "Cargando..." : "Cargar más"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
