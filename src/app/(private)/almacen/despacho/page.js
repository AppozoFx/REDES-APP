
"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { useAuth } from "@/app/context/AuthContext";
import { db, storage } from "@/firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, uploadString, getDownloadURL } from "firebase/storage";
import toast from "react-hot-toast";
import JsBarcode from "jsbarcode";
import jsPDF from "jspdf";
import StockCuadrilla from "@/app/components/StockCuadrilla";



// definición del componente Despacho
// Este componente permite gestionar el despacho de equipos a cuadrillas
// Permite buscar cuadrillas, escanear equipos y mostrar un resumen de los equipos escaneados
// Importaciones de Firebase y componentes de UI

// Función para enviar manualmente por WhatsApp
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






export default function Despacho() { // Despacho
    // Definición de estados
    const { user } = useAuth(); // Hook para obtener el usuario autenticado|
    const [cuadrillas, setCuadrillas] = useState([]); // Lista de cuadrillas
    const [busqueda, setBusqueda] = useState(''); // Input de búsqueda
    const [cuadrilla, setCuadrilla] = useState(null); // Cuadrilla seleccionada
    const [cuadrillaFiltrada, setCuadrillaFiltrada] = useState(null);
    const [cuadrillaSeleccionada, setCuadrillaSeleccionada] = useState(null);
    const tipoCuadrilla = cuadrillaSeleccionada?.r_c; // "Residencial" o "Condominio"
    const [loading, setLoading] = useState(true);
    const [paso, setPaso] = useState(1);
    const [snInput, setSnInput] = useState('');
  const [equipos, setEquipos] = useState([]);
  const [materialesONT, setMaterialesONT] = useState({});
  const [drumps, setDrumps] = useState([]); // Lista de DRUMPs únicos
  const [drumpInput, setDrumpInput] = useState('');
  const [observacion, setObservacion] = useState('');
  const vistaRef = useRef();

  const [stockMateriales, setStockMateriales] = useState([]);
const [stockEquipos, setStockEquipos] = useState([]);

const [bobinasActivas, setBobinasActivas] = useState([]);

const [procesando, setProcesando] = useState(false);




  
  const [usuarioNombre, setUsuarioNombre] = useState('');
  
  
  useEffect(() => {
    const fetchUsuario = async () => {
      if (user?.uid) {  
        const ref = doc(db, 'usuarios', user.uid);  // 1️⃣ Referencia al documento del usuario autenticado
        const snap = await getDoc(ref);             // 2️⃣ Obtener el documento desde Firestore
  
        if (snap.exists()) {                        // 3️⃣ Si el usuario existe en Firestore
          const data = snap.data();                 
          setUsuarioNombre(`${data.nombres || ''} ${data.apellidos || ''}`.trim());  // 4️⃣ Guarda el nombre completo
        } else {
          setUsuarioNombre(user.email || 'Usuario desconocido');  // 5️⃣ Si no existe, usa el email como fallback
        }
      }
    };
  
    fetchUsuario();
  }, [user]);  // 🔄 Se ejecuta cada vez que cambia el usuario autenticado
  

  
  
  
  const [materialesManuales, setMaterialesManuales] = useState({
    bobina: 0,
    actas: 0,
    conectores: 0,
    rosetas: 0,
    acopladores: 0,
    pachcord: 0,
    cintillos_30: 0,
    cintillos_10: 0,
    cintillos_bandera: 0,
    cinta_aislante: 0,
    // 🚨 Nuevos campos
    templadores: 0,
    cinta_bandi: 0,
    caja_grapas: 0,
  });
  
  
  
  
  
  
  const descontarMaterialesDelAlmacen = async (materialesTotales, usuarioNombre) => {
    const materialesKeys = Object.keys(materialesTotales);
  
    for (const nombre of materialesKeys) {
      const cantidadUsada = materialesTotales[nombre];
      const docRef = doc(db, "materiales_stock", nombre);
  
      const snap = await getDoc(docRef);
  
      if (!snap.exists()) {
        console.warn(`El material '${nombre}' no existe en stock`);
        continue;
      }
  
      const actual = snap.data().cantidad || 0;
      const nuevo = Math.max(0, actual - cantidadUsada);
  
      await updateDoc(docRef, {
        cantidad: nuevo,
        actualizadoPor: usuarioNombre,
        actualizadoEn: serverTimestamp(),
      });
    }
  };
  
  
  
  const actualizarStockDeCuadrilla = async (materiales, cuadrillaId) => {
    const stockRef = collection(db, "cuadrillas", cuadrillaId, "stock_materiales");
  
    for (const [material, cantidad] of Object.entries(materiales)) {
      const docRef = doc(stockRef, material);
      const snap = await getDoc(docRef);
  
      const actual = snap.exists() ? snap.data().cantidad || 0 : 0;
      const nuevo = actual + cantidad;
  
      await setDoc(docRef, {
        nombre: material,
        cantidad: nuevo,
        actualizadoPor: user?.nombres + " " + user?.apellidos || "Sistema",
        actualizadoEn: serverTimestamp(),
      }, { merge: true });
    }
  };
  
  const actualizarEquiposEnCampo = async (equipos, nombreCuadrilla, usuarioNombre, nombresTecnicos) => {
    for (const equipo of equipos) {
      const q = query(collection(db, 'equipos'), where('SN', '==', equipo.SN));
      const querySnapshot = await getDocs(q);
  
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
  
        await setDoc(docRef, {
          estado: "campo",
          ubicacion: nombreCuadrilla,
          f_despacho: serverTimestamp(),
          usuario_despacho: usuarioNombre,
          tecnicos: nombresTecnicos, // 👈 AÑADIMOS ESTA LÍNEA
        }, { merge: true });
      }
    }
  };
  
  
  
  
  
  
  const obtenerResumenEquipos = () => {
    const resumen = {};
  
    equipos.forEach((e) => {
      const tipo = e.equipo || 'Otros';
      resumen[tipo] = (resumen[tipo] || 0) + 1;
    });
  
    // Convertimos a formato texto: ONT 3 | MESH 2
    return Object.entries(resumen)
      .map(([tipo, cantidad]) => `${tipo.toUpperCase()} ${cantidad}`)
      .join(' | ');
  };
  
  
  const materialesTotales = { ...materialesONT };
  
  for (const [nombre, cantidad] of Object.entries(materialesManuales)) {
    materialesTotales[nombre] = (materialesTotales[nombre] || 0) + cantidad;
  }
  
  
  
    useEffect(() => {
      const fetchCuadrillas = async () => {
        try {
          const querySnapshot = await getDocs(collection(db, 'cuadrillas'));
          const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setCuadrillas(data);
        } catch (error) {
          console.error('Error al obtener cuadrillas:', error);
        } finally {
          setLoading(false);
        }
      };
  
      fetchCuadrillas();
    }, []);



    const obtenerStockCuadrilla = async (cuadrillaId, tipoCuadrilla) => {
      // 1️⃣ Stock de materiales
      const materialesSnap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_materiales`));
      const materiales = materialesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStockMateriales(materiales);
    
      // 2️⃣ Stock de equipos
      const equiposSnap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_equipos`));
      const equipos = equiposSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStockEquipos(equipos);
    
      // 3️⃣ Bobinas
      if (tipoCuadrilla === "Residencial") {
        const bobinasSnap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_bobinas`));
        const activas = bobinasSnap.docs.map(doc => doc.data()).filter(b => b.estado === "activo");
        setBobinasActivas(activas);
      } else {
        // Para condominios: leer documento "bobina" en stock_materiales
        const bobinaRef = doc(db, `cuadrillas/${cuadrillaId}/stock_materiales/bobina`);
        const bobinaSnap = await getDoc(bobinaRef);
        if (bobinaSnap.exists()) {
          const metros = bobinaSnap.data().cantidad || 0;
          setBobinasActivas([{ codigo: "Metraje acumulado", metros }]);
        } else {
          setBobinasActivas([]);
        }
      }
    };
    

    const obtenerResumenStockEquipos = () => {
      const resumen = {};
    
      stockEquipos.forEach(eq => {
        const tipo = eq.tipo?.toUpperCase() || 'OTROS';
        resumen[tipo] = (resumen[tipo] || 0) + 1;
      });
    
      return Object.entries(resumen)
        .map(([tipo, cantidad]) => `${tipo} ${cantidad}`)
        .join(' | ');
    };
    
    

  
    const obtenerNombresTecnicos = async (uids) => {
      if (!uids || uids.length === 0) return [];
      const usuariosSnap = await getDocs(collection(db, 'usuarios'));
      const usuarios = usuariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
      const nombres = uids.map(uid => {
        const user = usuarios.find(u => u.id === uid);
        return user ? `${user.nombres} ${user.apellidos}` : uid;
      });
    
      return nombres;
    };
    
  
    const normalizar = (texto) => texto.trim().toLowerCase();
  
    const handleBuscar = async () => {
      const resultado = cuadrillas.find(c =>
        normalizar(c.nombre || '') === normalizar(busqueda)
      );
    
      if (resultado) {
        const nombresTecnicos = await obtenerNombresTecnicos(resultado.tecnicos || []);
        resultado.nombresTecnicos = nombresTecnicos;
        setCuadrillaFiltrada(resultado);
        setCuadrillaSeleccionada(resultado);
         // 🚨 Cargar stock aquí
         await obtenerStockCuadrilla(resultado.id, resultado.r_c);
      } else {
        setCuadrillaFiltrada(null);
      }
    };
    
  
    const handleContinuar = () => {
      if (cuadrillaSeleccionada) {
        setPaso(2);
      }
    };
  
  
    const eliminarSN = (sn) => {
      const equipoEliminado = equipos.find((e) => e.SN === sn);
      const nuevoListado = equipos.filter((e) => e.SN !== sn);
      setEquipos(nuevoListado);
    
      // Si era ONT, restar materiales automáticamente
      if (equipoEliminado?.equipo?.toUpperCase() === "ONT") {
        setMaterialesONT((prev) => {
          const nuevos = { ...prev };
    
          nuevos["actas"] = (nuevos["actas"] || 0) - 1;
          nuevos["conectores"] = (nuevos["conectores"] || 0) - 2;
          nuevos["rosetas"] = (nuevos["rosetas"] || 0) - 1;
          nuevos["acopladores"] = (nuevos["acopladores"] || 0) - 1;
          nuevos["pachcord"] = (nuevos["pachcord"] || 0) - 1;
          nuevos["cintillos_30"] = (nuevos["cintillos_30"] || 0) - 4;
          nuevos["cintillos_bandera"] = (nuevos["cintillos_bandera"] || 0) - 1;
    
          // Eliminar claves con 0 o menos
          Object.keys(nuevos).forEach((key) => {
            if (nuevos[key] <= 0) delete nuevos[key];
          });
    
          return nuevos;
        });
      }
    };
  
  
    
    
    const handleAgregarDRUMP = () => {
      const codigo = drumpInput.trim().toUpperCase();
      if (!codigo) return;
    
      if (drumps.includes(codigo)) {
        toast.error("⚠️ DRUMP ya agregado.");
        return;
      }
    
      setDrumps((prev) => [...prev, codigo]);
      toast.success("✅ DRUMP agregado correctamente");
      setDrumpInput('');
    };
    
    const eliminarDRUMP = (codigo) => {
      setDrumps((prev) => prev.filter((d) => d !== codigo));
    };
    
  
  
  
  
  
  
    const handleAgregarSN = async () => {
      const sn = snInput.trim().toUpperCase();
    
      if (!sn) return;
      if (equipos.find((e) => e.SN === sn)) {
        toast.error("⚠️ Este SN ya fue escaneado.");
        setSnInput('');
        return;
      }
    
      const q = query(collection(db, 'equipos'), where('SN', '==', sn));
      const querySnapshot = await getDocs(q);
    
      if (querySnapshot.empty) {
        toast.error(`❌ El equipo con SN "${sn}" no existe en la base de datos.`);
        setSnInput('');
        return;
      }
    
      const data = querySnapshot.docs[0].data();
    
      // Validación de estado
      if (data.estado === 'campo' || data.estado === 'instalado') {
        toast.error(`🚫 Este equipo ya fue despachado o instalado.`);
        setSnInput('');
        return;
      }
    
      const equipo = {
        SN: data.SN,
        equipo: data.equipo || '-',
        descripcion: data.descripcion || '-',
        f_ingreso: data.f_ingreso?.seconds
          ? new Date(data.f_ingreso.seconds * 1000).toLocaleDateString('es-PE')
          : '-',
      };
    
      setEquipos((prev) => [...prev, equipo]);
      toast.success(`✅ Equipo ${sn} agregado`);
      setSnInput('');
  
      if (data.equipo?.toUpperCase() === "ONT") {
        setMaterialesONT(prev => {
          const nuevos = { ...prev };
      
          nuevos["actas"] = (nuevos["actas"] || 0) + 1;
          nuevos["conectores"] = (nuevos["conectores"] || 0) + 2;
          nuevos["rosetas"] = (nuevos["rosetas"] || 0) + 1;
          nuevos["acopladores"] = (nuevos["acopladores"] || 0) + 1;
          nuevos["pachcord"] = (nuevos["pachcord"] || 0) + 1;
          nuevos["cintillos_30"] = (nuevos["cintillos_30"] || 0) + 4;
          nuevos["cintillos_bandera"] = (nuevos["cintillos_bandera"] || 0) + 1;
      
          return nuevos;
        });
      }
      
  
    };
    const pdfBlobToBase64 = (blob) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };
    
  
  
    // Función para generar el ID incremental (debes tener tu contador creado en Firestore)
  const generarGuiaId = async () => {
    const counterRef = doc(db, "counters", "despacho");
    const counterSnap = await getDoc(counterRef);
    let count = 1;
  
    if (counterSnap.exists()) {
      count = counterSnap.data().valor + 1;
    }
  
    await setDoc(counterRef, { valor: count }, { merge: true });
  
    const year = new Date().getFullYear();
    return `GUIA-${year}-${String(count).padStart(5, "0")}`;
  };
  
  // 🚀 FUNCIÓN PRINCIPAL
  const handleFinalizarDespacho = async () => {

    if (procesando) return;  // Evita doble clic

    const toastId = toast.loading("Registrando despacho...");
    setProcesando(true);


    try {
      const totalMateriales = Object.values(materialesONT).reduce((a, b) => a + b, 0) +
                              Object.values(materialesManuales).reduce((a, b) => a + b, 0);
  
      const totalBobinas = cuadrillaSeleccionada?.r_c === "Residencial" ? drumps.length : 0;
  
      if (equipos.length === 0 && totalMateriales === 0 && totalBobinas === 0) {
        toast.error("⚠️ Debes escanear al menos un equipo, ingresar materiales o agregar bobinas para despachar.");
        return;
      }
  
      const usuario = usuarioNombre?.trim() || user?.email || "Usuario desconocido";
  
      await actualizarStockEquiposEnCuadrilla(equipos, cuadrillaSeleccionada?.id, usuario);

      const guiaId = await generarGuiaId();
      const fecha = new Date().toLocaleDateString();
      

  
      // ✅ Construimos el objeto completo a guardar
      const data = {
        guiaId,
        fecha,
        usuario,
        creadoPor: usuario,
        cuadrilla: cuadrillaSeleccionada?.nombre || "",
        tipo: cuadrillaSeleccionada?.r_c || "",
        zona: cuadrillaSeleccionada?.zona || "",
        tecnicos: cuadrillaSeleccionada?.nombresTecnicos || [],
        tecnicosUID: cuadrillaSeleccionada?.tecnicos || [],        // Los UID (para buscar celulares)
        equipos,
        materiales: {
          automaticos: materialesONT,
          manuales: materialesManuales,
          drumps,
        },
        observacion: observacion || "Sin observaciones",
        creadoEn: serverTimestamp(),
      };

  
      // 📤 Guardamos en Firestore
      const ref = doc(db, "guias_despacho", guiaId);
      await setDoc(ref, data);
      toast.success("✅ Despacho registrado");
  
      
  
  
      // 📉 Descontamos materiales del almacén
      const materialesTotales = { ...materialesONT };
      for (const [k, v] of Object.entries(materialesManuales)) {
        materialesTotales[k] = (materialesTotales[k] || 0) + v;
      }
      
  
      await descontarMaterialesDelAlmacen(materialesTotales, usuario);
      toast.success("📦 Materiales descontados");
  
      // ✅ Actualizar stock en cuadrilla
      await actualizarStockDeCuadrilla(materialesTotales, cuadrillaSeleccionada?.id);

      if (cuadrillaSeleccionada?.r_c === "Residencial" && drumps.length > 0) {
        // 1️⃣ Registrar DRUMPs en el stock de la cuadrilla
        await guardarBobinasResidencialesEnStock(drumps, cuadrillaSeleccionada?.id, usuario);
        toast.success("📦 Bobinas DRUMP registradas en stock de cuadrilla");
      
        // 2️⃣ Descontar 2000m por cada DRUMP del stock de almacén
        const bobinaRef = doc(db, "materiales_stock", "bobina");
        const bobinaSnap = await getDoc(bobinaRef);
      
        if (bobinaSnap.exists()) {
          const stockActual = bobinaSnap.data().cantidad || 0;
          const totalDescontar = drumps.length * 2000;
      
          const nuevoStock = Math.max(0, stockActual - totalDescontar);
      
          await updateDoc(bobinaRef, {
            cantidad: nuevoStock,
            actualizadoPor: usuario,
            actualizadoEn: serverTimestamp(),
          });
      
          toast.success(`➖ Se descontaron ${totalDescontar} metros del stock de bobinas`);
      
          // 3️⃣ Validación: Alerta si quedan menos de 20,000 metros (10 bobinas)
          if (nuevoStock < 20000) {
            toast.error(`⚠️ Atención: Solo quedan ${nuevoStock} metros en stock de bobinas (menos de 10 bobinas).`);
          }
      
        } else {
          toast.error("❌ No se encontró el stock de bobinas en el almacén");
        }
      }
      
      
      
      
  
      // ✅ Actualizar estado y ubicación de equipos
      await actualizarEquiposEnCampo(
        equipos,
        cuadrillaSeleccionada?.nombre,
        usuario,
        cuadrillaSeleccionada?.nombresTecnicos || []
      );
      toast.success("✅ Equipos actualizados en campo");      
  
      // 🧾 Generar PDF
      const urlComprobante = await generarPDFDespacho(guiaId, data);
      toast.success("📄 PDF generado correctamente");


      // 🚨 Aquí agregas la notificación
      await addDoc(collection(db, "notificaciones"), {
        tipo: "Despacho",
        mensaje: `📦 ${usuario} realizó un despacho para la cuadrilla "${cuadrillaSeleccionada?.nombre}". Equipos: ${equipos.length}, Materiales: ${Object.values(materialesTotales).reduce((a, b) => a + b, 0)}, Bobinas: ${drumps.length}`,
        usuario: usuario,
        fecha: serverTimestamp(),
        guiaId: guiaId,
        link: urlComprobante,   // ✅ Aquí agregas el link del PDF
        detalles: {
          cuadrilla: cuadrillaSeleccionada?.nombre,
          tipo: cuadrillaSeleccionada?.r_c,
          zona: cuadrillaSeleccionada?.zona,
          equipos: equipos.map(e => ({ SN: e.SN, tipo: e.equipo })),
          materiales: materialesTotales,
          bobinas: drumps
        },
        visto: false
      });
      
      toast.success("🔔 Notificación de despacho registrada");
      
      

      
      // ✅ Mostrar mensaje de éxito final
toast.success("✅ Despacho finalizado correctamente. Redirigiendo...");

// ✅ Limpiar todos los estados
setEquipos([]);
setMaterialesONT({});
setMaterialesManuales({
  bobina: 0,
  actas: 0,
  conectores: 0,
  rosetas: 0,
  acopladores: 0,
  pachcord: 0,
  cintillos_30: 0,
  cintillos_10: 0,
  cintillos_bandera: 0,
  cinta_aislante: 0,
});
setDrumps([]);
setDrumpInput("");
setSnInput("");
setObservacion("");
setBusqueda("");
setCuadrilla(null);
setCuadrillaFiltrada(null);
setCuadrillaSeleccionada(null);
setPaso(1); // 🔁 Volver al paso 1

  
toast.success("✅ Despacho finalizado correctamente", { id: toastId });
} catch (error) {
  console.error(error);
  toast.error("❌ Error al registrar el despacho", { id: toastId });
} finally {
  setProcesando(false);
}
};

  const actualizarStockEquiposEnCuadrilla = async (equipos, cuadrillaId, usuarioNombre) => {
    const stockRef = collection(db, "cuadrillas", cuadrillaId, "stock_equipos");
  
    for (const equipo of equipos) {
      const equipoDocRef = doc(stockRef, equipo.SN);
  
      await setDoc(equipoDocRef, {
        SN: equipo.SN,
        tipo: equipo.equipo || "-",
        descripcion: equipo.descripcion || "",
        f_despacho: serverTimestamp(),
        usuario_despacho: usuarioNombre,
        estado: "campo",
      });
    }
  };
  
    
  const guardarBobinasResidencialesEnStock = async (drumps, cuadrillaId, usuarioNombre) => {
    if (!drumps || drumps.length === 0) return;
  
    for (const codigo of drumps) {
      const bobinaRef = doc(db, `cuadrillas/${cuadrillaId}/stock_bobinas`, codigo);
  
      await setDoc(bobinaRef, {
        codigo,
        metros: 2000,
        estado: "activo",
        f_ingreso: serverTimestamp(),
        usuario: usuarioNombre,
      });
    }
  };
  
  
  
  
  
  
  
 


  const generarPDFDespacho = async (guiaId, datos) => {
    // 1️⃣ Calcular altura dinámica con mínimo de 200mm
    const calcularAltura = () => {
      let y = 60; // Cabecera
      y += datos.tecnicos.length * 5;
      y += Object.keys(datos.materiales.automaticos || {}).length * 5;
      y += Object.entries(datos.materiales.manuales || {}).filter(([_, v]) => v > 0).length * 5;
      y += (datos.materiales.drumps?.length || 0) * 4 + (datos.materiales.drumps?.length ? 10 : 0);
      y += datos.equipos.length * 5 + 20; // Equipos y Observaciones
    
      y += 55;  // Espacio para código de barras y firmas
    
      // ✅ Aquí controlas que la altura esté entre 200mm y 500mm
      return Math.min(Math.max(y, 200), 500);
    };
    
    
  
    const alturaTotal = calcularAltura();
    
    const doc = new jsPDF({ unit: "mm", format: [80, alturaTotal] });
  
    // 2️⃣ Renderizar contenido una sola vez
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
      doc.text(`Cuadrilla: ${datos.cuadrilla}`, 40, y, centrado); y += 5;
  
      datos.tecnicos.forEach((tec, i) => {
        doc.text(`Técnico ${i + 1}: ${tec}`, 40, y, centrado); y += 5;
      });
  
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.text("DESPACHO", 40, y, centrado); y += 6;
      doc.setFont("helvetica", "normal");
  
      Object.entries(datos.materiales.automaticos || {}).sort().forEach(([nombre, cant]) => {
        doc.text(`${nombre.replaceAll("_", " ")}: ${cant}`, 40, y, centrado); y += 5;
      });
  
      Object.entries(datos.materiales.manuales || {}).forEach(([nombre, cant]) => {
        if (cant > 0) {
          doc.text(`${nombre.replaceAll("_", " ")}: ${cant}`, 40, y, centrado); y += 5;
        }
      });
  
      if (datos.materiales.drumps?.length) {
        doc.text("Bobinas DRUMP:", 40, y, centrado); y += 5;
        datos.materiales.drumps.forEach((code) => {
          doc.text(`• ${code}`, 40, y, centrado); y += 4;
        });
        doc.text(`Total: ${datos.materiales.drumps.length * 2000} m`, 40, y, centrado); y += 5;
      }
  
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.text("Equipos:", 40, y, centrado); y += 5;
      doc.setFont("helvetica", "normal");
  
      datos.equipos.forEach((eq) => {
        doc.text(`${eq.SN} - ${eq.equipo}`, 40, y, centrado); y += 5;
      });
  
      y += 4;
      doc.text(`Observaciones: ${datos.observacion || "Sin observaciones"}`, 10, y, { maxWidth: 60 }); y += 1;
  
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
  
      doc.line(10, y, 40, y);
      doc.line(45, y, 75, y);
      y += 10;
  
      doc.text("Técnico", 25, y, { align: "center" });
      doc.text("Almacén", 60, y, { align: "center" });
      y += 10;
    };
  
    renderContenido();
  
    // 3️⃣ Guardar y lanzar impresión doble automática
    //doc.save(`${guiaId}.pdf`);


    // 3️⃣ Subir a Firebase Storage
  const pdfBlob = doc.output("blob");
  const storagePath = `guias_despacho/${guiaId}.pdf`;
  const refStorage = storageRef(storage, storagePath);
  await uploadBytes(refStorage, pdfBlob);

  // ✅ Aquí obtienes el URL del comprobante
const urlComprobante = await getDownloadURL(refStorage);
  toast.success("📄 PDF subido a Firebase");

  // 📲 Obtener celulares de los técnicos
  const tecnicosUID = datos.tecnicosUID || [];   // Asegúrate de pasar este campo en 'datos'
  const celulares = await obtenerCelularesTecnicos(tecnicosUID);


  // 💬 Enviar enlace por WhatsApp Manual
  celulares.forEach(numero => {
    enviarPorWhatsAppManual(numero, {
      tipoGuia: "Despacho",
      guiaId,
      cuadrilla: datos.cuadrilla,
      tecnicos: datos.tecnicos,
      usuario: datos.usuario,
      urlComprobante,
      extraInfo: `🛠️ *Equipos:* ${datos.equipos.length}\n📦 *Materiales:* ${Object.values(datos.materiales.automaticos).reduce((a,b) => a+b,0) + Object.values(datos.materiales.manuales).reduce((a,b) => a+b,0)}\n🌀 *Bobinas:* ${datos.materiales.drumps.length}`
    });
  });
  


  
// 5️⃣ Imprimir
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

return urlComprobante;   // ✅ Retornas la URL aquí
    
    // Limpieza después de imprimir
    iframe.onafterprint = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };
  };
  
  
  
  const enviarWhatsAppATecnicos = async (tecnicosUID, urlPDF) => {
    for (const uid of tecnicosUID) {
      const ref = doc(db, 'usuarios', uid);
      const snap = await getDoc(ref);
  
      if (snap.exists()) {
        const data = snap.data();
        const celular = data.celular;
  
        if (celular) {
          const mensaje = `Hola ${data.nombres || ''}, se ha generado tu guía de despacho. Puedes verla aquí: ${urlPDF}`;
          const enlaceWhatsApp = `https://wa.me/51${celular}?text=${encodeURIComponent(mensaje)}`;
  
          // Abrir en nueva pestaña (manual)
          window.open(enlaceWhatsApp, '_blank');
        }
      }
    }
  };
  
  
  
  
  
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        {paso === 1 && (
          <div className="max-w-xl mx-auto space-y-4">
            <h1 className="text-2xl font-bold text-center">Paso 1: Seleccionar Cuadrilla</h1>
  
            {/* AUTOCOMPLETADO + ENTER */}
  <div className="flex gap-2 relative">
    <Input
      list="cuadrillas-list"
      placeholder="Nombre de la cuadrilla"
      value={busqueda}
      onChange={(e) => setBusqueda(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleBuscar();
        }
      }}
    />
    <Button onClick={handleBuscar} disabled={loading || !busqueda}>
      Buscar
    </Button>
  
    {/* SUGERENCIAS */}
    <datalist id="cuadrillas-list">
      {cuadrillas.map((c) => (
        <option key={c.id} value={c.nombre} />
      ))}
    </datalist>
  </div>
  
  
            {loading && <p className="text-center">Cargando cuadrillas...</p>}
  
            {cuadrillaFiltrada ? (
              <Card className="bg-green-50 border-green-300">
                <CardContent className="p-4 space-y-2">
                  <h2 className="text-lg font-semibold">✅ Cuadrilla encontrada:</h2>
                  <p><strong>Nombre:</strong> {cuadrillaFiltrada.nombre}</p>
                  <p><strong>Tipo:</strong> {cuadrillaFiltrada.r_c} - {cuadrillaFiltrada.tipo}</p>
                  <p><strong>Zona:</strong> {cuadrillaFiltrada.zona || 'Sin zona asignada'}</p>
                  <p><strong>Técnicos:</strong> {(cuadrillaFiltrada.nombresTecnicos || []).join(', ') || 'No asignados'}</p>





                  <Button
    className="mt-4 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md hover:from-blue-700 hover:to-indigo-700"
    size="lg"
    onClick={handleContinuar}
  >
    🚀 Continuar al Paso 2
  </Button>




                  {/* STOCK DE EQUIPOS */}
                  <StockCuadrilla 
  titulo="🔧 Stock de Equipos en Cuadrilla" 
  items={stockEquipos} 
  tipo="equipos" 
/>






                {/* STOCK DE MATERIALES */}
                <StockCuadrilla 
  titulo="📦 Stock de Materiales en Cuadrilla" 
  items={stockMateriales} 
  tipo="materiales" 
/>


                  {cuadrillaSeleccionada?.r_c === "Residencial" && bobinasActivas.length > 0 && (
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




                  
  
                </CardContent>
              </Card>
            ) : (
              !loading && <p className="text-center text-red-500">Cuadrilla no encontrada.</p>
            )}
          </div>
        )}
  
  {paso === 2 && (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
    className="mt-4 bg-gray-300 hover:bg-gray-400 text-black px-4 py-2 rounded"
    onClick={() => {
      setPaso(1);
      setBusqueda('');
      setCuadrillaSeleccionada(null);
      setCuadrillaFiltrada(null);
      setEquipos([]);
      setMaterialesONT({});
      setMaterialesManuales({
        bobina: 0,
        actas: 0,
        conectores: 0,
        rosetas: 0,
        acopladores: 0,
        pachcord: 0,
        cintillos_30: 0,
        cintillos_10: 0,
        cintillos_bandera: 0,
        cinta_aislante: 0,
      });
      setDrumps([]);
      toast.success("🔄 Regresaste al Paso 1");
    }}
  >
    ⬅️ Regresar al Paso 1
  </button>

  {cuadrillaFiltrada ? (
              <Card className="bg-green-50 border-green-300">
                <CardContent className="p-4 space-y-2 text-center">
                  <p><strong>Cuadrilla:</strong> {cuadrillaFiltrada.nombre}</p>
                  <p><strong>Técnicos:</strong> {(cuadrillaFiltrada.nombresTecnicos || []).join(', ') || 'No asignados'}</p>
                </CardContent>
              </Card>
            ) : (
              !loading && <p className="text-center text-red-500"></p>
)}


      <h1 className="text-2xl font-bold text-center">Paso 2: Escanear Equipos</h1>
  
      {/* INPUT DE SCAN */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Escanea o ingresa el SN del equipo"
          value={snInput}
          onChange={(e) => setSnInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAgregarSN();
            }
          }}
        />
        <Button onClick={handleAgregarSN}>Agregar</Button>
      </div>
  

  
    {/* Siempre mostramos las opciones de despacho */}

<div className="bg-white shadow-md rounded-lg p-4">

 

  {/* Equipos escaneados */}
  <h2 className="text-lg font-bold mb-2">📋 Equipos escaneados ({equipos.length})</h2>
  {equipos.length > 0 && (
    <span className="text-sm text-gray-600 font-medium">
      {obtenerResumenEquipos()}
    </span>
  )}
  {equipos.length === 0 ? (
    
    <p className="text-gray-500 mb-4">No se ha escaneado ningún equipo.</p>
  ) : (
    <div className="overflow-x-auto mb-6">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">SN</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Equipo</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Descripción</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">F. Ingreso</th>
            <th className="px-4 py-2 text-sm font-semibold text-gray-700 text-right">Acción</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {equipos.map((item, index) => (
            <tr key={index} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-sm">{item.SN}</td>
              <td className="px-4 py-2 text-sm">{item.equipo}</td>
              <td className="px-4 py-2 text-sm">{item.descripcion}</td>
              <td className="px-4 py-2 text-sm">{item.f_ingreso}</td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => eliminarSN(item.SN)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}

  {/* Bobinas DRUMP */}
  {tipoCuadrilla === 'Residencial' && (
    <div className="mt-6">
      <h3 className="font-bold mb-2">📦 Bobinas DRUMP (Residencial)</h3>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="Código DRUMP"
          value={drumpInput}
          onChange={(e) => setDrumpInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleAgregarDRUMP()}
          className="border px-2 py-1 rounded w-64"
        />
        <button onClick={handleAgregarDRUMP} className="bg-blue-600 text-white px-4 py-1 rounded text-sm">
          Agregar
        </button>
      </div>
      {drumps.length > 0 && (
        <>
          <ul className="list-disc pl-5 text-sm">
            {drumps.map((d, i) => (
              <li key={i} className="flex justify-between w-72">
                {d}
                <button onClick={() => eliminarDRUMP(d)} className="text-red-500 text-xs hover:underline">Eliminar</button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">Total en metros: <strong>{drumps.length * 2000}</strong> m</p>
        </>
      )}
    </div>
  )}

{cuadrillaSeleccionada?.r_c === "Residencial" && bobinasActivas.length > 0 && (
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

  

  {/* Materiales Manuales */}
<div className="mt-6">
  <h3 className="font-bold mb-2">➕ Materiales adicionales (manuales)</h3>
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    {Object.entries(materialesManuales).map(([nombre, cantidad]) => (
      <div key={nombre} className="flex items-center gap-2">
        <label className="capitalize text-sm w-32">{nombre.replace('_', ' ')}:</label>
        <input
          type="text"
          value={cantidad}
          onChange={(e) => {
            const valor = e.target.value.replace(/\D/g, '');  // Solo permite números
            setMaterialesManuales(prev => ({
              ...prev,
              [nombre]: valor === '' ? 0 : parseInt(valor)
            }));
          }}
          className="border rounded px-2 py-1 w-20 text-sm text-right"
        />
      </div>
    ))}
  </div>
</div>



     

  {/* Observaciones */}
  <div className="mt-6">
    <label className="block text-sm font-semibold mb-1">📝 Observaciones del despacho</label>
    <textarea
      value={observacion}
      onChange={(e) => setObservacion(e.target.value)}
      rows={3}
      placeholder="Escribe aquí alguna observación (opcional)"
      className="w-full p-2 border rounded"
    />
  </div>


  
{/* Materiales Automáticos */}
{Object.keys(materialesONT).length > 0 && (
    <div className="mt-6">
      <h3 className="font-bold mb-2">📦 Materiales agregados automáticamente (ONT)</h3>
      <ul className="list-disc pl-5 text-sm">
        {Object.entries(materialesONT).map(([nombre, cantidad]) => (
          <li key={nombre}>{nombre.replace('_', ' ')}: <strong>{cantidad}</strong></li>
        ))}
      </ul>
    </div>
  )}
  

</div>

{/* BOTÓN FINALIZAR */}
<div className="mt-6">
  <button
    onClick={handleFinalizarDespacho}
    disabled={procesando}
    className={`w-full py-3 rounded-lg font-semibold 
      ${procesando 
        ? 'bg-gray-400 cursor-not-allowed' 
        : 'bg-gradient-to-r from-purple-500 to-blue-500 text-white'}`}
  >
    {procesando ? "Registrando..." : "🚛 Finalizar Despacho"}
  </button>
</div>


  
      
    </div>
  )}
  
      </div>
    );
  }
  