"use client";

import { useEffect, useRef, useState } from "react";
import { db, storage } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  writeBatch,
  increment,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/app/context/AuthContext";
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import toast from "react-hot-toast";

/* =======================
   CONSTANTES
======================= */
const MATS_AUT_ONT = {
  actas: 1,
  conectores: 2,
  rosetas: 1,
  acopladores: 1,
  pachcord: 1,
  cintillos_30: 4,
  cintillos_bandera: 1,
};

const materialesDisponibles = [
  "actas",
  "conectores",
  "cintillos_30",
  "cintillos_bandera",
  "rosetas",
  "acopladores",
  "pachcord",
  "cinta_aislante",
  "caja_grapas",
  "clevis",
  "hebillas",
  "templadores",
  "anclajes_tipo_p",
];

/* =======================
   WHATSAPP helpers
======================= */
const obtenerCelularesTecnicos = async (tecnicosUID = []) => {
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

const enviarPorWhatsAppManual = (
  numero,
  { tipoGuia, guiaId, cuadrilla, tecnicos, usuario, urlComprobante, extraInfo = "" }
) => {
  const mensaje = `📄 *${tipoGuia}*
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

/* =======================
   PDF (80mm)
======================= */
const generarPDFDevolucion = async (guiaId, datos) => {
  const calcularAltura = () => {
    let y = 60;
    y += (datos.tecnicos?.length || 0) * 5;
    y += (datos.equipos?.length || 0) * 5;
    if (datos.drump) y += 8;
    if (datos.metraje > 0) y += 5;
    y += Object.entries(datos.materiales || {}).length * 5;
    y += 20;
    y += 55;
    return Math.max(y, 200);
  };

  const alturaTotal = calcularAltura();
  const docpdf = new jsPDF({ unit: "mm", format: [80, alturaTotal] });

  const renderContenido = (yIni = 10) => {
    let y = yIni;
    const C = { align: "center" };
    docpdf.setFont("helvetica", "normal");
    docpdf.setFontSize(9);

    docpdf.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, C); y += 5;
    docpdf.text("RUC: 20601345979", 40, y, C); y += 5;
    docpdf.text("Cal. Juan Prado de Zela Mza. F2 Lote. 3", 40, y, C); y += 5;
    docpdf.text("Apv. San Francisco de Cayran", 40, y, C); y += 5;
    docpdf.text("Celular/WSP: 913 637 815", 40, y, C); y += 7;

    docpdf.setFont("helvetica", "bold");
    docpdf.text(`GUÍA: ${guiaId}`, 40, y, C); y += 5;
    docpdf.setFont("helvetica", "normal");
    docpdf.text(`FECHA: ${new Date().toLocaleString("es-PE")}`, 40, y, C); y += 5;
    docpdf.text(`USUARIO: ${datos.usuario}`, 40, y, C); y += 5;
    docpdf.text(`Cuadrilla: ${datos.cuadrillaNombre}`, 40, y, C); y += 5;

    (datos.tecnicos || []).forEach((tec, i) => {
      docpdf.text(`Técnico ${i + 1}: ${tec}`, 40, y, C); y += 5;
    });

    y += 3;
    docpdf.setFont("helvetica", "bold");
    docpdf.text("EQUIPOS DEVUELTOS", 40, y, C); y += 6;
    docpdf.setFont("helvetica", "normal");

    (datos.equipos || []).forEach((eq) => {
      docpdf.text(`${eq.SN} - ${eq.equipo}`, 40, y, C); y += 5;
    });

    if (datos.drump) {
      y += 4;
      docpdf.text(`DRUMP: ${datos.drump}`, 40, y, C); y += 5;
    }
    if (datos.metraje > 0) {
      docpdf.text(`Metros devueltos: ${datos.metraje} m`, 40, y, C); y += 5;
    }
    if (datos.bobinaCompletaDevuelta) {
  y += 2;
  docpdf.setFont("helvetica", "bold");
  docpdf.text("Bobina completa devuelta", 40, y, C);
  docpdf.setFont("helvetica", "normal");
  y += 5;
}



    const mats = Object.entries(datos.materiales || {});
    if (mats.length > 0) {
      y += 4;
      docpdf.setFont("helvetica", "bold");
      docpdf.text("MATERIALES DEVUELTOS", 40, y, C); y += 6;
      docpdf.setFont("helvetica", "normal");
      mats.forEach(([n, c]) => {
        docpdf.text(`${n.replaceAll("_", " ")}: ${c}`, 40, y, C); y += 5;
      });
    }

    y += 4;
    docpdf.text(`Observaciones: ${datos.observacion || "Sin observaciones"}`, 10, y, { maxWidth: 60 }); y += 1;

    const canvas = document.createElement("canvas");
    JsBarcode(canvas, guiaId, { format: "CODE128", displayValue: false, width: 2, height: 15 });
    const imgData = canvas.toDataURL("image/png");
    docpdf.addImage(imgData, "PNG", 5, y, 70, 25);
    y += 39;

    docpdf.line(10, y, 40, y);
    docpdf.line(45, y, 75, y);
    y += 10;
    docpdf.text("Técnico", 25, y, { align: "center" });
    docpdf.text("Almacén", 60, y, { align: "center" });
  };

  renderContenido();

  const pdfBlob = docpdf.output("blob");
  const storagePath = `guias_devolucion/${guiaId}.pdf`;
  const refStorage = storageRef(storage, storagePath);
  await uploadBytes(refStorage, pdfBlob);
  const urlComprobante = await getDownloadURL(refStorage);

  const tecnicosUID = datos.tecnicosUID || [];
  const celulares = await obtenerCelularesTecnicos(tecnicosUID);
  celulares.forEach((numero) =>
    enviarPorWhatsAppManual(numero, {
      tipoGuia: "Devolución",
      guiaId,
      cuadrilla: datos.cuadrillaNombre,
      tecnicos: datos.tecnicos,
      usuario: datos.usuario,
      urlComprobante,
      extraInfo: `🛠️ *Equipos:* ${datos.equipos.length}\n📦 *Materiales:* ${
        Object.values(datos.materiales || {}).reduce((a, b) => a + (Number(b) || 0), 0)
      }\n🌀 *Metros devueltos:* ${datos.metraje || 0}`,
    })
  );

  // doble impresión
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
  iframe.onafterprint = () => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  };

  return urlComprobante;
};

/* =======================
   COMPONENTE
======================= */
export default function Devolucion() {
  const { user, userData } = useAuth();

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
  const [bobinasActivas, setBobinasActivas] = useState([]);

  const [procesando, setProcesando] = useState(false);

  const [showPreview, setShowPreview] = useState(false);

  const [datosDevolucion, setDatosDevolucion] = useState({
    cuadrillaId: "",
    cuadrillaNombre: "",
    tipo: "",
    tecnicos: [],
    equipos: [],
    drump: "",
    metraje: 0,
    observacion: "",
    usuario:
      `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim() ||
      user?.email ||
      "Usuario",
    fecha: new Date(),
  });

  /* ======= Carga inicial ======= */
  useEffect(() => {
    (async () => {
      const cuadrillaSnap = await getDocs(collection(db, "cuadrillas"));
      const usuarioSnap = await getDocs(collection(db, "usuarios"));
      setListaCuadrillas(cuadrillaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setUsuarios(usuarioSnap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    })();
  }, []);

  /* ======= Helpers ======= */
  const getNombreCompleto = (uid) => {
    const u = usuarios.find((x) => x.uid === uid);
    return u ? `${u.nombres || ""} ${u.apellidos || ""}`.trim() : uid;
  };

  const obtenerStockCuadrilla = async (cuadrillaId, tipo) => {
    if (!cuadrillaId) return;
    const mats = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_materiales`));
    setStockMaterialesCuadrilla(mats.docs.map((d) => ({ id: d.id, ...d.data() })));
    const eqs = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_equipos`));
    setStockEquiposCuadrilla(eqs.docs.map((d) => ({ id: d.id, ...d.data() })));

    if (tipo === "Residencial") {
      const snap = await getDocs(collection(db, `cuadrillas/${cuadrillaId}/stock_bobinas`));
      const activas = snap.docs.map((d) => d.data()).filter((b) => b.estado !== "devuelto");
      setBobinasActivas(activas);
    } else {
      setBobinasActivas([]);
    }
  };

  /* ======= Selección de cuadrilla ======= */
  useEffect(() => {
    const sel = listaCuadrillas.find((c) => (c.nombre || "").toLowerCase() === (cuadrilla || "").toLowerCase());
    if (sel) {
      setTecnicos(sel.tecnicos || []);
      setDatosDevolucion((prev) => ({
        ...prev,
        cuadrillaId: sel.id,
        cuadrillaNombre: sel.nombre,
        tipo: sel.r_c,
        tecnicos: (sel.tecnicos || []).map(getNombreCompleto),
      }));
      obtenerStockCuadrilla(sel.id, sel.r_c);
    }
  }, [cuadrilla, listaCuadrillas]);

  /* ======= DRUMPs activos ======= */
  useEffect(() => {
    (async () => {
      if (!datosDevolucion.cuadrillaId || datosDevolucion.tipo !== "Residencial") return;
      const snap = await getDocs(collection(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_bobinas`));
      const activas = snap.docs.map((d) => d.data()).filter((b) => b.estado !== "devuelto");
      setBobinasActivas(activas);
    })();
  }, [datosDevolucion.cuadrillaId, datosDevolucion.tipo]);

  /* ======= Generar guía ======= */
  const generarNumeroGuia = async () => {
    const anio = new Date().getFullYear();
    const ref = doc(db, "counters", "guias_devolucion");
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, { anio, ultimoNumero: 1 });
      return `DEV-${anio}-00001`;
    }
    const nuevo = (snap.data().ultimoNumero || 0) + 1;
    await updateDoc(ref, { ultimoNumero: increment(1) });
    return `DEV-${anio}-${String(nuevo).padStart(5, "0")}`;
  };

  /* ======= Escanear SN ======= */
  const handleScan = async (e) => {
    const codigo = e.target.value.trim().toUpperCase();

    const fire = async () => {
      if (!codigo) return;
      if (!datosDevolucion.cuadrillaId) {
        toast.error("Selecciona una cuadrilla primero.");
        return;
      }
      if (listaEquipos.some((eq) => eq.SN === codigo)) {
        setErrorSn("⚠️ Este SN ya ha sido escaneado.");
        setSn("");
        return;
      }

      const snap = await getDocs(collection(db, "equipos"));
      const docEq = snap.docs.find((d) => (d.data().SN || "").toUpperCase() === codigo);
      if (!docEq) {
        setErrorSn("❌ Este SN no se encuentra en la base de datos.");
        setSn("");
        return;
      }

      const data = docEq.data();
      const estado = (data.estado || "").toLowerCase();

      if (estado !== "campo" && estado !== "instalado") {
        setErrorSn("⚠️ Solo se pueden devolver equipos que estén en campo o instalados.");
        setSn("");
        return;
      }

      if (estado === "campo" && (data.ubicacion || "") !== datosDevolucion.cuadrillaNombre) {
        setErrorSn(`⚠️ Este equipo no pertenece a la cuadrilla ${datosDevolucion.cuadrillaNombre}.`);
        setSn("");
        return;
      }

      if (estado === "instalado") {
        const cliente =
          data.cliente ||
          data.cliente_nombre ||
          data.nombre_cliente ||
          data.ubicacion ||
          "CLIENTE NO REGISTRADO";
        setDatosDevolucion((prev) => ({
          ...prev,
          observacion: `${prev.observacion ? prev.observacion + " | " : ""}SN ${data.SN} instalado en: ${cliente}`,
        }));
      }

      const nuevo = { SN: data.SN, equipo: data.equipo, descripcion: data.descripcion };
      setListaEquipos((p) => [...p, nuevo]);
      setDatosDevolucion((p) => ({ ...p, equipos: [...p.equipos, nuevo] }));
      setErrorSn("");
      setSn("");

      if ((data.equipo || "").toUpperCase() === "ONT") {
        setMaterialesDevueltos((prev) => {
          const n = { ...prev };
          Object.entries(MATS_AUT_ONT).forEach(([k, v]) => (n[k] = (n[k] || 0) + v));
          return n;
        });
      }
    };

    if (e.key === "Enter" || e.nativeEvent?.inputType === "insertLineBreak") {
      await fire();
    }
  };

  const handleEliminarEquipo = (idx) => {
    const el = listaEquipos[idx];
    setListaEquipos((p) => p.filter((_, i) => i !== idx));
    setDatosDevolucion((p) => ({ ...p, equipos: p.equipos.filter((_, i) => i !== idx) }));

    if ((el?.equipo || "").toUpperCase() === "ONT") {
      setMaterialesDevueltos((prev) => {
        const r = { ...prev };
        Object.entries(MATS_AUT_ONT).forEach(([k, v]) => {
          r[k] = Math.max(0, (r[k] || 0) - v);
        });
        return r;
      });
    }
  };

  /* ======= VALIDACIÓN DE STOCK ======= */
  const getStockCantidad = (nombre) => {
    const item = stockMaterialesCuadrilla.find(
      (m) => m.id === nombre || m.nombre === nombre
    );
    return Number(item?.cantidad || 0);
  };

  const validarStockAntesDeRegistrar = () => {
    const errores = [];

    // materiales
    Object.entries(materialesDevueltos || {}).forEach(([nombre, cant]) => {
      const cantidad = Number(cant) || 0;
      if (cantidad <= 0) return;
      const disponible = getStockCantidad(nombre);
      if (cantidad > disponible) {
        errores.push(
          `• ${nombre.replaceAll("_", " ")}: devuelves ${cantidad}, disponible ${disponible}`
        );
      }
    });

    // bobina condominio
    if (datosDevolucion.tipo === "Condominio" && Number(datosDevolucion.metraje) > 0) {
      const disp = getStockCantidad("bobina");
      if (Number(datosDevolucion.metraje) > disp) {
        errores.push(
          `• Bobina (Condominio): devuelves ${datosDevolucion.metraje} m y la cuadrilla solo tiene ${disp} m`
        );
      }
    }

    // bobina residencial
if (datosDevolucion.tipo === "Residencial" && datosDevolucion.drump) {
  const bob = bobinasActivas.find(
    (b) => (b.codigo || "").toUpperCase() === (datosDevolucion.drump || "").toUpperCase()
  );
  if (!bob) {
    errores.push(`• DRUMP ${datosDevolucion.drump} no está en stock de la cuadrilla.`);
  } else {
    const m = Number(datosDevolucion.metraje) || 0;
    if (m > 0 && m > Number(bob.metros || 0)) {
      errores.push(
        `• DRUMP ${datosDevolucion.drump}: devuelves ${m} m y solo tiene ${bob.metros} m`
      );
    }
  }
}


    if (errores.length > 0) {
      toast.error("Revisa los montos devueltos:\n" + errores.join("\n"));
      return { ok: false, errores };
    }
    return { ok: true };
  };

  /* ======= DRUMP residencial ======= */
  const procesarDevolucionBobinaResidencial = async (batch, guiaId, { forceCierre = false } = {}) => {
  const drRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_bobinas`, datosDevolucion.drump);
  const drSnap = await getDoc(drRef);
  if (!drSnap.exists()) {
    toast.error(`❌ El DRUMP ${datosDevolucion.drump} no existe en la cuadrilla.`);
    throw new Error("DRUMP no encontrado");
  }

  const datosBobina = drSnap.data();

  if (forceCierre) {
    // Devolución de bobina completa: estado devuelto y metros 0
    batch.set(
      drRef,
      {
        metros: 0,
        estado: "devuelto",
        f_devolucion: serverTimestamp(),
        guia_devolucion: guiaId,
        usuario: datosDevolucion.usuario,
      },
      { merge: true }
    );
    toast.success(`♻️ Bobina ${datosDevolucion.drump} marcada como *devuelto* (0 m).`);
    // Importante: no sumamos metros al almacén en este modo.
    return;
  }

  // Modo “por metros”
  const mDev = Number(datosDevolucion.metraje) || 0;
  if (mDev > Number(datosBobina.metros || 0)) {
    toast.error(`❌ No puedes devolver más de ${datosBobina.metros} metros.`);
    throw new Error("Metros inválidos");
  }

  const metrosRestantes = Number(datosBobina.metros || 0) - mDev;

  if (metrosRestantes <= 0) {
    batch.set(
      drRef,
      {
        metros: 0,
        estado: "devuelto",
        f_devolucion: serverTimestamp(),
        guia_devolucion: guiaId,
        usuario: datosDevolucion.usuario,
      },
      { merge: true }
    );
    toast.success(`♻️ Bobina ${datosDevolucion.drump} marcada como *devuelto* (0 m).`);
  } else {
    batch.set(
      drRef,
      {
        metros: metrosRestantes,
        actualizadoPor: datosDevolucion.usuario,
        actualizadoEn: serverTimestamp(),
        guia_devolucion: guiaId,
      },
      { merge: true }
    );
    toast.success(`✅ Bobina actualizada: ${metrosRestantes} m restantes.`);
  }

  // Sumar metros devueltos al almacén (solo en modo “por metros”)
  if (mDev > 0) {
    const bobinaAlmacenRef = doc(db, "materiales_stock", "bobina");
    const snapAlm = await getDoc(bobinaAlmacenRef);
    const actual = snapAlm.exists() ? Number(snapAlm.data().cantidad || 0) : 0;
    batch.set(
      bobinaAlmacenRef,
      {
        nombre: "bobina",
        cantidad: actual + mDev,
        actualizadoPor: datosDevolucion.usuario,
        actualizadoEn: serverTimestamp(),
      },
      { merge: true }
    );
  }
};


  /* ======= Registrar Devolución ======= */
  const handleRegistrarDevolucion = async () => {
    if (procesando) return;
    if (!datosDevolucion.cuadrillaId) {
      toast.error("Selecciona una cuadrilla.");
      return;
    }

    // Validación de stock (otra vez al confirmar)
    const v = validarStockAntesDeRegistrar();
    if (!v.ok) return;

    const toastId = toast.loading("Registrando devolución...");
    setProcesando(true);

    try {
      const batch = writeBatch(db);
      const guiaId = await generarNumeroGuia();
      setUltimaGuia(guiaId);

      // Devolución completa de bobina residencial sin metros
const forceCierreBobina =
  datosDevolucion.tipo === "Residencial" &&
  !!datosDevolucion.drump?.trim() &&
  (Number(datosDevolucion.metraje) || 0) === 0;

      const hayEquipos = datosDevolucion.equipos.length > 0;
const hayMats = Object.values(materialesDevueltos).some((v) => Number(v) > 0);
const hayMetros = Number(datosDevolucion.metraje) > 0;

if (!hayEquipos && !hayMats && !hayMetros && !forceCierreBobina) {
  toast.error("⚠️ Debes devolver al menos un equipo, material, metros de bobina o una bobina completa (DRUMP).");
  setProcesando(false);
  toast.dismiss(toastId);
  return;
}


      // 1) Equipos -> a almacén + guia_devolucion
      for (const eq of datosDevolucion.equipos) {
        const snap = await getDocs(collection(db, "equipos"));
        const d = snap.docs.find((x) => x.data().SN === eq.SN);
        if (d) {
          batch.set(
            doc(db, "equipos", d.id),
            {
              estado: "almacen",
              ubicacion: "almacen",
              f_despacho: null,
              usuario_despacho: null,
              tecnicos: [],
              guia_devolucion: guiaId, // ✅
            },
            { merge: true }
          );
          batch.delete(doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_equipos`, eq.SN));
        }
      }

      // 2) Materiales -> suman almacén y restan cuadrilla
      for (const [nombre, cantidadRaw] of Object.entries(materialesDevueltos)) {
        const cantidad = Number(cantidadRaw) || 0;
        if (cantidad <= 0) continue;

        const almRef = doc(db, "materiales_stock", nombre);
        const almSnap = await getDoc(almRef);
        const almActual = almSnap.exists() ? Number(almSnap.data().cantidad || 0) : 0;
        batch.set(
          almRef,
          {
            nombre,
            cantidad: almActual + cantidad,
            actualizadoPor: datosDevolucion.usuario,
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );

        const cuaRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_materiales`, nombre);
        const cuaSnap = await getDoc(cuaRef);
        const cuaActual = cuaSnap.exists() ? Number(cuaSnap.data().cantidad || 0) : 0;
        batch.set(
          cuaRef,
          {
            nombre,
            cantidad: Math.max(0, cuaActual - cantidad),
            actualizadoPor: datosDevolucion.usuario,
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 3) DRUMP / Metros
      if (datosDevolucion.tipo === "Residencial" && datosDevolucion.drump && (hayMetros || forceCierreBobina)) {
  await procesarDevolucionBobinaResidencial(batch, guiaId, { forceCierre: forceCierreBobina });
}


      if (datosDevolucion.tipo === "Condominio" && Number(datosDevolucion.metraje) > 0) {
        const metros = Number(datosDevolucion.metraje) || 0;

        // almacén bobina
        const bobAlmRef = doc(db, "materiales_stock", "bobina");
        const almSnap = await getDoc(bobAlmRef);
        const almActual = almSnap.exists() ? Number(almSnap.data().cantidad || 0) : 0;
        batch.set(
          bobAlmRef,
          {
            nombre: "bobina",
            cantidad: almActual + metros,
            actualizadoPor: datosDevolucion.usuario,
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );

        // cuadrilla bobina
        const bobCuaRef = doc(db, `cuadrillas/${datosDevolucion.cuadrillaId}/stock_materiales`, "bobina");
        const cuaSnap = await getDoc(bobCuaRef);
        const cuaActual = cuaSnap.exists() ? Number(cuaSnap.data().cantidad || 0) : 0;
        batch.set(
          bobCuaRef,
          {
            nombre: "bobina",
            cantidad: Math.max(0, cuaActual - metros),
            actualizadoPor: datosDevolucion.usuario,
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();

      // 4) Guardar guía
      const datosFinal = {
  ...datosDevolucion,
  guiaId,
  materiales: materialesDevueltos,
  tecnicosUID: tecnicos,
  f_registro: serverTimestamp(),
  bobinaCompletaDevuelta: forceCierreBobina || false,
};
await addDoc(collection(db, "guias_devolucion"), datosFinal);


      // 5) PDF + Notificación
      const urlComprobante = await generarPDFDevolucion(guiaId, datosFinal);

      await addDoc(collection(db, "notificaciones"), {
        tipo: "Devolución",
        mensaje: `🔄 ${datosFinal.usuario} registró devolución de "${datosFinal.cuadrillaNombre}". Equipos: ${
          datosFinal.equipos.length
        }, Materiales: ${Object.values(datosFinal.materiales || {}).reduce((a, b) => a + (Number(b) || 0), 0)}, Metros: ${
          datosFinal.metraje || 0
        }`,
        usuario: datosFinal.usuario,
        fecha: serverTimestamp(),
        guiaId: datosFinal.guiaId,
        link: urlComprobante,
        detalles: {
          cuadrilla: datosFinal.cuadrillaNombre,
          tipo: datosFinal.tipo,
          equipos: datosFinal.equipos,
          materiales: datosFinal.materiales,
          drump: datosFinal.drump || "",
          
          metraje: datosFinal.metraje || 0,
        },
        visto: false,
      });

      toast.success("✅ Devolución registrada correctamente.");

      // Reset UI
      setShowPreview(false);
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
        usuario:
          `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim() ||
          user?.email ||
          "Usuario",
        fecha: new Date(),
      });
      setSn("");
      setErrorSn("");
      setTecnicos([]);
      setBobinasActivas([]);
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      toast.error("❌ Error al registrar la devolución.");
    } finally {
      setProcesando(false);
    }
  };

  /* ======= Computados para previsualización ======= */
  // Computados para previsualización
const totalMateriales = Object.values(materialesDevueltos || {}).reduce(
  (a, b) => a + (Number(b) || 0), 0
);

// Permite previsualizar si:
// - hay equipos, o
// - hay materiales, o
// - hay metraje > 0, o
// - hay DRUMP residencial (aunque metraje sea 0)
const puedePrevisualizar =
  !!datosDevolucion.cuadrillaId &&
  (
    listaEquipos.length > 0 ||
    totalMateriales > 0 ||
    Number(datosDevolucion.metraje) > 0 ||
    (datosDevolucion.tipo === "Residencial" && !!datosDevolucion.drump?.trim())
  );


  /* =======================
     UI
  ======================= */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-center mb-4">📦 Devolución de Equipos y Materiales</h1>

        {/* Cuadrilla */}
        <div className="flex gap-2 mb-3">
          <input
            list="cuadrillas"
            placeholder="Selecciona cuadrilla"
            className="w-full border rounded-2xl px-3 h-11"
            value={cuadrilla}
            onChange={(e) => setCuadrilla(e.target.value)}
          />
          <datalist id="cuadrillas">
            {listaCuadrillas.map((c) => (
              <option key={c.id} value={c.nombre} />
            ))}
          </datalist>
        </div>

        {tecnicos.length > 0 && (
          <div className="mb-4 text-sm bg-white rounded-2xl p-3 border">
            <div><b>Cuadrilla:</b> {datosDevolucion.cuadrillaNombre}</div>
            <div><b>Tipo:</b> {datosDevolucion.tipo || "—"}</div>
            <div><b>Técnicos:</b> {tecnicos.map(getNombreCompleto).join(", ")}</div>
          </div>
        )}

        {/* Scan SN */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={sn}
            onChange={(e) => setSn(e.target.value.toUpperCase())}
            onKeyDown={handleScan}
            onInput={(e) => {
              if (e.nativeEvent?.inputType === "insertLineBreak") handleScan(e);
            }}
            placeholder="Escanear / ingresar SN"
            className="w-full border rounded-2xl px-3 h-11"
          />
          <button
            className="px-4 rounded-2xl h-11 bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700"
            onClick={() => handleScan({ key: "Enter", target: { value: sn } })}
          >
            Agregar
          </button>
        </div>
        {errorSn && <p className="text-sm text-red-600 mt-1">{errorSn}</p>}

        {/* Equipos list */}
        {listaEquipos.length > 0 && (
          <div className="mt-4 border rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold mb-2">📋 Equipos a devolver</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-left">SN</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Descripción</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {listaEquipos.map((item, idx) => (
                    <tr key={item.SN} className="border-t">
                      <td className="p-2">{item.SN}</td>
                      <td className="p-2">{item.equipo}</td>
                      <td className="p-2">{item.descripcion}</td>
                      <td className="p-2 text-right">
                        <button className="text-red-600 hover:underline" onClick={() => handleEliminarEquipo(idx)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stocks */}
        {stockEquiposCuadrilla.length > 0 && (
          <div className="mt-6 p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="text-lg font-semibold text-[#30518c] mb-2">🔧 Stock de Equipos en Cuadrilla</h2>
            <ul className="list-disc pl-5 text-sm">
              {stockEquiposCuadrilla.map((eq) => (
                <li key={eq.id}>{eq.SN} - {eq.tipo}</li>
              ))}
            </ul>
          </div>
        )}

        {stockMaterialesCuadrilla.length > 0 && (
          <div className="mt-6 p-4 border rounded-2xl bg-white shadow-sm">
            <h2 className="text-lg font-semibold text-[#30518c] mb-2">📦 Stock de Materiales en Cuadrilla</h2>
            <ul className="list-disc pl-5 text-sm">
              {stockMaterialesCuadrilla
                .filter((m) => !(datosDevolucion.tipo === "Residencial" && m.nombre === "bobina"))
                .map((m) => (
                  <li key={m.id}>
                    {m.id === "bobina"
                      ? <>bobinas: <strong>{m.cantidad} m</strong></>
                      : <>{(m.nombre || m.id).replaceAll("_", " ")}: <strong>{m.cantidad}</strong></>}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* DRUMP / Metros */}
        {datosDevolucion.tipo === "Residencial" && (
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Código DRUMP devuelto:</label>
              <input
                type="text"
                placeholder="Ej: WIN-4242"
                className="w-full border rounded-2xl px-3 h-11"
                value={datosDevolucion.drump}
                onChange={(e) => setDatosDevolucion((p) => ({ ...p, drump: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Metros devueltos de esta bobina:</label>
              <input
                type="number"
                min="0"
                className="w-full border rounded-2xl px-3 h-11
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={datosDevolucion.metraje || ""}
                onChange={(e) => setDatosDevolucion((p) => ({ ...p, metraje: parseInt(e.target.value) || 0 }))}
              />
              <p className="text-xs text-gray-500 mt-1">Registra los metros que retornan al almacén.</p>
            </div>
          </div>
        )}

        {datosDevolucion.tipo === "Residencial" && bobinasActivas.length > 0 && (
          <div className="mt-4 border p-3 rounded-2xl bg-white shadow-sm">
            <h3 className="text-sm font-semibold mb-2 text-[#30518c]">🎗️ Bobinas DRUMP en Cuadrilla</h3>
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-right">Metros</th>
                </tr>
              </thead>
              <tbody>
                {bobinasActivas.map((b, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{b.codigo}</td>
                    <td className="p-2 text-right">{b.metros}</td>
                  </tr>
                ))}
                <tr className="border-t font-bold bg-gray-50">
                  <td className="p-2 text-right">Total:</td>
                  <td className="p-2 text-right">
                    {bobinasActivas.reduce((t, b) => t + (b.metros || 0), 0)} m
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {datosDevolucion.tipo === "Condominio" && (
          <div className="mt-6">
            <label className="block text-sm font-medium mb-1">Metros devueltos:</label>
            <input
              type="number"
              min="0"
              className="w-full border rounded-2xl px-3 h-11
                [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={datosDevolucion.metraje || ""}
              onChange={(e) => setDatosDevolucion((p) => ({ ...p, metraje: parseInt(e.target.value) || 0 }))}
            />
          </div>
        )}

        {/* Materiales Devueltos */}
        <div className="mt-6 p-4 border rounded-2xl bg-white shadow-sm">
          <h2 className="text-lg font-semibold text-[#30518c] mb-2">📥 Materiales Devueltos</h2>
          <p className="text-sm text-gray-600 mb-3">Registra la cantidad real devuelta por material (editable).</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {materialesDisponibles.map((nombre) => (
              <div key={nombre} className="flex items-center justify-between gap-3">
                <label className="text-sm capitalize">{nombre.replaceAll("_", " ")}:</label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-24 text-right bg-white border border-slate-300 rounded-xl px-2 py-1.5
                    [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                    focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                  value={materialesDevueltos[nombre] ?? 0}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    setMaterialesDevueltos((prev) => ({
                      ...prev,
                      [nombre]: raw === "" ? 0 : Number(raw),
                    }));
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Observaciones */}
        <div className="mt-6">
          <label className="block text-sm font-medium mb-1">📝 Observaciones</label>
          <textarea
            rows={3}
            className="w-full border rounded-2xl p-3"
            placeholder="Sin observaciones"
            value={datosDevolucion.observacion}
            onChange={(e) =>
              setDatosDevolucion((prev) => ({
                ...prev,
                observacion: e.target.value,
              }))
            }
          />
        </div>

        {/* Botón Previsualizar */}
        <div className="mt-6">
          <button
            className={`w-full h-11 rounded-2xl font-semibold text-white shadow ${
              !puedePrevisualizar || procesando
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-gradient-to-r from-fuchsia-500 via-indigo-500 to-blue-500 hover:opacity-95"
            }`}
            onClick={() => {
              if (!puedePrevisualizar || procesando) return;
              const v = validarStockAntesDeRegistrar(); // ✅ validar antes de abrir modal
              if (v.ok) setShowPreview(true);
            }}
            disabled={!puedePrevisualizar || procesando}
          >
            {procesando ? "Procesando..." : "👀 Previsualizar y Confirmar"}
          </button>
        </div>

        {/* ========== MODAL PREVIEW ========== */}
        {showPreview && (
          <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => !procesando && setShowPreview(false)}
            />
            <div className="relative z-50 bg-white w-full md:max-w-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                <h3 className="font-semibold">Previsualización de Devolución</h3>
                <p className="text-xs opacity-90">Verifica antes de registrar</p>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><b>Cuadrilla:</b> {datosDevolucion.cuadrillaNombre}</div>
                  <div><b>Tipo:</b> {datosDevolucion.tipo}</div>
                  <div className="col-span-2">
                    <b>Técnicos:</b> {(datosDevolucion.tecnicos || []).join(", ") || "—"}
                  </div>
                </div>

                {listaEquipos.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-1 text-sm">Equipos ({listaEquipos.length})</h4>
                    <table className="w-full text-xs border rounded">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-2 text-left">SN</th>
                          <th className="p-2 text-left">Tipo</th>
                          <th className="p-2 text-left">Descripción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaEquipos.map((e) => (
                          <tr key={e.SN} className="border-t">
                            <td className="p-2">{e.SN}</td>
                            <td className="p-2">{e.equipo}</td>
                            <td className="p-2">{e.descripcion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {(datosDevolucion.metraje > 0 || datosDevolucion.drump) && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {datosDevolucion.drump && <div><b>DRUMP:</b> {datosDevolucion.drump}</div>}
                    {datosDevolucion.metraje > 0 && <div><b>Metros:</b> {datosDevolucion.metraje} m</div>}
                  </div>
                )}

                {totalMateriales > 0 && (
                  <div>
                    <h4 className="font-semibold mb-1 text-sm">Materiales devueltos</h4>
                    <ul className="text-sm list-disc pl-5">
                      {Object.entries(materialesDevueltos)
                        .filter(([, v]) => Number(v) > 0)
                        .map(([k, v]) => (
                          <li key={k} className="capitalize">
                            {k.replaceAll("_", " ")}: <b>{v}</b>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                <div className="text-sm">
                  <b>Observaciones:</b>{" "}
                  {datosDevolucion.observacion?.trim() || "Sin observaciones"}
                </div>
              </div>

              <div className="p-4 flex items-center justify-end gap-3 border-t">
                <button
                  className="px-4 h-10 rounded-2xl bg-gray-200 hover:bg-gray-300"
                  onClick={() => !procesando && setShowPreview(false)}
                  disabled={procesando}
                >
                  Cancelar
                </button>
                <button
                  className={`px-4 h-10 rounded-2xl text-white font-semibold ${
                    procesando
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                  onClick={handleRegistrarDevolucion}
                  disabled={procesando}
                >
                  {procesando ? "Registrando..." : "Confirmar y Registrar"}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ========== /MODAL PREVIEW ========== */}
      </div>
    </div>
  );
}
