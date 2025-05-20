"use client";

import { useEffect, useState } from "react";

import { db } from "@/firebaseConfig";
import { onSnapshot, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";

import dayjs from "dayjs";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import toast from "react-hot-toast";
import FormularioLiquidacion from "@/app/components/FormularioLiquidacion";


export default function LiquidacionInstalaciones() {
  const [instalaciones, setInstalaciones] = useState([]);
  const [filtros, setFiltros] = useState({
    fecha: dayjs().format("YYYY-MM-DD"),
    cuadrilla: "",
  });

  const [cargando, setCargando] = useState(false);
  const [instalacionSeleccionada, setInstalacionSeleccionada] = useState(null);
  const [liquidadasInfo, setLiquidadasInfo] = useState({});

  const [procesandoId, setProcesandoId] = useState(null);
  const totalFinalizadas = instalaciones.length;
  const totalLiquidadas = Object.entries(liquidadasInfo).filter(([id, liq]) => {
    if (!liq.fechaInstalacion) return false;
  
    const coincideFecha = dayjs(liq.fechaInstalacion).format("YYYY-MM-DD") === filtros.fecha;
    const coincideCuadrilla = filtros.cuadrilla === "" 
      || (liq.cuadrillaNombre?.toLowerCase().includes(filtros.cuadrilla.toLowerCase()));
  
    return coincideFecha && coincideCuadrilla;
  }).length;
  const [listaLiquidaciones, setListaLiquidaciones] = useState([]);
  
  
  
  
  
  
const totalPendientes = totalFinalizadas - totalLiquidadas;
const { userData } = useAuth();  // 👈 Aquí accedemos a userData
const [actualizacion, setActualizacion] = useState(0);




const obtenerLiquidadas = async () => {
  try {
    const snapshot = await getDocs(collection(db, "liquidacion_instalaciones"));
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setListaLiquidaciones(data);  // Asegúrate de tener este estado en page.js
  } catch (error) {
    console.error("Error al obtener las liquidaciones:", error);
  }
};



  // Obtener instalaciones filtradas
  const obtenerInstalaciones = async () => {
    setCargando(true);
    try {
      const ref = collection(db, "instalaciones");
      const q = query(
        ref,
        where("estado", "==", "Finalizada"),
        where("tipoServicio", "!=", "GARANTIA")
      );

      const snapshot = await getDocs(q);
      let resultados = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      resultados = resultados.filter(inst => {
        const fechaInstalacion = inst.fechaInstalacion 
          ? dayjs(inst.fechaInstalacion.toDate ? inst.fechaInstalacion.toDate() : inst.fechaInstalacion).format("YYYY-MM-DD")
          : "";

        const coincideFecha = fechaInstalacion === filtros.fecha;
        const coincideCuadrilla = filtros.cuadrilla === "" || inst.cuadrillaNombre?.toLowerCase().includes(filtros.cuadrilla.toLowerCase());

        return coincideFecha && coincideCuadrilla;
      });

      setInstalaciones(resultados);
    } catch (error) {
      console.error("Error al obtener instalaciones:", error);
      toast.error("No se pudieron cargar las instalaciones");
    }
    setCargando(false);
  };

  useEffect(() => {
    obtenerInstalaciones();
  }, [filtros]);

  useEffect(() => {
    const ref = collection(db, "liquidacion_instalaciones");
  
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      const info = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
  
        let fechaInstalacion = null;
        if (data.fechaInstalacion?.toDate) {
          fechaInstalacion = data.fechaInstalacion.toDate();
        } else if (typeof data.fechaInstalacion === "string") {
          fechaInstalacion = new Date(data.fechaInstalacion);
        }
  
        info[doc.id] = {
          corregido: data.corregido === true,
          fechaInstalacion,
          fechaLiquidacion: data.fechaLiquidacion?.toDate?.() || null,
          cuadrillaNombre: data.cuadrillaNombre || "",
        };
      });
  
      setLiquidadasInfo(info);
    });
  
    return () => unsubscribe();
  }, []);
  
  
  
  


  const manejarCorreccion = (instalacion) => {
    // ️⃣ Mostrar Toast de Confirmación
    toast((t) => (
      <div className="p-4 max-w-xs">
        <p className="font-semibold mb-2">🔧 ¿Confirmar corrección?</p>
        <p className="text-sm text-gray-700 mb-4">
          ¿Estás seguro de corregir la liquidación de <strong>{instalacion.cliente}</strong>?
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="bg-gray-300 text-gray-800 px-3 py-1 rounded hover:bg-gray-400"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancelar
          </button>
          <button
            className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600"
            onClick={() => {
              toast.dismiss(t.id);
              procesarCorreccion(instalacion);
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    ), { duration: 10000, position: "top-center" });
  };


  const procesarCorreccion = async (instalacion) => {
    try {
      toast.loading("Procesando corrección...");
  
      const docRef = doc(db, "liquidacion_instalaciones", instalacion.codigoCliente);
      const docSnap = await getDoc(docRef);
  
      if (!docSnap.exists()) {
        toast.dismiss();
        toast.error("No se encontró la liquidación.");
        return;
      }
  
      const datosLiquidacion = docSnap.data();
  
      const snEquipos = [
        datosLiquidacion.snONT,
        ...(datosLiquidacion.snMESH || []),
        ...(datosLiquidacion.snBOX || []),
        datosLiquidacion.snFONO
      ].filter(Boolean);
  
      for (const sn of snEquipos) {
        const q = query(collection(db, "equipos"), where("SN", "==", sn));
        const querySnap = await getDocs(q);
  
        if (!querySnap.empty) {
          const equipoDoc = querySnap.docs[0];
          const equipoData = equipoDoc.data();
  
          const stockRef = doc(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`, sn);
          await setDoc(stockRef, {
            ...equipoData,
            devueltoPor: `${userData.nombres} ${userData.apellidos}`,
            fechaDevolucion: serverTimestamp()
          });
  
          await updateDoc(equipoDoc.ref, {
            estado: "campo",
            ubicacion: instalacion.cuadrillaNombre || instalacion.cuadrillaId
          });
        }
      }
  
      await updateDoc(docRef, {
        corregido: true,
        correccionFecha: serverTimestamp(),
        corregidoPor: `${userData.nombres} ${userData.apellidos}`
      });
  
      await addDoc(collection(db, "notificaciones"), {
        tipo: "Corrección",
        mensaje: `🔧 Se corrigió la liquidación de ${instalacion.cliente}.`,
        codigoCliente: instalacion.codigoCliente,
        usuario: `${userData.nombres} ${userData.apellidos}`,
        fecha: serverTimestamp()
      });
  
      toast.dismiss();
      toast.success("✅ Liquidación corregida exitosamente.");
  
      // 🔹 Actualizar el estado directamente
      setLiquidadasInfo(prev => ({
        ...prev,
        [instalacion.codigoCliente]: {
          ...prev[instalacion.codigoCliente],
          corregido: true
        }
      }));
  
      // 🔄 Sincronizar con Firestore después
      setTimeout(() => {
        obtenerLiquidadas();
      }, 2000);
  
      setInstalacionSeleccionada({ ...instalacion, esCorreccion: true });
  
    } catch (error) {
      console.error("Error al corregir la liquidación:", error);
      toast.dismiss();
      toast.error("❌ Ocurrió un error al corregir la liquidación.");
    }
  };
  
  

  

  const manejarLiquidacion = (inst) => {
    if (liquidadasInfo.hasOwnProperty(inst.codigoCliente)) {
      toast('Esta instalación ya fue liquidada.');
      return;
    }
    
  
    // 👉 Aquí debes seleccionar la instalación para abrir el formulario
    setInstalacionSeleccionada(inst);
  };
  
  
  

  return (
    <div className="p-6">
      {/* Si hay una instalación seleccionada, mostramos el formulario */}
      {instalacionSeleccionada ? (
        <div>
          <Button onClick={() => setInstalacionSeleccionada(null)} className="mb-4">← Volver</Button>
          <FormularioLiquidacion 
   instalacion={instalacionSeleccionada}
   onFinalizar={() => {
      setInstalacionSeleccionada(null);
      obtenerLiquidadas();       // 🔄 Volver a cargar liquidadas
   }}
/>

        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-4">Liquidación de Instalaciones</h1>

          {/* Filtros */}
          <div className="flex gap-4 mb-6">
            <Input
              type="date"
              value={filtros.fecha}
              onChange={(e) => setFiltros({ ...filtros, fecha: e.target.value })}
            />
            <Input
              placeholder="Buscar cuadrilla"
              value={filtros.cuadrilla}
              onChange={(e) => setFiltros({ ...filtros, cuadrilla: e.target.value })}
            />
            <Button onClick={obtenerInstalaciones} disabled={cargando}>
              {cargando ? "Cargando..." : "Buscar"}
            </Button>
          </div>

          <div className="flex justify-center gap-6 mb-4">
  <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded shadow">
    <p className="text-sm">Finalizadas</p>
    <p className="text-xl font-bold text-center">{totalFinalizadas}</p>
  </div>
  <div className="bg-green-100 text-green-800 px-4 py-2 rounded shadow">
    <p className="text-sm">Liquidadas</p>
    <p className="text-xl font-bold text-center">{totalLiquidadas}</p>
  </div>
  <div className="bg-red-100 text-red-800 px-4 py-2 rounded shadow">
    <p className="text-sm">Pendientes</p>
    <p className="text-xl font-bold text-center">{totalPendientes}</p>
  </div>
</div>


          {/* Listado de instalaciones */}
          <table className="w-full border">
            <thead>
              <tr className="bg-gray-200">
                <th className="p-2 border">Código</th>
                <th className="p-2 border">Cliente</th>
                <th className="p-2 border">Dirección</th>
                <th className="p-2 border">Plan</th>
                <th className="p-2 border">Cuadrilla</th>
                <th className="p-2 border">Categoría</th>
                <th className="p-2 border">Acción</th>
              </tr>
            </thead>
            < tbody key={actualizacion}>
  {instalaciones.length === 0 ? (
    <tr>
      <td colSpan="7" className="text-center p-4">No hay instalaciones para liquidar</td>
    </tr>
  ) : (
    instalaciones.map(inst => {
      const estaLiquidado = liquidadasInfo.hasOwnProperty(inst.codigoCliente);
const estaCorregido = liquidadasInfo[inst.codigoCliente]?.corregido === true;






      return (
        <tr key={inst.id}>
          <td className="p-2 border">{inst.codigoCliente}</td> 
          <td className="p-2 border">{inst.cliente}</td>
          <td className="p-2 border">{inst.direccion}</td>
          <td className="p-2 border">{inst.plan}</td>
          <td className="p-2 border">{inst.cuadrillaNombre}</td>
          <td className="p-2 border">{inst.residencialCondominio || "N/A"}</td>
          <td className="p-2 border text-center">
  {estaLiquidado ? (
    <>
      <Button 
        disabled 
        className="w-full flex items-center justify-center gap-2 bg-green-100 text-green-700 border border-green-400 cursor-not-allowed font-semibold py-2 rounded-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L9 11.586 6.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l7-7a1 1 0 000-1.414z" clipRule="evenodd" />
        </svg>
        Liquidado
        {estaCorregido === true && (
  <span className="text-xs text-yellow-600 ml-2">(Corregida)</span>
)}





      </Button>

      <Button 
        className="w-full flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold py-2 rounded-lg mt-2 border border-yellow-500 transition"
        onClick={() => manejarCorreccion(inst)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5 9a7 7 0 0112.908-2.917M19 15a7 7 0 01-12.908 2.917" />
        </svg>
        Corregir Liquidación
      </Button>
    </>
  ) : (
    <Button 
      size="sm"
      onClick={() => manejarLiquidacion(inst)}
      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold py-2 rounded-lg shadow-md transition"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M5 9a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" />
      </svg>
      Liquidar
    </Button>
  )}
</td>




        </tr>
      );
    })
  )}
</tbody>

          </table>
        </>
      )}
    </div>
  );
}
