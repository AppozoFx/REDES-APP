"use client";

import { useState, useEffect, useRef } from 'react';
import { db, auth, storage } from '@/firebaseConfig'; // ✅ CORRECTO
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  addDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import toast from 'react-hot-toast';  // 👈 Aquí está la solución


export default function RecepcionActasPage() {
  const [cuadrilla, setCuadrilla] = useState("");
  const [listaCuadrillas, setListaCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [actaCode, setActaCode] = useState("");
  const [actas, setActas] = useState([]);
  const [guiaId, setGuiaId] = useState("");
  const [procesando, setProcesando] = useState(false);


  useEffect(() => {
    async function fetchData() {
      const cuadrillaSnap = await getDocs(collection(db, "cuadrillas"));
      const usuarioSnap = await getDocs(collection(db, "usuarios"));
      setListaCuadrillas(
        cuadrillaSnap.docs.map(doc => ({
          nombre: doc.data().nombre || doc.id,
          tecnicos: doc.data().tecnicos || []
        }))
      );
      setUsuarios(usuarioSnap.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })));
    }
    fetchData();
  }, []);

  useEffect(() => {
    const found = listaCuadrillas.find(c => c.nombre.toLowerCase() === cuadrilla.toLowerCase());
    setTecnicos(found ? found.tecnicos : []);
  }, [cuadrilla, listaCuadrillas]);

  const getNombreUsuario = (uid) => {
    const user = usuarios.find(u => u.uid === uid);
    return user ? `${user.nombres || ''} ${user.apellidos || ''}`.trim() : uid;
  };

  const handleActaKeyDown = (e) => {
    if (e.key === 'Enter' && actaCode.trim()) agregarActa(actaCode.trim());
  };


  const obtenerCelularesTecnicos = async (tecnicosUID) => {
    const celulares = [];
  
    for (const uid of tecnicosUID) {
      const ref = doc(db, "usuarios", uid);
      const snap = await getDoc(ref);
  
      if (snap.exists()) {
        const data = snap.data();
        if (data.celular) celulares.push(data.celular);
      }
    }
  
    return celulares;
  };
  

  const enviarPorWhatsAppManual = (numero, { tipoGuia, guiaId, cuadrilla, tecnicos, usuario, urlComprobante, extraInfo = "" }) => {
    const mensaje = 
  `📄 *${tipoGuia}*
  *Guía:* ${guiaId}
  *Cuadrilla:* ${cuadrilla}
  *Técnicos:* ${tecnicos.join(", ")}
  *Registrado por:* ${usuario}
  ${extraInfo ? `\n${extraInfo}` : ""}
  
  Puedes ver el comprobante aquí:
  ${urlComprobante}`;
  
    const enlace = `https://wa.me/51${numero}?text=${encodeURIComponent(mensaje)}`;
    window.open(enlace, "_blank");
  };
  
  

  

 
  

  const agregarActa = (codigo) => {
    if (!actas.includes(codigo)) {
      setActas(prev => [...prev, codigo]);
    } else {
      toast.error(`⚠️ El acta ${codigo} ya fue escaneada`);
    }
  
    // Siempre limpiar el input después de escanear, sea nuevo o duplicado
    setActaCode("");
  
    // Volver a enfocar el input para el siguiente escaneo
    setTimeout(() => document.getElementById("input-acta")?.focus(), 100);
  };



  const generarGuiaId = async () => {
    const year = new Date().getFullYear();
    let nuevoId = "";
    await runTransaction(db, async (transaction) => {
      const counterRef = doc(db, "counters", `guia_actas_${year}`);
      const counterSnap = await transaction.get(counterRef);
      const lastNo = counterSnap.exists() ? counterSnap.data().lastNo || 0 : 0;
      const nextNo = lastNo + 1;
      nuevoId = `ACTA-${year}-${String(nextNo).padStart(5, "0")}`;
      transaction.set(counterRef, { lastNo: nextNo }, { merge: true });
    });
    return nuevoId;
  };



  const eliminarActa = (codigo) => {
    setActas(prev => prev.filter(acta => acta !== codigo));
    toast(`🗑️ Acta ${codigo} eliminada`, { duration: 1500 });
  };

  const MAX_ALTURA = 300;  // Altura máxima en mm para el PDF térmico



  const handleRegistrar = async () => {
    if (!cuadrilla || actas.length === 0) {
      toast.error("⚠️ Complete los datos antes de registrar.");
      return;
    }
  
    setProcesando(true);
    const toastId = toast.loading("⏳ Generando guía de actas...");
  
    try {
      const user = auth.currentUser;
      const userFull = getNombreUsuario(user?.uid);
      const newGuiaId = await generarGuiaId();
      setGuiaId(newGuiaId);
      const fecha = serverTimestamp();
  
      const docRef = doc(db, "guia_actas", newGuiaId);
      await runTransaction(db, async (transaction) => {
        transaction.set(docRef, {
          guiaId: newGuiaId,
          cuadrilla,
          tecnicos,
          usuario: userFull,
          actas,
          fecha,
          createdAt: fecha,
          impreso: false
        });
      });


  
      const urlComprobante = await generarPDFRecepcionActas(newGuiaId, {
        usuario: userFull,
        cuadrilla,
        tecnicos: tecnicos.map(getNombreUsuario),
        tecnicosUID: tecnicos,
        actas
      });
      
  
      await updateDoc(docRef, { impreso: true });
  
      toast.success("✅ Guía generada correctamente", { id: toastId });



      // 🚨 Crear Notificación de Recepción de Actas
      await addDoc(collection(db, "notificaciones"), {
        tipo: "Recepción de Actas",
        mensaje: `📄 ${userFull} registró la guía ${newGuiaId} para la cuadrilla "${cuadrilla}" con ${actas.length} actas.`,
        usuario: userFull,
        fecha: serverTimestamp(),
        guiaId: newGuiaId,
        link: urlComprobante,   // ✅ Aquí agregamos el link directo al PDF
        detalles: {
          cuadrilla,
          tecnicos: tecnicos.map(uid => getNombreUsuario(uid)),
          cantidadActas: actas.length,
          actas
        },
        visto: false
      });
      

toast.success("🔔 Notificación registrada");

  
      // Limpiar todos los estados
      setCuadrilla("");
      setActas([]);
      setTecnicos([]);
      setActaCode("");
      setGuiaId("");
  
    } catch (error) {
      console.error(error);
      toast.error("❌ Error al generar la guía", { id: toastId });
    } finally {
      setProcesando(false);
    }
  };
  
 
  
  const generarPDFRecepcionActas = async (guiaId, datos) => {
    // 1️⃣ Calcular altura dinámica
    const calcularAlturaPDF = () => {
      const cabecera = 60;
      const tecnicos = datos.tecnicos.length * 5;
      const actas = datos.actas.length * 5;
      const barraYFirmas = 55;
      return Math.max(cabecera + tecnicos + actas + barraYFirmas, 200);
    };
  
    const alturaFinal = calcularAlturaPDF();
    const docPDF = new jsPDF({ unit: "mm", format: [80, alturaFinal] });
  
    // 2️⃣ Renderizar contenido
    let y = 10;
    docPDF.setFontSize(9).setFont("helvetica", "normal");
    const center = { align: "center" };
  
    docPDF.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, center); y += 5;
    docPDF.text("RUC: 20601345979", 40, y, center); y += 5;
    docPDF.text("Cal. Juan Prado de Zela Mza. F2 Lote. 3", 40, y, center); y += 5;
    docPDF.text("Apv. San Francisco de Cayran", 40, y, center); y += 5;
    docPDF.text("Celular/WSP: 913 637 815", 40, y, center); y += 7;
  
    docPDF.setFont("helvetica", "bold");
    docPDF.text(`GUÍA: ${guiaId}`, 40, y, center); y += 5;
    docPDF.setFont("helvetica", "normal");
    docPDF.text(`FECHA: ${new Date().toLocaleString()}`, 40, y, center); y += 5;
    docPDF.text(`USUARIO: ${datos.usuario}`, 40, y, center); y += 5;
    docPDF.text(`Cuadrilla: ${datos.cuadrilla}`, 40, y, center); y += 5;
  
    datos.tecnicos.forEach((tec, i) => {
      docPDF.text(`Técnico ${i + 1}: ${tec}`, 40, y, center); y += 5;
    });
  
    y += 3;
    docPDF.setFont("helvetica", "bold");
    docPDF.text(`${datos.actas.length} ACTAS RECEPCIONADAS`, 40, y, center); y += 6;
    docPDF.setFont("helvetica", "normal");
  
    datos.actas.forEach((acta) => {
      docPDF.text(`${acta} - ACTA`, 40, y, center); y += 5;
    });
  
    // Código de barras
    y += 4;
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, guiaId, { format: "CODE128", displayValue: false, width: 2, height: 15 });
    const imgData = canvas.toDataURL("image/png");
    docPDF.addImage(imgData, "PNG", 5, y, 70, 25);
    y += 39;
  
    // Firmas
    docPDF.line(10, y, 40, y);
    docPDF.line(45, y, 75, y);
    y += 10;
    docPDF.text("Cuadrilla", 25, y, center);
    docPDF.text("Almacén", 60, y, center);

    //docPDF.save(`${guiaId}.pdf`);


    // 📤 Subir PDF a Firebase Storage
const pdfBlob = docPDF.output("blob");
const storagePath = `guias_actas/${guiaId}.pdf`;
const refStorage = storageRef(storage, storagePath);
await uploadBytes(refStorage, pdfBlob);


const urlComprobante = await getDownloadURL(refStorage);
toast.success("📄 PDF subido a Firebase");

// 📲 Enviar WhatsApp a los técnicos
const celulares = await obtenerCelularesTecnicos(datos.tecnicosUID || []);
celulares.forEach(numero => {
  enviarPorWhatsAppManual(numero, {
    tipoGuia: "Recepción de Actas",
    guiaId,
    cuadrilla: datos.cuadrilla,
    tecnicos: datos.tecnicos,
    usuario: datos.usuario,
    urlComprobante,
    extraInfo: `📑 *Cantidad de Actas:* ${datos.actas.length}`
  });
});

  
  
    // 3️⃣ Mostrar en iframe y lanzar impresión
    const url = URL.createObjectURL(pdfBlob);
  
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);
  
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Segunda copia con retraso
      setTimeout(() => {
        iframe.contentWindow.print();
      }, 1500);
    };
  

    // ✅ Retornar el link
return urlComprobante;


    iframe.onafterprint = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };
  };
  

  

  

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white shadow-lg rounded-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-[#30518c] mb-6">📄 Recepción de Actas</h1>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Seleccionar Cuadrilla</label>
          <input
            list="cuadrillas"
            value={cuadrilla}
            onChange={e => setCuadrilla(e.target.value)}
            placeholder="Nombre de la cuadrilla"
            className="border border-gray-300 rounded-lg w-full px-4 py-2 focus:ring-2 focus:ring-[#30518c]"
          />
          <datalist id="cuadrillas">
            {listaCuadrillas.map(c => <option key={c.nombre} value={c.nombre} />)}
          </datalist>
        </div>

        {tecnicos.length > 0 && (
          <div className="mb-4 text-sm text-gray-600">
            <strong>Técnicos:</strong> {tecnicos.map(getNombreUsuario).join(", ")}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Escanear Código de Acta</label>
          <input
  id="input-acta"
  value={actaCode}
  onChange={e => setActaCode(e.target.value)}
  onKeyDown={handleActaKeyDown}
  placeholder="Escanear y presionar Enter"
  className="border border-gray-300 rounded-lg w-full px-4 py-2 focus:ring-2 focus:ring-[#30518c]"
/>

        </div>

      


        {/* Lista de Actas con opción de eliminar individualmente */}
<div className="flex flex-wrap gap-2 mb-4">
  {actas.map((a, i) => (
    <span key={i} className="flex items-center bg-[#30518c] text-white text-xs px-3 py-1 rounded-full">
      {a}
      <button
        onClick={() => eliminarActa(a)}
        className="ml-2 text-red-300 hover:text-red-500"
        title="Eliminar acta"
      >
        ✖
      </button>
    </span>
  ))}
</div>

{/* Botón para limpiar todas las actas */}
{actas.length > 0 && (
  <button
    onClick={() => {
      setActas([]);
      toast("🧹 Todas las actas fueron limpiadas", { duration: 2000 });
    }}
    className="mb-4 bg-red-500 hover:bg-red-700 text-white text-sm px-4 py-2 rounded transition"
  >
    Limpiar Todas las Actas
  </button>
)}



        <button
  onClick={handleRegistrar}
  disabled={procesando}
  className={`w-full ${procesando ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#30518c] hover:bg-[#203a66]'} text-white py-2 rounded-lg font-semibold transition`}
>
  {procesando ? "Procesando..." : "Registrar y Generar Guía"}
</button>

      </div>
    </div>
  );
}
