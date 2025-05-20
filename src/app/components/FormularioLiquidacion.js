"use client";

import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useRouter } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { 
  collection, 
  getDocs, 
  updateDoc, 
  doc, 
  query,
  where, 
  deleteDoc, 
  setDoc, 
  serverTimestamp,
  addDoc
} from "firebase/firestore";

import { db, storage } from "@/firebaseConfig";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Button } from "@/app/components/ui/button";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";

export default function FormularioLiquidacion({ instalacion, onFinalizar }) {
  const router = useRouter();
  const { userData } = useAuth();

  const [stockEquipos, setStockEquipos] = useState([]);
  const [procesando, setProcesando] = useState(false);

  const tipoCategoria = instalacion?.residencialCondominio || instalacion?.categoria || "";
  const esResidencial = tipoCategoria.toUpperCase() === "RESIDENCIAL";


  const [formulario, setFormulario] = useState({
    nActa: "",
    snONT: "",
    proidONT: "",
    snMESH: [],
    snBOX: [],
    snFONO: "",
    metraje: "",
    rotuloCTO: "",
    cableUTP: "",
    planGamer: "",
    kitWifiPro: "",
    servicioCableadoMesh: "",
    cat5e: 0,
    cat6: 0,
    puntosUTP: 0,
    observacion: "",
    estadoLiquidacion: "Pendiente",
  });
  const esCorreccion = instalacion.esCorreccion || false;


  const obtenerNombreUsuario = async (uid) => {
    if (!uid || typeof uid !== "string") {
      console.warn("UID inválido:", uid);
      return "No asignado";
    }
  
    const uidLimpio = uid.trim();
    console.log("🔍 Buscando usuario con UID:", uidLimpio);
  
    try {
      const q = query(collection(db, "usuarios"), where("__name__", "==", uidLimpio));
      const snapshot = await getDocs(q);
  
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        const nombreCompleto = `${data.nombres || ""} ${data.apellidos || ""}`.trim();
        console.log("✅ Usuario encontrado:", nombreCompleto);
        return nombreCompleto || "Nombre incompleto";
      } else {
        console.error("❌ No se encontró usuario con UID:", uidLimpio);
        return "Usuario no encontrado";
      }
    } catch (error) {
      console.error("⚠️ Error consultando Firestore:", error);
      return "Error al buscar usuario";
    }
  };
  
  
  
  


 // Obtener stock de equipos
 useEffect(() => {
  if (!instalacion?.cuadrillaId) return;

  const obtenerStock = async () => {
    try {
      const ref = collection(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`);
      const snapshot = await getDocs(ref);

      const equipos = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          tipoFinal: data.tipo || data.equipo || "",  // 🔹 Normalizamos el tipo
        };
      });

      setStockEquipos(equipos);
    } catch (error) {
      toast.error("Error al obtener stock de equipos");
      console.error(error);
    }
  };

  obtenerStock();
}, [instalacion?.cuadrillaId]);


 // Filtrado de equipos
 const ontDisponibles  = stockEquipos.filter(e => e.tipoFinal === "ONT");
const meshDisponibles = stockEquipos.filter(e => e.tipoFinal === "MESH");
const boxDisponibles  = stockEquipos.filter(e => e.tipoFinal === "BOX");
const fonoDisponibles = stockEquipos.filter(e => e.tipoFinal === "FONO");


  // Manejo de cambios generales
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    let nuevoValor = value;
    if (type === "checkbox") {
      if (name === "planGamer") nuevoValor = checked ? "GAMER" : "";
      if (name === "kitWifiPro") nuevoValor = checked ? "KIT WIFI PRO (AL CONTADO)" : "";
      if (name === "servicioCableadoMesh") nuevoValor = checked ? "SERVICIO CABLEADO DE MESH" : "";
    }

    const updatedForm = { ...formulario, [name]: nuevoValor };

    // Cat6 depende del Plan Gamer
    updatedForm.cat6 = updatedForm.planGamer ? 1 : 0;

    // Calcular Puntos UTP
    updatedForm.puntosUTP = parseInt(updatedForm.cat5e || 0) + updatedForm.cat6;

    setFormulario(updatedForm);
  };

  const buscarEquipoPorSN = async (sn) => {
    const q = query(collection(db, "equipos"), where("SN", "==", sn));
    const querySnap = await getDocs(q);
  
    return querySnap;  // Retornamos el snapshot completo
  };

  
  

  const handleClevisChange = (e) => {
    const clevis = parseInt(e.target.value) || 0;
    setFormulario({ 
      ...formulario, 
      clevis, 
      hebillas: clevis * 2 
    });
  };

  const handleSelectONT = async (snSeleccionado) => {
    if (!snSeleccionado) {
      setFormulario({ ...formulario, snONT: "", proidONT: "" });
      return;
    }
  
    // 1️⃣ Buscar en el stock local (ontDisponibles)
    const ontLocal = ontDisponibles.find(o => o.SN === snSeleccionado);
    let proidFinal = ontLocal?.proid || "";
  
    // 2️⃣ Si no tiene PROID, buscar en Firestore
    if (!proidFinal) {
      try {
        const q = query(collection(db, "equipos"), where("SN", "==", snSeleccionado));
        const querySnap = await getDocs(q);
  
        if (!querySnap.empty) {
          const docData = querySnap.docs[0].data();
          proidFinal = docData.proid || "";
  
          if (!proidFinal) {
            toast.error(`⚠️ El SN ${snSeleccionado} no tiene PROID asignado en la base de datos.`);
          }
        } else {
          toast.error(`❌ El SN ${snSeleccionado} no fue encontrado en la colección principal.`);
        }
      } catch (error) {
        console.error("Error al buscar el ONT en Firestore:", error);
        toast.error("Ocurrió un error al consultar la base de datos.");
      }
    }
  
    // 3️⃣ Actualizar el formulario
    setFormulario(prev => ({ 
      ...prev, 
      snONT: snSeleccionado, 
      proidONT: proidFinal,
      estadoLiquidacion: snSeleccionado && proidFinal ? "Liquidado" : "Pendiente"
    }));
    
  };
  

  const handleConfirmar = async () => {
    if (!formulario.snONT) {
      toast.error("⚠️ Debes seleccionar un SN ONT para continuar.");
      return;
    }

    // Validar SN ONT
    if (!ontDisponibles.find(o => o.SN === formulario.snONT)) {
  toast.error("⚠️ El SN ONT no es válido.");
  return;
    }

// Validar SN MESH
for (let sn of formulario.snMESH.filter(Boolean)) {
  if (!meshDisponibles.find(m => m.SN === sn)) {
    toast.error(`⚠️ El SN MESH ${sn} no es válido.`);
    return;
  }
}

// Validar SN BOX
for (let sn of formulario.snBOX.filter(Boolean)) {
  if (!boxDisponibles.find(b => b.SN === sn)) {
    toast.error(`⚠️ El SN BOX ${sn} no es válido.`);
    return;
  }
}

// Validar SN FONO
if (formulario.snFONO && !fonoDisponibles.find(f => f.SN === formulario.snFONO)) {
  toast.error("⚠️ El SN FONO no es válido.");
  return;
}

  
    setProcesando(true);
    const loadingToast = toast.loading("Procesando liquidación...");
  
    try {
      // 1️⃣ Guardar la liquidación en la colección principal
      await setDoc(doc(db, "liquidacion_instalaciones", instalacion.codigoCliente), {
        ...formulario,  // Asegura que formulario tenga campos relevantes
        cliente: instalacion.cliente,
        direccion: instalacion.direccion,
        cuadrillaNombre: instalacion.cuadrillaNombre,
        fechaInstalacion: instalacion.fechaInstalacion,
        fechaLiquidacion: serverTimestamp(),
        usuario: `${userData?.nombres} ${userData?.apellidos}`,
     
        // Campos adicionales
        dia: instalacion.dia || "",  // Asegúrate que exista
        documento: instalacion.documento || "",
        plan: instalacion.plan || "",
        residencialCondominio: instalacion.residencialCondominio || "",
        telefono: instalacion.telefono || "",
        tipoCuadrilla: instalacion.tipoCuadrilla || "",
        tipoServicio: instalacion.tipoServicio || "",
        codigoCliente: instalacion.codigoCliente || "",
        coordenadas: {
           lat: instalacion.coordenadas?.lat || 0,
           lng: instalacion.coordenadas?.lng || 0
        },
        coordinadorCuadrilla: instalacion.coordinadorCuadrilla || "",
        gestor: instalacion.gestor || "",
        gestorCuadrilla: instalacion.gestorCuadrilla || "",
        tramo: instalacion.tramo || "",
        horaEnCamino: instalacion.horaEnCamino || "",
        horaInicio: instalacion.horaInicio || "",
        horaFin: instalacion.horaFin || "",
        horaInicioLlamada: instalacion.horaInicioLlamada || "",
        horaFinLlamada: instalacion.horaFinLlamada || "",
        estadoLlamada: instalacion.estadoLlamada || "",
        observacionLlamada: instalacion.observacionLlamada || ""
     });
     
      
  
      // 2️⃣ Función para actualizar cada equipo en la colección 'equipos'

      const actualizarEquipo = async (sn) => {
        try {
          const snapshot = await buscarEquipoPorSN(sn);
      
          if (snapshot.empty) {
            toast.error(`Equipo con SN ${sn} no encontrado en la colección principal.`);
            return;
          }
      
          const equipoRef = snapshot.docs[0].ref;
      
          await updateDoc(equipoRef, {
            estado: "instalado",
            ubicacion: "instalado",
            cliente: instalacion.cliente,
            f_instalado: instalacion.fechaInstalacion,
            usuario: `${userData?.nombres} ${userData?.apellidos}`
          });
      
        } catch (error) {
          console.error(`Error al actualizar el equipo con SN ${sn}:`, error);
          toast.error(`Error al actualizar el equipo ${sn}`);
        }
      };
      

  
      // 3️⃣ Listado de todos los SN seleccionados (filtrando vacíos)
      const snEquipos = [
        formulario.snONT,
        ...formulario.snMESH,
        ...formulario.snBOX,
        formulario.snFONO
      ].filter(Boolean);
  
      if (snEquipos.length === 0) {
        throw new Error("No hay equipos seleccionados para procesar.");
      }
  
      // 4️⃣ Procesar cada equipo: eliminar del stock y actualizar estado
      for (const sn of snEquipos) {
        await deleteDoc(doc(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`, sn));
        await actualizarEquipo(sn);

      }

      // 3️⃣ Generar Comprobante PDF
    const pdfUrl = await generarComprobantePDF();

    // 4️⃣ Crear Notificación Interna
    await addDoc(collection(db, "notificaciones"), {
      tipo: "Liquidación",
      mensaje: `✅ Cliente: ${instalacion.cliente} | Pedido: ${instalacion.codigoCliente} | Cuadrilla: ${instalacion.cuadrillaNombre} fue liquidado por ${userData?.nombres} ${userData?.apellidos}.`,
      codigoCliente: instalacion.codigoCliente,
      cuadrilla: instalacion.cuadrillaNombre || "Sin cuadrilla",
      usuario: `${userData?.nombres} ${userData?.apellidos}`,
      fecha: serverTimestamp(),
      link: pdfUrl  // Enlace directo al comprobante PDF
    });
    
    
  
      toast.dismiss(loadingToast);
      toast.success("✅ Liquidación completada con éxito.");
      // Esperar un pequeño tiempo para que el usuario vea el mensaje


      console.log("Redirigiendo a la vista principal...");
      // Redirigir directamente
      if (onFinalizar) {
        onFinalizar();
      }







    } catch (error) {
      console.error("❌ Error durante la liquidación:", error);
      toast.dismiss(loadingToast);
      toast.error("Ocurrió un error al procesar la liquidación. Intenta nuevamente.");
    } finally {
      setProcesando(false);
    }



  };
  


  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
  
    let nuevoValor = "";
    if (name === "planGamer") nuevoValor = checked ? "GAMER" : "";
    if (name === "kitWifiPro") nuevoValor = checked ? "KIT WIFI PRO (AL CONTADO)" : "";
    if (name === "servicioCableadoMesh") nuevoValor = checked ? "SERVICIO CABLEADO DE MESH" : "";
  
    setFormulario((prev) => ({
      ...prev,
      [name]: nuevoValor,
      // Ajustes adicionales si es servicioCableadoMesh
      ...(name === "servicioCableadoMesh" && {
        cat5e: checked ? prev.cat5e : 0,
        cat6: checked ? (prev.planGamer ? 1 : 0) : 0,
        puntosUTP: checked ? prev.cat5e + (prev.planGamer ? 1 : 0) : 0
      }),
      ...(name === "planGamer" && {
        cat6: checked ? 1 : 0,
        puntosUTP: prev.cat5e + (checked ? 1 : 0)
      })
    }));
  };
  
  
  
  const handleCat5eChange = (e) => {
    const valor = parseInt(e.target.value) || 0;
    setFormulario((prev) => ({
      ...prev,
      cat5e: valor,
      puntosUTP: valor + (prev.cat6 || 0)
    }));
  };
  
  
  useEffect(() => {
    // Actualizar puntos UTP si cambia Cat6
    setFormulario(prev => ({
      ...prev,
      puntosUTP: prev.cat5e + prev.cat6
    }));
  }, [formulario.cat6]);


  const generarComprobantePDF = async () => {
    const docPDF = new jsPDF();

    // 🔸 Obtener nombre del coordinador
    const nombreCoordinador = await obtenerNombreUsuario(instalacion.coordinadorCuadrilla);
const nombreGestorCuadrilla = await obtenerNombreUsuario(instalacion.gestorCuadrilla);

    
    // 📝 Título Principal
docPDF.setFontSize(14);
docPDF.text("Comprobante de Liquidación", 20, 20);

// 📄 Datos Generales
docPDF.setFontSize(10);
docPDF.text(`Cliente: ${instalacion.cliente}`, 20, 30);
docPDF.text(`Dirección: ${instalacion.direccion}`, 20, 36);
docPDF.text(`Código Pedido: ${instalacion.codigoCliente}`, 20, 42);
docPDF.text(`Fecha Liquidación: ${new Date().toLocaleDateString()}`, 20, 48);

// ➕ Nuevos Datos de la Instalación
const datosExtra = [
  [`Cuadrilla`, instalacion.cuadrillaNombre || 'N/A'],
  [`Día`, instalacion.dia || 'N/A'],
  [`Documento`, instalacion.documento || 'N/A'],
  [`Plan`, instalacion.plan || 'N/A'],
  [`Teléfono`, instalacion.telefono || 'N/A'],
  [`Tipo Cuadrilla`, instalacion.tipoCuadrilla || 'N/A'],
  [`Tipo Servicio`, instalacion.tipoServicio || 'N/A'],
  [`Coordinador`, nombreCoordinador],          // ✅ Aquí va el nombre
  [`Gestor Cuadrilla`, nombreGestorCuadrilla], // ✅ Aquí va el nombre del gestor
  [`Tramo`, instalacion.tramo || 'N/A'],
  [`Hora En Camino`, instalacion.horaEnCamino || 'N/A'],
  [`Hora Inicio`, instalacion.horaInicio || 'N/A'],
  [`Hora Fin`, instalacion.horaFin || 'N/A'],
  [`Inicio Llamada`, instalacion.horaInicioLlamada || 'N/A'],
  [`Fin Llamada`, instalacion.horaFinLlamada || 'N/A'],
  [`Estado Llamada`, instalacion.estadoLlamada || 'N/A'],
  [`Obs. Llamada`, instalacion.observacionLlamada || 'N/A'],
  [`Coordenadas`, `Lat: ${instalacion.coordenadas?.lat || 0} / Lng: ${instalacion.coordenadas?.lng || 0}`]
];

autoTable(docPDF, {
  startY: 55,
  head: [['Dato', 'Valor']],
  body: datosExtra
});

// 📦 Tabla de Equipos
autoTable(docPDF, {
  startY: docPDF.lastAutoTable.finalY + 10,
  head: [['Tipo', 'Serial']],
  body: [
    ['ONT', formulario.snONT],
    ...formulario.snMESH.map(sn => ['MESH', sn]),
    ...formulario.snBOX.map(sn => ['BOX', sn]),
    formulario.snFONO ? ['FONO', formulario.snFONO] : []
  ].filter(row => row.length > 0)
});

// 📋 Tabla de Materiales
const materiales = [
  ['Metraje Consumido', formulario.metraje || '0'],
  ['Rótulo CTO / NAP', formulario.rotuloCTO || 'N/A'],
  ['Plan Gamer', formulario.planGamer || 'No'],
['KIT WIFI PRO', formulario.kitWifiPro || 'No'],
['Servicio Cableado MESH', formulario.servicioCableadoMesh || 'No'],

  ['Cat 5E', formulario.cat5e],
  ['Cat 6', formulario.cat6],
  ['Puntos UTP', formulario.puntosUTP],
];

if (esResidencial) {
  materiales.push(['Templadores', formulario.templadores || 0]);
  materiales.push(['Anclaje P', formulario.anclajeP || 0]);
  materiales.push(['Clevis', formulario.clevis || 0]);
  materiales.push(['Hebillas', formulario.hebillas || 0]);
}

autoTable(docPDF, {
  startY: docPDF.lastAutoTable.finalY + 10,
  head: [['Material', 'Cantidad / Detalle']],
  body: materiales
});

// 📝 Observaciones
docPDF.text(`Observaciones: ${formulario.observacion || 'Ninguna'}`, 20, docPDF.lastAutoTable.finalY + 10);

// ✅ Resumen Visual
const resumenY = docPDF.lastAutoTable.finalY + 25;
docPDF.setFontSize(11);
docPDF.text("Resumen de Liquidación", 20, resumenY);
docPDF.setFontSize(10);
docPDF.text(`Liquidado por: ${userData?.nombres} ${userData?.apellidos}`, 20, resumenY + 6);
docPDF.text(`Fecha: ${new Date().toLocaleString()}`, 20, resumenY + 12);

  
    // 📂 Subir PDF a Firebase Storage
    const blob = docPDF.output("blob");
    const pdfRef = ref(storage, `comprobantes_liquidacion/${instalacion.codigoCliente}.pdf`);
  
    await uploadBytes(pdfRef, blob);
    const url = await getDownloadURL(pdfRef);
  
    return url;  // Retorna la URL del comprobante
  };
  
  
  

  return (
    <div className="p-8 bg-white shadow-lg rounded-lg max-w-5xl mx-auto">


{esCorreccion && (
        <div className="bg-yellow-100 text-yellow-800 p-3 rounded mb-4">
          🔧 <strong>Modo Corrección:</strong> Estás ajustando una liquidación previamente realizada.
        </div>
      )}

      <h2 className="text-2xl font-bold mb-6 text-center text-gray-700">📝 Liquidación de Instalación</h2>

      <div className="grid grid-cols-2 gap-6">
        {/* Datos Generales */}
        <Input value={instalacion?.fechaInstalacion ? new Date(instalacion.fechaInstalacion).toLocaleDateString() : "Sin fecha"} disabled placeholder="📅 Fecha de Instalación" />
        <Input value={instalacion?.cuadrillaNombre || "Sin cuadrilla"} disabled placeholder="👷‍♂️ Cuadrilla" />
        <Input name="nActa" placeholder="N° Acta" onChange={handleChange} />
        <Input value={instalacion?.codigoCliente || "Sin código"} disabled placeholder="Código de Pedido" />
        <Input value={instalacion?.documento || ""} disabled placeholder="DNI/CE" />
        <Input value={instalacion?.cliente || ""} disabled placeholder="Nombre del Cliente" />
        <Input value={instalacion?.direccion || ""} disabled placeholder="Dirección" />
        <Input value={tipoCategoria} disabled placeholder="Condominio / Residencial" />
        <Input value={instalacion?.plan || ""} disabled placeholder="Paquete de Servicio" />

       {/* SN ONT */}
       

       <div className="mb-4">
       <Input
  list="ont-options"
  name="snONT"
  value={formulario.snONT}
  onChange={(e) => setFormulario({ ...formulario, snONT: e.target.value })}
  onBlur={async (e) => {
    const snSeleccionado = e.target.value.trim();
    const ontEnStock = ontDisponibles.find(o => o.SN === snSeleccionado);

    let proidFinal = ontEnStock?.proid || "";

    if (!proidFinal && snSeleccionado) {
      try {
        const q = query(collection(db, "equipos"), where("SN", "==", snSeleccionado));
        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
          const docData = querySnap.docs[0].data();
          proidFinal = docData.proid || "";

          if (!proidFinal) {
            toast.error(`⚠️ El SN ${snSeleccionado} no tiene PROID asignado en la base de datos.`);
          }
        } else {
          toast.error(`❌ El SN ${snSeleccionado} no fue encontrado en la colección principal.`);
        }
      } catch (error) {
        console.error("Error al buscar el ONT en Firestore:", error);
        toast.error("Ocurrió un error al consultar la base de datos.");
      }
    }

    setFormulario(prev => ({
      ...prev,
      proidONT: proidFinal,
      estadoLiquidacion: snSeleccionado && proidFinal ? "Liquidado" : "Pendiente"
    }));
  }}
  placeholder="Seleccione o escriba SN ONT"
  className={`border rounded px-3 py-2 w-full transition
    ${formulario.snONT 
      ? ontDisponibles.find(o => o.SN === formulario.snONT) || formulario.proidONT
        ? 'bg-green-100 border-green-500'
        : 'bg-red-100 border-red-500'
      : 'bg-gray-100 border-gray-300'
    }`}
/>

<datalist id="ont-options">
  {ontDisponibles.map(o => (
    <option key={o.id} value={o.SN} />
  ))}
</datalist>



  {/* Mensaje de validación */}
  {formulario.snONT && !ontDisponibles.find(o => o.SN === formulario.snONT) && (
    <p className="text-sm text-red-500 mt-1">⚠️ SN ONT no válido o fuera de stock.</p>
  )}
</div>



<Input 
  value={formulario.proidONT} 
  readOnly 
  placeholder="🔢 PROID ONT"
  className="bg-gray-100 border border-gray-300 text-gray-700 cursor-default"
 />


        {/* SN MESH */}
        {Array.from({ length: Math.min(meshDisponibles.length, 4) }).map((_, idx) => {
  const valorActual = formulario.snMESH[idx] || "";

  return (
    <div key={idx} className="mb-4">
      <Input
        list="mesh-options"
        value={valorActual}
        onChange={(e) => {
          const nuevosMesh = [...formulario.snMESH];
          nuevosMesh[idx] = e.target.value;
          setFormulario({ ...formulario, snMESH: nuevosMesh });
        }}
        placeholder={`SN MESH ${idx + 1}`}
        className={`border rounded px-3 py-2 w-full
          ${valorActual 
            ? meshDisponibles.find(m => m.SN === valorActual) 
              ? 'bg-green-100 border-green-500' 
              : 'bg-red-100 border-red-500'
            : 'bg-gray-100 border-gray-300'
          }`}
      />
      <datalist id="mesh-options">
        {meshDisponibles.map(m => (
          <option key={m.id} value={m.SN} />
        ))}
      </datalist>

      {valorActual && !meshDisponibles.find(m => m.SN === valorActual) && (
        <p className="text-sm text-red-500 mt-1">⚠️ SN MESH no válido.</p>
      )}
    </div>
  );
})}





        {/* SN BOX */}
        {Array.from({ length: Math.min(boxDisponibles.length, 4) }).map((_, idx) => {
  const valorActual = formulario.snBOX[idx] || "";

  return (
    <div key={`box-${idx}`} className="mb-4">
      <Input
        list={`box-options-${idx}`}
        value={valorActual}
        onChange={(e) => {
          const nuevosBox = [...formulario.snBOX];
          nuevosBox[idx] = e.target.value;
          setFormulario({ ...formulario, snBOX: nuevosBox });
        }}
        placeholder={`SN BOX ${idx + 1}`}
        className={`border rounded px-3 py-2 w-full
          ${valorActual 
            ? boxDisponibles.find(b => b.SN === valorActual) 
              ? 'bg-green-100 border-green-500' 
              : 'bg-red-100 border-red-500'
            : 'bg-gray-100 border-gray-300'
          }`}
      />
      <datalist id={`box-options-${idx}`}>
        {boxDisponibles.map(b => (
          <option key={b.id} value={b.SN} />
        ))}
      </datalist>

      {valorActual && !boxDisponibles.find(b => b.SN === valorActual) && (
        <p className="text-sm text-red-500 mt-1">⚠️ SN BOX {idx + 1} no válido.</p>
      )}
    </div>
  );
})}




        {/* SN FONO */}
        {fonoDisponibles.length > 0 && (
  <div className="mb-4">
    <Input
      list="fono-options"
      name="snFONO"
      value={formulario.snFONO}
      onChange={(e) => setFormulario({ ...formulario, snFONO: e.target.value })}
      placeholder="Seleccione o escriba SN FONO"
      className={`border rounded px-3 py-2 w-full
        ${formulario.snFONO 
          ? fonoDisponibles.find(f => f.SN === formulario.snFONO) 
            ? 'bg-green-100 border-green-500' 
            : 'bg-red-100 border-red-500'
          : 'bg-gray-100 border-gray-300'
        }`}
    />
    <datalist id="fono-options">
      {fonoDisponibles.map(f => (
        <option key={f.id} value={f.SN} />
      ))}
    </datalist>

    {formulario.snFONO && !fonoDisponibles.find(f => f.SN === formulario.snFONO) && (
      <p className="text-sm text-red-500 mt-1">⚠️ SN FONO no válido.</p>
    )}
  </div>
)}



<div className="grid grid-cols-2 gap-4 mt-6">
  {/* Checkboxes con mejor estilo */}
  <label className="flex items-center space-x-2">
  <input
    type="checkbox"
    name="planGamer"
    checked={formulario.planGamer !== ""}   
    onChange={handleCheckboxChange}
    className="w-5 h-5 accent-blue-600"
  />
  <span className="text-sm font-medium">🎮 Plan Gamer</span>
</label>

<label className="flex items-center space-x-2">
  <input
    type="checkbox"
    name="kitWifiPro"
    checked={formulario.kitWifiPro !== ""}  
    onChange={handleCheckboxChange}
    className="w-5 h-5 accent-green-600"
  />
  <span className="text-sm font-medium">📦 KIT WIFI PRO (AL CONTADO)</span>
</label>

<label className="flex items-center space-x-2 col-span-2">
  <input
    type="checkbox"
    name="servicioCableadoMesh"
    checked={formulario.servicioCableadoMesh !== ""}  
    onChange={handleCheckboxChange}
    className="w-5 h-5 accent-purple-600"
  />
  <span className="text-sm font-medium">🔧 SERVICIO CABLEADO DE MESH</span>
</label>


  <div className="grid grid-cols-2 gap-4 items-center">

  <Input
      type="number"
      name="cat5e"
      placeholder="✏️ Cat 5E"
      value={formulario.cat5e}
      onChange={handleCat5eChange}
      disabled={!formulario.servicioCableadoMesh}
      className={`border-2 ${
        formulario.servicioCableadoMesh 
          ? 'border-blue-500 focus:ring-2 focus:ring-blue-300' 
          : 'bg-gray-100 text-gray-500 cursor-not-allowed'
      }`}
    />
    {/* Tooltip solo si está habilitado */}
    {formulario.servicioCableadoMesh && (
      <div className="absolute left-0 -top-10 w-40 bg-black text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
        Ingresa solo números enteros para Cat 5E.
      </div>
    )}
  </div>

  {/* 🚫 Cat 6 - Automático */}
  <Input
    type="number"
    name="cat6"
    placeholder="Cat 6 (auto)"
    value={formulario.cat6}
    disabled
    className="bg-gray-100 text-gray-500 cursor-not-allowed"
  />

  {/* 🚫 Puntos UTP - Suma automática */}
  <Input
    type="number"
    name="puntosUTP"
    placeholder="Puntos UTP"
    value={formulario.puntosUTP}
    disabled
    className="bg-gray-100 text-gray-500 cursor-not-allowed col-span-2"
  />


</div>



        {/* Extras */}
        <Input name="metraje" placeholder="📏 Metraje Consumido" onChange={handleChange} />
        <Input name="rotuloCTO" placeholder="Rótulo CTO o CAJA NAP" onChange={handleChange} />
        <Input type="hidden" name="cableUTP" placeholder="Cableado UTP (metros)" onChange={handleChange} />

        {esResidencial && (
          <>
            <Input name="templadores" placeholder="Templadores" type="number" onChange={handleChange} />
            <Input name="anclajeP" placeholder="Anclaje P" type="number" onChange={handleChange} />
            <Input name="clevis" placeholder="Clevis" type="number" onChange={handleClevisChange} />
            <Input value={formulario.hebillas} disabled placeholder="Hebillas (Clevis x2)" />
          </>
        )}
      </div>

      <Textarea
  name="observacion"
  placeholder="📝 Observaciones"
  className="mt-6 w-full p-3 border rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-300 transition min-h-[120px]"
  onChange={handleChange}
/>

      <p className="mt-4 font-semibold text-gray-600">Estado de Liquidación: 
        <span className={`ml-2 ${formulario.estadoLiquidacion === "Liquidado" ? "text-green-600" : "text-red-500"}`}>
          {formulario.estadoLiquidacion}
        </span>
      </p>

      <Button
  onClick={handleConfirmar}
  disabled={procesando}
  className={`mt-6 w-full text-white font-semibold py-2 rounded transition 
              ${procesando ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
>
  {procesando ? (
    <span className="flex items-center justify-center gap-2">
      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"></path>
      </svg>
      Procesando...
    </span>
  ) : (
    "✅ Confirmar Liquidación"
  )}
</Button>

    </div>
  );
}
