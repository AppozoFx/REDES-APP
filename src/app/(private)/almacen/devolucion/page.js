"use client";

import { useState, useEffect, useRef } from "react";
import { db, storage } from "@/firebaseConfig";

// ✅ Importa solo desde firestore lo que corresponde
import {
  collection,
  getDocs,
  doc, // este es el correcto
  getDoc,
  writeBatch,
  increment,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  deleteDoc // <-- ✅ AGREGA ESTA LÍNEA
} from "firebase/firestore";

// ✅ Desde storage solo 'ref' y 'uploadString' (sin 'doc')
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";


import { useAuth } from "@/app/context/AuthContext";
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

import toast from "react-hot-toast";




export default function Devolucion() {
  const { userData } = useAuth();
  const [cuadrilla, setCuadrilla] = useState("");
  const [listaCuadrillas, setListaCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [sn, setSn] = useState("");
  const [listaEquipos, setListaEquipos] = useState([]);
  const [errorSn, setErrorSn] = useState("");
  const [ultimaGuia, setUltimaGuia] = useState("");
  const [materialesDevueltos, setMaterialesDevueltos] = useState({});
  const inputRef = useRef(null);

  const [stockMaterialesCuadrilla, setStockMaterialesCuadrilla] = useState([]);
const [stockEquiposCuadrilla, setStockEquiposCuadrilla] = useState([]);
const [procesando, setProcesando] = useState(false);


  const [datosDevolucion, setDatosDevolucion] = useState({
    cuadrillaId: "",
    cuadrillaNombre: "",
    tipo: "",
    tecnicos: [],
    equipos: [],
    drump: "",
    metraje: 0,
    observacion: "",
    usuario: userData?.nombres + " " + userData?.apellidos || "",
    fecha: new Date()
  });

  const materialesDisponibles = [
    "actas", "conectores", "cintillos_30", "cintillos_bandera",
    "rosetas", "acopladores", "pachcord", "cinta_aislante",
    "caja_grapas", "clevis", "hebillas", "templadores", "anclajes_tipo_p"
  ];


  // 📞 Función para obtener los celulares de los técnicos
const obtenerCelularesTecnicos = async (tecnicosUID) => {
  const celulares = [];

  for (const uid of tecnicosUID) {
    const ref = doc(db, "usuarios", uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      if (data.celular) {
        celulares.push(data.celular);
      }
    }
  }

  return celulares;
};

// 💬 Función para abrir WhatsApp Web con el mensaje
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



  
  const generarNumeroGuia = async () => {
    const anio = new Date().getFullYear();
    const ref = doc(db, "counters", "guias_devolucion");
    const snap = await getDoc(ref);
  
    if (!snap.exists()) {
      await setDoc(ref, { anio, ultimoNumero: 1 });
      return `DEV-${anio}-00001`;
    }
  
    const { ultimoNumero } = snap.data();
    const nuevoNumero = ultimoNumero + 1;
    await updateDoc(ref, { ultimoNumero: increment(1) });
  
    const numeroFormateado = nuevoNumero.toString().padStart(5, "0");
    return `DEV-${anio}-${numeroFormateado}`;
  };




  const eliminarBobinaDeStockCuadrilla = async (codigoDrump, cuadrillaId) => {
    if (!codigoDrump || !cuadrillaId) return false;
  
    const drumpRef = doc(db, `cuadrillas/${cuadrillaId}/stock_bobinas`, codigoDrump);
    const snap = await getDoc(drumpRef);
  
    if (!snap.exists()) {
      toast.error(`⚠️ El DRUMP ${codigoDrump} no existe en el stock de la cuadrilla.`);
      return false;
    }
  
    await deleteDoc(drumpRef);
    toast.success(`🗑️ DRUMP ${codigoDrump} eliminado del stock de cuadrilla`);
    return true;
  };
  
  




  const generarPDFDevolucion = async (guiaId, datos) => {
    // 1️⃣ Calcular altura dinámica con mínimo de 200mm
    const calcularAltura = () => {
      let y = 60;  // Cabecera
      y += datos.tecnicos.length * 5;
      y += datos.equipos.length * 5;
      if (datos.drump) y += 8;
      if (datos.metraje > 0) y += 5;
      y += Object.entries(datos.materiales || {}).length * 5;
      y += 20;  // Observaciones
  
      y += 55;  // Espacio para código de barras + firmas
  
      return Math.max(y, 200);  // Altura mínima
    };
  
    const alturaTotal = calcularAltura();
    const doc = new jsPDF({ unit: "mm", format: [80, alturaTotal] });
  
    // 2️⃣ Renderizar contenido
    const renderContenido = (yInicial = 10) => {
      let y = yInicial;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      const centrado = { align: "center" };
  
      doc.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, centrado); y += 5;
      doc.text("RUC: 20601345979", 40, y, centrado); y += 5;
      doc.text("Cal. Juan Prado de Zela Mza. F2 Lote. 3", 40, y, centrado); y += 5;
      doc.text("Apv. San Francisco de Cayran", 40, y, centrado); y += 5;
      doc.text("Celular/WSP: 913 637 815", 40, y, centrado); y += 7;
  
      doc.setFont("helvetica", "bold");
      doc.text(`GUÍA: ${guiaId}`, 40, y, centrado); y += 5;
      doc.setFont("helvetica", "normal");
      doc.text(`FECHA: ${new Date().toLocaleString()}`, 40, y, centrado); y += 5;
      doc.text(`USUARIO: ${datos.usuario}`, 40, y, centrado); y += 5;
      doc.text(`Cuadrilla: ${datos.cuadrillaNombre}`, 40, y, centrado); y += 5;
  
      datos.tecnicos.forEach((tec, i) => {
        doc.text(`Técnico ${i + 1}: ${tec}`, 40, y, centrado); y += 5;
      });
  
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.text("EQUIPOS DEVUELTOS", 40, y, centrado); y += 6;
      doc.setFont("helvetica", "normal");
  
      datos.equipos.forEach(eq => {
        doc.text(`${eq.SN} - ${eq.equipo}`, 40, y, centrado); y += 5;
      });
  
      if (datos.drump) {
        y += 4;
        doc.text(`DRUMP: ${datos.drump}`, 40, y, centrado); y += 5;
      }
  
      if (datos.metraje > 0) {
        doc.text(`Metros devueltos: ${datos.metraje} m`, 40, y, centrado); y += 5;
      }
  
      const materiales = Object.entries(datos.materiales || {});
      if (materiales.length > 0) {
        y += 4;
        doc.setFont("helvetica", "bold");
        doc.text("MATERIALES DEVUELTOS", 40, y, centrado); y += 6;
        doc.setFont("helvetica", "normal");
        materiales.forEach(([nombre, cant]) => {
          doc.text(`${nombre.replaceAll("_", " ")}: ${cant}`, 40, y, centrado); y += 5;
        });
      }
  
      y += 4;
      doc.text(`Observaciones: ${datos.observacion || "Sin observaciones"}`, 10, y, { maxWidth: 60 }); y += 1;
  
      // 📌 Código de barras
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, guiaId, {
        format: "CODE128",
        displayValue: false,
        width: 2,
        height: 15,
      });
  
      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", 5, y, 70, 25); 
      y += 39;
  
      // 📌 Firmas
      doc.line(10, y, 40, y);
      doc.line(45, y, 75, y);
      y += 10;
  
      doc.text("Técnico", 25, y, { align: "center" });
      doc.text("Almacén", 60, y, { align: "center" });
      y += 6;
    };
  
    renderContenido();
  
    // 3️⃣ Guardar PDF
    //doc.save(`${guiaId}.pdf`);

    // 3️⃣ Subir a Firebase Storage
  const pdfBlob = doc.output("blob");
  const storagePath = `guias_devolucion/${guiaId}.pdf`;
  const refStorage = storageRef(storage, storagePath);
  await uploadBytes(refStorage, pdfBlob);

  
  const urlComprobante = await getDownloadURL(refStorage);
  toast.success("📄 PDF subido a Firebase");

  // 4️⃣ Obtener celulares y enviar WhatsApp
  const tecnicosUID = datos.tecnicosUID || [];  // Asegúrate de pasar estos UID en tus datos
  const celulares = await obtenerCelularesTecnicos(tecnicosUID);

  celulares.forEach(numero => {
    enviarPorWhatsAppManual(numero, {
      tipoGuia: "Devolución",
      guiaId,
      cuadrilla: datos.cuadrillaNombre,
      tecnicos: datos.tecnicos,
      usuario: datos.usuario,
      urlComprobante,
      extraInfo: `🛠️ *Equipos:* ${datos.equipos.length}\n📦 *Materiales:* ${Object.values(datos.materiales).reduce((a,b) => a+b,0)}\n🌀 *Metros devueltos:* ${datos.metraje || 0}`
    });
  });
  
  
  
 
     // 5️⃣ Imprimir doble
  const url = URL.createObjectURL(pdfBlob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => {
      iframe.contentWindow.print();
    }, 1000);
  };

  return urlComprobante;   // ✅ Retornas el link del PDF aquí

  iframe.onafterprint = () => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  };
};
  
  






  useEffect(() => {
    const fetchData = async () => {
      const cuadrillaSnap = await getDocs(collection(db, "cuadrillas"));
      const usuarioSnap = await getDocs(collection(db, "usuarios"));

      setListaCuadrillas(cuadrillaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setUsuarios(usuarioSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() })));
    };
    fetchData();
  }, []);



  const [bobinasActivas, setBobinasActivas] = useState([]);

useEffect(() => {
  const fetchBobinasActivas = async () => {
    if (!datosDevolucion.cuadrillaId || datosDevolucion.tipo !== "Residencial") return;

    const snap = await getDocs(
      collection(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_bobinas`)
    );

    const activas = snap.docs
      .map(doc => doc.data())
      .filter(b => b.estado !== "devuelto");

    setBobinasActivas(activas);
  };

  fetchBobinasActivas();
}, [datosDevolucion.cuadrillaId, datosDevolucion.tipo]);

const obtenerStockCuadrilla = async (cuadrillaId) => {
  if (!cuadrillaId) return;

  // Obtener stock de materiales
  const materialesSnap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_materiales`));
  setStockMaterialesCuadrilla(materialesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

  // Obtener stock de equipos
  const equiposSnap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_equipos`));
  setStockEquiposCuadrilla(equiposSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
};



useEffect(() => {
  const seleccionada = listaCuadrillas.find(
    c => c.nombre?.toLowerCase() === cuadrilla?.toLowerCase()
  );
  if (seleccionada) {
    setTecnicos(seleccionada.tecnicos || []);
    setDatosDevolucion(prev => ({
      ...prev,
      cuadrillaId: seleccionada.id,
      cuadrillaNombre: seleccionada.nombre,
      tipo: seleccionada.r_c,
      tecnicos: (seleccionada.tecnicos || []).map(getNombreCompleto),
    }));

    // 🚨 Obtener stock
    obtenerStockCuadrilla(seleccionada.id);
  }
}, [cuadrilla, listaCuadrillas]);


  const getNombreCompleto = (uid) => {
    const usuario = usuarios.find(u => u.uid === uid);
    return usuario ? `${usuario.nombres || ""} ${usuario.apellidos || ""}`.trim() : uid;
  };


  const procesarDevolucionBobinaResidencial = async (batch) => {
    const drumpRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_bobinas`, datosDevolucion.drump);
    const drumpSnap = await getDoc(drumpRef);
  
    if (!drumpSnap.exists()) {
      toast.error(`❌ El DRUMP ${datosDevolucion.drump} no existe en la cuadrilla.`);
      throw new Error("DRUMP no encontrado");
    }
  
    const datosBobina = drumpSnap.data();
  
    // Validar que no se devuelva más de lo que tiene la bobina
    if (datosDevolucion.metraje > datosBobina.metros) {
      toast.error(`❌ No puedes devolver más de ${datosBobina.metros} metros.`);
      throw new Error("Metros inválidos");
    }
  
    const metrosRestantes = datosBobina.metros - datosDevolucion.metraje;
  
    if (metrosRestantes <= 0) {
      // Si queda en 0, eliminar la bobina del stock
      batch.delete(drumpRef);
      toast.success(`🗑️ Bobina ${datosDevolucion.drump} eliminada del stock (0 metros).`);
    } else {
      // Si aún quedan metros, actualizar la cantidad
      batch.update(drumpRef, {
        metros: metrosRestantes,
        actualizadoPor: datosDevolucion.usuario,
        actualizadoEn: new Date()
      });
      toast.success(`✅ Bobina actualizada: ${metrosRestantes} metros restantes.`);
    }
  
    // Sumar metros devueltos al almacén general
    const bobinaAlmacenRef = doc(db, "materiales_stock", "bobina");
    batch.update(bobinaAlmacenRef, {
      cantidad: increment(datosDevolucion.metraje),
      actualizadoPor: datosDevolucion.usuario,
      actualizadoEn: new Date()
    });
  };
  


  const handleRegistrarDevolucion = async () => {

    if (procesando) return;  // Evita doble clic

    const toastId = toast.loading("Registrando devolución...");
    setProcesando(true);

    try {
      const batch = writeBatch(db);
      const guiaId = await generarNumeroGuia();
      setUltimaGuia(guiaId);
  
      // 1️⃣ Validación básica: Al menos debe devolverse equipo, materiales o bobina
      if (
        datosDevolucion.equipos.length === 0 &&
        Object.values(materialesDevueltos).every(v => !v || v <= 0) &&
        datosDevolucion.metraje <= 0
      ) {
        toast.error("⚠️ Debes devolver al menos un equipo, material o bobina.");
        return;
      }
  
      // 2️⃣ Actualización de equipos
      for (const eq of datosDevolucion.equipos) {
        const snap = await getDocs(collection(db, "equipos"));
        const docEncontrado = snap.docs.find(d => d.data().SN === eq.SN);
  
        if (docEncontrado) {
          const equipoRef = doc(db, "equipos", docEncontrado.id);
          batch.update(equipoRef, {
            estado: "almacen",
            ubicacion: "almacen",
            f_despacho: null,
            usuario_despacho: null,
            tecnicos: []
          });
  
          const stockEquipoRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_equipos`, eq.SN);
          batch.delete(stockEquipoRef);
        }
      }
  
      // 3️⃣ Actualización de materiales
      for (const [nombre, cantidad] of Object.entries(materialesDevueltos)) {
        if (!cantidad || cantidad <= 0) continue;
  
        const almacenRef = doc(db, "materiales_stock", nombre);
        const cuadrillaRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_materiales`, nombre);
  
        batch.update(almacenRef, {
          cantidad: increment(cantidad),
          actualizadoPor: datosDevolucion.usuario,
          actualizadoEn: new Date()
        });
  
        batch.update(cuadrillaRef, {
          cantidad: increment(-cantidad),
          actualizadoPor: datosDevolucion.usuario,
          actualizadoEn: new Date()
        });
      }
  
      // 4️⃣ Manejo de DRUMP (Residencial)
      if (datosDevolucion.tipo === "Residencial" && datosDevolucion.drump && datosDevolucion.metraje > 0) {
        await procesarDevolucionBobinaResidencial(batch);
      }
      
  
      // 5️⃣ Si es Condominio y hay metraje
      if (datosDevolucion.tipo === "Condominio" && datosDevolucion.metraje > 0) {
        const bobinaAlmacenRef = doc(db, "materiales_stock", "bobina");
        batch.update(bobinaAlmacenRef, {
          cantidad: increment(datosDevolucion.metraje),
          actualizadoPor: datosDevolucion.usuario,
          actualizadoEn: new Date()
        });
  
        const bobinaCuadrillaRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_materiales`, "bobina");
        batch.update(bobinaCuadrillaRef, {
          cantidad: increment(-datosDevolucion.metraje),
          actualizadoPor: datosDevolucion.usuario,
          actualizadoEn: new Date()
        });
      }
  
      // 6️⃣ Confirmar batch
      await batch.commit();
  
      // 7️⃣ Guardar la guía
      const datosFinal = {
        ...datosDevolucion,
        guiaId,
        materiales: materialesDevueltos,
        tecnicosUID: tecnicos,  // <-- Asegúrate que esto esté presente
        f_registro: new Date()
      };
      
  
      await addDoc(collection(db, "guias_devolucion"), datosFinal);
      toast.success("✅ Devolución registrada correctamente.");
  
      const urlComprobante = await generarPDFDevolucion(guiaId, datosFinal);
      toast.success("📄 PDF generado correctamente");

      // 🚨 Crear Notificación de Devolución
      await addDoc(collection(db, "notificaciones"), {
        tipo: "Devolución",
        mensaje: `🔄 ${datosFinal.usuario} registró devolución de la cuadrilla "${datosFinal.cuadrillaNombre}". Equipos: ${datosFinal.equipos.length}, Materiales: ${Object.values(datosFinal.materiales).reduce((a, b) => a + b, 0)}, Metros: ${datosFinal.metraje || 0}`,
        usuario: datosFinal.usuario,
        fecha: serverTimestamp(),
        guiaId: datosFinal.guiaId,
        link: urlComprobante,   // ✅ Aquí agregas el link del PDF
        detalles: {
          cuadrilla: datosFinal.cuadrillaNombre,
          tipo: datosFinal.tipo,
          equipos: datosFinal.equipos,
          materiales: datosFinal.materiales,
          drump: datosFinal.drump || "",
          metraje: datosFinal.metraje || 0
        },
        visto: false
      });
      

toast.success("🔔 Notificación de devolución registrada");
 
  
      // 🔹 5. Limpiar todos los estados
    setCuadrilla("");
    setListaEquipos([]);
    setMaterialesDevueltos({});
    setDatosDevolucion({
      cuadrillaId: "",
      cuadrillaNombre: "",
      tipo: "",
      tecnicos: [],
      equipos: [],
      drump: "",
      metraje: 0,
      observacion: "",
      usuario: userData?.nombres + " " + userData?.apellidos || "",
      fecha: new Date()
    });
    setSn("");
    setErrorSn("");
    setTecnicos([]);
    setBobinasActivas([]);

    inputRef.current?.focus();

    toast.success("✅ Devolución registrada correctamente", { id: toastId });
  } catch (error) {
    console.error("Error al registrar devolución:", error);
    toast.error("❌ Error al registrar la devolución.", { id: toastId });
  } finally {
    setProcesando(false);
  }
};
  
  
  
  
  

  

  const handleScan = async (e) => {
    const codigo = e.target.value.trim();

    if ((e.key === "Enter" || e.nativeEvent?.inputType === "insertLineBreak") && codigo) {
      if (listaEquipos.some(eq => eq.SN === codigo)) {
        setErrorSn("⚠️ Este SN ya ha sido escaneado.");
        setSn("");
        return;
      }

      const snap = await getDocs(collection(db, "equipos"));
      const encontrado = snap.docs.find(doc => doc.data().SN === codigo);

      if (!encontrado) {
        setErrorSn("❌ Este SN no se encuentra en la base de datos.");
        setSn("");
        return;
      }

      const data = encontrado.data();

      if (data.estado !== "campo" && data.estado !== "instalado") {
        setErrorSn("⚠️ Solo se pueden devolver equipos que estén en campo o instalados.");
        setSn("");
        return;
      }
      

      if (data.ubicacion !== datosDevolucion.cuadrillaNombre) {
        setErrorSn(`⚠️ Este equipo no pertenece a la cuadrilla ${datosDevolucion.cuadrillaNombre}.`);
        setSn("");
        return;
      }

      const nuevo = {
        SN: data.SN,
        equipo: data.equipo,
        descripcion: data.descripcion
      };

      setListaEquipos(prev => [...prev, nuevo]);
      setDatosDevolucion(prev => ({ ...prev, equipos: [...prev.equipos, nuevo] }));

      setErrorSn("");
      setSn("");
    }
  };

  const handleEliminar = (idx) => {
    setListaEquipos(prev => prev.filter((_, i) => i !== idx));
    setDatosDevolucion(prev => ({
      ...prev,
      equipos: prev.equipos.filter((_, i) => i !== idx)
    }));
  };







  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-[#30518c] mb-4">📦 Devolución de Equipos</h1>

      <input
        list="cuadrillas"
        placeholder="Selecciona cuadrilla"
        className="w-full border rounded px-3 py-2 mb-3"
        value={cuadrilla}
        onChange={(e) => setCuadrilla(e.target.value)}
      />
      <datalist id="cuadrillas">
        {listaCuadrillas.map(c => <option key={c.id} value={c.nombre} />)}
      </datalist>

      {tecnicos.length > 0 && (
        <p className="mb-2 text-sm">👷 Técnicos: {tecnicos.map(getNombreCompleto).join(", ")}</p>
      )}

      <input
        ref={inputRef}
        value={sn}
        onChange={(e) => setSn(e.target.value)}
        onKeyDown={handleScan}
        onInput={(e) => {
          if (e.nativeEvent?.inputType === "insertLineBreak") handleScan(e);
        }}
        placeholder="Escanear SN"
        className="w-full border rounded px-3 py-2 mb-2"
      />
      {errorSn && <p className="text-sm text-red-600 mb-2">{errorSn}</p>}

      {listaEquipos.length > 0 && (
        <div className="mt-4 border rounded bg-white p-4 shadow">
          <h2 className="font-semibold mb-2">📋 Equipos a devolver:</h2>
          <table className="w-full text-sm border">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-2">SN</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Descripción</th>
                <th className="p-2">Eliminar</th>
              </tr>
            </thead>
            <tbody>
              {listaEquipos.map((item, idx) => (
                <tr key={idx} className="border-b">
                  <td className="p-2">{item.SN}</td>
                  <td className="p-2">{item.equipo}</td>
                  <td className="p-2">{item.descripcion}</td>
                  <td className="p-2">
                    <button
                      className="text-red-600 hover:underline"
                      onClick={() => handleEliminar(idx)}
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

{stockEquiposCuadrilla.length > 0 && (
  <div className="mt-6 p-4 border rounded bg-white shadow">
    <h2 className="text-lg font-semibold text-[#30518c] mb-2">🔧 Stock de Equipos en Cuadrilla</h2>
    <ul className="list-disc pl-5 text-sm">
      {stockEquiposCuadrilla.map(eq => (
        <li key={eq.id}>
          {eq.SN} - {eq.tipo}
        </li>
      ))}
    </ul>
  </div>
)}



{stockMaterialesCuadrilla.length > 0 && (
  <div className="mt-6 p-4 border rounded bg-white shadow">
    <h2 className="text-lg font-semibold text-[#30518c] mb-2">📦 Stock de Materiales en Cuadrilla</h2>
    <ul className="list-disc pl-5 text-sm">
  {stockMaterialesCuadrilla
    .filter(mat => {
      // Ocultar "bobina" solo si es Residencial
      if (datosDevolucion.tipo === "Residencial" && mat.nombre === "bobina") return false;
      return true;
    })
    .map(mat => (
      <li key={mat.id}>
        {mat.id === "bobina"
          ? <>bobinas: <strong>{mat.cantidad} m</strong></>
          : <>{mat.nombre.replaceAll("_", " ")}: <strong>{mat.cantidad}</strong></>
        }
      </li>
    ))}
</ul>

  </div>
)}



      {/* Bloque 3: Devolución de bobina */}
      {datosDevolucion.tipo === "Residencial" && (
        <>
          <div className="mb-4 mt-4">
            <label className="block text-sm font-medium mb-1">Código DRUMP devuelto:</label>
            <input
              type="text"
              placeholder="Ej: DRUMP-000123"
              className="w-full border rounded px-3 py-2"
              onChange={(e) => setDatosDevolucion(prev => ({
                ...prev,
                drump: e.target.value
              }))}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Metros devueltos de esta bobina:</label>
            <input
              type="number"
              min="0"
              placeholder="Ej: 1480"
              className="w-full border rounded px-3 py-2"
              onChange={(e) => setDatosDevolucion(prev => ({
                ...prev,
                metraje: parseInt(e.target.value) || 0
              }))}
            />
            <p className="text-xs text-gray-500 mt-1">Registrar los metros reales que quedan en la bobina (o 0 si está vacía).</p>
          </div>
        </>
      )}


{/* Mostrar DRUMPs solo para Residencial */}
{datosDevolucion.tipo === "Residencial" && bobinasActivas.length > 0 && (
  <div className="mt-4 border p-3 rounded bg-white shadow">
    <h3 className="text-sm font-semibold mb-2 text-[#30518c]">🎗️ Bobinas DRUMP en Cuadrilla</h3>
    <table className="w-full text-sm border">
      <thead className="bg-gray-100">
        <tr>
          <th className="p-1 text-left">Código</th>
          <th className="p-1 text-right">Metros</th>
        </tr>
      </thead>
      <tbody>
        {bobinasActivas.map((b, i) => (
          <tr key={i} className="border-t">
            <td className="p-1">{b.codigo}</td>
            <td className="p-1 text-right">{b.metros}</td>
          </tr>
        ))}
        {/* Total de metros */}
        <tr className="border-t font-bold bg-gray-50">
          <td className="p-1 text-right">Total:</td>
          <td className="p-1 text-right">
            {bobinasActivas.reduce((total, b) => total + (b.metros || 0), 0)} m
          </td>
        </tr>
      </tbody>
    </table>
  </div>
)}



      {datosDevolucion.tipo === "Condominio" && (
        <div className="mb-4 mt-4">
          <label className="block text-sm font-medium mb-1">Metros devueltos:</label>
          <input
            type="number"
            min="0"
            placeholder="Ej: 180"
            className="w-full border rounded px-3 py-2"
            onChange={(e) => setDatosDevolucion(prev => ({
              ...prev,
              metraje: parseInt(e.target.value) || 0
            }))}
          />
          <p className="text-xs text-gray-500 mt-1">Indica la cantidad real de metros devueltos.</p>
        </div>
      )}

      {/* Bloque 4: Materiales complementarios */}
      <div className="mt-6 p-4 border rounded bg-white shadow-sm">
        <h2 className="text-lg font-semibold text-[#30518c] mb-2">📥 Materiales Devueltos</h2>
        <p className="text-sm text-gray-600 mb-3">Registra la cantidad real devuelta por material.</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {materialesDisponibles.map((nombre) => (
            <div key={nombre}>
              <label className="block text-sm capitalize text-gray-700">
                {nombre.replaceAll("_", " ")}:
              </label>
              <input
                type="number"
                min="0"
                className="w-full border rounded px-2 py-1 text-sm"
                value={materialesDevueltos[nombre] || ""}
                onChange={(e) => {
                  const cantidad = parseInt(e.target.value);
                  setMaterialesDevueltos((prev) => ({
                    ...prev,
                    [nombre]: isNaN(cantidad) ? "" : cantidad
                  }));
                }}
              />
            </div>
          ))}
        </div>

          

      </div>

          {/* Observaciones */}
<div className="mt-6">
  <label className="block text-sm font-medium text-gray-700 mb-1">📝 Observaciones:</label>
  <textarea
    rows={2}
    className="w-full border rounded px-3 py-2 text-sm"
    placeholder="Sin observaciones"
    value={datosDevolucion.observacion}
    onChange={(e) =>
      setDatosDevolucion((prev) => ({
        ...prev,
        observacion: e.target.value || "Sin observaciones"
      }))
    }
  />
</div>



      <div className="mt-6 flex flex-wrap gap-4">
  <button
    className={`px-6 py-2 rounded flex items-center gap-2 font-semibold ${
      procesando 
        ? "bg-gray-400 cursor-not-allowed" 
        : "bg-[#30518c] text-white hover:bg-[#203960]"
    }`}
    onClick={handleRegistrarDevolucion}
    disabled={procesando}
  >
    {procesando ? "Registrando..." : "✅ Registrar Devolución"}
  </button>
</div>


    </div>
    
  );
}