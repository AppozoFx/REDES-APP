"use client";

/* =====================================================================
   IMPORTS
===================================================================== */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/context/AuthContext";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { db, storage } from "@/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import toast from "react-hot-toast";
import StockCuadrilla from "@/app/components/StockCuadrilla";

/* =====================================================================
   CONSTANTES DE NEGOCIO
===================================================================== */
const RES_BOBINA_METROS = 1000;          // Residencial: DRUMP = 1000 m
const CINTA_BANDI_METROS = 30.5;         // 1 caja cinta bandi = 30.5 m



// 🔔 Umbrales de alerta de stock bajo (ajusta a tu operación)
const STOCK_MIN_MATERIAL = 5; // alerta si en almacén quedan <= 5 unidades
const STOCK_MIN_EQUIPO   = 3; // alerta si en almacén quedan <= 3 equipos por tipo


// Materiales automáticos por cada ONT
const MATS_AUT_ONT = {
  actas: 1,
  conectores: 2,
  rosetas: 1,
  acopladores: 1,
  patchcord: 1,
  cintillos_30: 4,
  cintillos_bandera: 1,
};

const MATERIAL_ALIASES = { pachcord: "patchcord" };

/* =====================================================================
   UTILS
===================================================================== */
const fmt = (n) => new Intl.NumberFormat("es-PE").format(n || 0);
const normalizeKey = (k) =>
  (MATERIAL_ALIASES[(k || "").toLowerCase()] || (k || "").toLowerCase()).replaceAll(" ", "_");
const sumDict = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const kk = normalizeKey(k);
    out[kk] = (out[kk] || 0) + (Number(v) || 0);
  }
  return out;
};

/* =====================================================================
   HOOK: CLICK GUARD (anti doble-click)
===================================================================== */
function useClickGuard(defaultCooldownMs = 700) {
  const untilRef = useRef(0);
  return (fn, ms = defaultCooldownMs) => {
    if (Date.now() < untilRef.current) return;
    untilRef.current = Date.now() + ms;
    try {
      return fn();
    } finally {
      setTimeout(() => {
        if (Date.now() >= untilRef.current) untilRef.current = 0;
      }, ms);
    }
  };
}

/* =====================================================================
   WHATSAPP
===================================================================== */
const obtenerCelularesTecnicos = async (tecnicosUID) => {
  const celulares = [];
  for (const uid of tecnicosUID || []) {
    const ref = doc(db, "usuarios", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      if (d.celular) celulares.push(d.celular);
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

/* =====================================================================
   PDF (80mm)
===================================================================== */
async function generarPDFySubir({ guiaId, datos }) {
  const altura = (() => {
    let y = 60;
    y += (datos.tecnicos?.length || 0) * 5;
    y += Object.keys(datos.materiales?.automaticos || {}).length * 5;
    y += Object.entries(datos.materiales?.manuales || {}).filter(([_, v]) => v > 0).length * 5;
    y += (datos.materiales?.drumps?.length || 0) * 4 + (datos.materiales?.drumps?.length ? 10 : 0);
    y += (datos.metrosCondominio || 0) > 0 ? 8 : 0;
    y += (datos.equipos?.length || 0) * 5 + 30;
    y += 55;
    return Math.min(Math.max(y, 200), 500);
  })();

  const docpdf = new jsPDF({ unit: "mm", format: [80, altura] });
  let y = 10;
  const C = { align: "center" };
  docpdf.setFont("helvetica", "normal");
  docpdf.setFontSize(9);

  docpdf.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, C); y += 5;
  docpdf.text("RUC: 20601345979", 40, y, C); y += 5;
  docpdf.text("Cal. Juan Prado de Zela Mza. F2 Lt. 3", 40, y, C); y += 5;
  docpdf.text("Apv. San Francisco de Cayran", 40, y, C); y += 5;
  docpdf.text("Cel/WSP: 913 637 815", 40, y, C); y += 7;

  docpdf.setFont("helvetica", "bold");
  docpdf.text(`GUÍA: ${guiaId}`, 40, y, C); y += 5;
  docpdf.setFont("helvetica", "normal");
  docpdf.text(`FECHA: ${new Date().toLocaleString("es-PE")}`, 40, y, C); y += 5;
  docpdf.text(`USUARIO: ${datos.usuario}`, 40, y, C); y += 5;
  docpdf.text(`CUADRILLA: ${datos.cuadrilla}`, 40, y, C); y += 5;
  (datos.tecnicos || []).forEach((t, i) => { docpdf.text(`Técnico ${i + 1}: ${t}`, 40, y, C); y += 5; });

  y += 3;
  docpdf.setFont("helvetica", "bold");
  docpdf.text("DESPACHO", 40, y, C); y += 6;
  docpdf.setFont("helvetica", "normal");

  Object.entries(datos.materiales?.automaticos || {}).sort().forEach(([n, c]) => { docpdf.text(`${n.replaceAll("_", " ")}: ${c}`, 40, y, C); y += 5; });

  Object.entries(datos.materiales?.manuales || {}).forEach(([n, c]) => {
    if (c > 0) { docpdf.text(`${n.replaceAll("_", " ")}: ${c}`, 40, y, C); y += 5; }
  });

  if (datos.tipo === "Residencial" && (datos.materiales?.drumps?.length || 0) > 0) {
    docpdf.text("Bobinas DRUMP:", 40, y, C); y += 5;
    datos.materiales.drumps.forEach((code) => { docpdf.text(`• ${code}`, 40, y, C); y += 4; });
    docpdf.text(`Total: ${datos.materiales.drumps.length * RES_BOBINA_METROS} m`, 40, y, C); y += 5;
  }
  if (datos.tipo === "Condominio" && (datos.metrosCondominio || 0) > 0) {
    docpdf.text(`Bobina (metros): ${datos.metrosCondominio}`, 40, y, C); y += 5;
  }

  y += 3;
  docpdf.setFont("helvetica", "bold");
  docpdf.text("Equipos:", 40, y, C); y += 5;
  docpdf.setFont("helvetica", "normal");
  (datos.equipos || []).forEach((eq) => { docpdf.text(`${eq.SN} - ${eq.equipo}`, 40, y, C); y += 5; });

  y += 4;
  docpdf.text(`Obs: ${datos.observacion || "Sin observaciones"}`, 10, y, { maxWidth: 60 }); y += 1;

  const canvas = document.createElement("canvas");
  JsBarcode(canvas, guiaId, { format: "CODE128", displayValue: false, width: 2, height: 15 });
  const img = canvas.toDataURL("image/png");
  docpdf.addImage(img, "PNG", 5, y, 70, 25);
  y += 39;

  docpdf.line(10, y, 40, y);
  docpdf.line(45, y, 75, y);
  y += 10;
  docpdf.text("Técnico", 25, y, { align: "center" });
  docpdf.text("Almacén", 60, y, { align: "center" });

  const blob = docpdf.output("blob");
  const path = `guias_despacho/${guiaId}.pdf`;
  const sref = storageRef(storage, path);
  await uploadBytes(sref, blob);
  const url = await getDownloadURL(sref);

  // WhatsApp
  const celulares = await obtenerCelularesTecnicos(datos.tecnicosUID || []);
  celulares.forEach((numero) => {
    enviarPorWhatsAppManual(numero, {
      tipoGuia: "Despacho",
      guiaId,
      cuadrilla: datos.cuadrilla,
      tecnicos: datos.tecnicos,
      usuario: datos.usuario,
      urlComprobante: url,
      extraInfo: `🛠️ *Equipos:* ${datos.equipos.length}\n📦 *Materiales:* ${
        Object.values(datos.materiales.automaticos).reduce((a, b) => a + b, 0) +
        Object.values(datos.materiales.manuales).reduce((a, b) => a + b, 0)
      }\n🌀 *Bobinas:* ${datos.materiales.drumps.length}`,
    });
  });

  // Doble impresión
  const urlBlob = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = urlBlob;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.contentWindow.print(), 1000);
  };
  iframe.onafterprint = () => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(urlBlob);
  };

  return url;
}

/* =====================================================================
   ID INCREMENTAL
===================================================================== */
async function generarGuiaId() {
  const ref = doc(db, "counters", "despacho");
  const snap = await getDoc(ref);
  const next = (snap.exists() ? (snap.data().valor || 0) : 0) + 1;
  await setDoc(ref, { valor: next }, { merge: true });
  const year = new Date().getFullYear();
  return `GUIA-${year}-${String(next).padStart(5, "0")}`;
}

/* =====================================================================
   COMPONENTE
===================================================================== */
export default function Despacho() {
  const { user } = useAuth();
  const guard = useClickGuard(700);

  // Estado base
  const [cuadrillas, setCuadrillas] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [cuadrillaSel, setCuadrillaSel] = useState(null);
  const tipo = cuadrillaSel?.r_c;

  // Equipos
  const [equipos, setEquipos] = useState([]);
  const [snInput, setSnInput] = useState("");

  // Materiales
  const [matAutoONT, setMatAutoONT] = useState({});
  const [matManuales, setMatManuales] = useState({
    // ❗ Se mantiene SIN "bobina" manual (evita redundancia con DRUMP/metros)
    actas: 0,
    conectores: 0,
    rosetas: 0,
    acopladores: 0,
    patchcord: 0,
    pachcord: 0,
    cintillos_30: 0,
    cintillos_10: 0,
    cintillos_bandera: 0,
    cinta_aislante: 0,
    templadores: 0,
    anclajes_tipo_p: 0,
    clevis: 0,
    hebillas: 0,
    cinta_bandi: 0,
    caja_grapas: 0,
  });

  // Bobinas
  const [drumps, setDrumps] = useState([]);                 // Residencial
  const [drumpInput, setDrumpInput] = useState("");
  const [metrosCondominio, setMetrosCondominio] = useState(300); // Condominio

  // Stocks
  const [stockMateriales, setStockMateriales] = useState([]);
  const [stockEquipos, setStockEquipos] = useState([]);
  const [bobinasActivas, setBobinasActivas] = useState([]);

  // Otros
  const [loading, setLoading] = useState(true);
  const [paso, setPaso] = useState(1);
  const [observacion, setObservacion] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [usuarioNombre, setUsuarioNombre] = useState("");

  // Preview
  const [showPreview, setShowPreview] = useState(false);

  /* ==== Usuario ==== */
  useEffect(() => {
    (async () => {
      if (!user?.uid) return;
      const ref = doc(db, "usuarios", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        setUsuarioNombre(`${d.nombres || ""} ${d.apellidos || ""}`.trim() || user.email);
      } else {
        setUsuarioNombre(user.email || "Usuario");
      }
    })();
  }, [user]);

  /* ==== Cargar cuadrillas ==== */
  useEffect(() => {
    (async () => {
      const rs = await getDocs(collection(db, "cuadrillas"));
      setCuadrillas(rs.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, []);

  /* ==== Helpers ==== */
  const normalize = (t) => (t || "").toString().trim().toLowerCase();
  const obtenerNombresTecnicos = async (uids = []) => {
    if (!uids.length) return [];
    const rs = await getDocs(collection(db, "usuarios"));
    const all = rs.docs.map((d) => ({ id: d.id, ...d.data() }));
    return uids.map((uid) => {
      const u = all.find((x) => x.id === uid);
      return u ? `${u.nombres || ""} ${u.apellidos || ""}`.trim() : uid;
    });
  };
  const obtenerStockCuadrilla = async (id, r_c) => {
    const ms = await getDocs(collection(db, `cuadrillas/${id}/stock_materiales`));
    setStockMateriales(ms.docs.map((d) => ({ id: d.id, ...d.data() })));
    const es = await getDocs(collection(db, `cuadrillas/${id}/stock_equipos`));
    setStockEquipos(es.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (r_c === "Residencial") {
      const bs = await getDocs(collection(db, `cuadrillas/${id}/stock_bobinas`));
      const act = bs.docs.map((d) => d.data()).filter((b) => b.estado === "activo");
      setBobinasActivas(act);
    } else {
      const bRef = await getDoc(doc(db, `cuadrillas/${id}/stock_materiales/bobina`));
      if (bRef.exists()) setBobinasActivas([{ codigo: "Metraje acumulado", metros: bRef.data().cantidad || 0 }]);
      else setBobinasActivas([]);
    }
  };

  /* ==== Buscar ==== */
  const handleBuscar = () =>
    guard(async () => {
      const res = cuadrillas.find((c) => normalize(c.nombre) === normalize(busqueda));
      if (!res) {
        toast.error("Cuadrilla no encontrada.");
        setCuadrillaSel(null);
        return;
      }
      res.nombresTecnicos = await obtenerNombresTecnicos(res.tecnicos || []);
      setCuadrillaSel(res);
      await obtenerStockCuadrilla(res.id, res.r_c);
    });

  const handleContinuar = () => cuadrillaSel && setPaso(2);

  /* ==== Equipos ==== */
  const handleAgregarSN = () =>
    guard(async () => {
      const sn = snInput.trim().toUpperCase();
      if (!sn) return;
      if (equipos.some((e) => e.SN === sn)) {
        toast.error("⚠️ Este SN ya fue escaneado.");
        setSnInput("");
        return;
      }
      const q = query(collection(db, "equipos"), where("SN", "==", sn));
      const qs = await getDocs(q);
      if (qs.empty) {
        toast.error(`❌ El equipo con SN "${sn}" no existe en la base de datos.`);
        setSnInput("");
        return;
      }
      const data = qs.docs[0].data();
      const estado = (data.estado || "").toLowerCase();
      if (estado === "campo" || estado === "instalado") {
        toast.error("🚫 Este equipo ya fue despachado o instalado.");
        setSnInput("");
        return;
      }
      const equipo = {
        SN: data.SN,
        equipo: data.equipo || "-",
        descripcion: data.descripcion || "-",
        f_ingreso: data.f_ingreso?.seconds
          ? new Date(data.f_ingreso.seconds * 1000).toLocaleDateString("es-PE")
          : "-",
      };
      setEquipos((p) => [...p, equipo]);
      setSnInput("");
      toast.success(`✅ Equipo ${sn} agregado`);

      if ((data.equipo || "").toUpperCase() === "ONT") {
        setMatAutoONT((prev) => sumDict(prev, MATS_AUT_ONT));
      }
    });

  const eliminarSN = (sn) => {
    const eq = equipos.find((e) => e.SN === sn);
    setEquipos((p) => p.filter((e) => e.SN !== sn));
    if ((eq?.equipo || "").toUpperCase() === "ONT") {
      const restar = {};
      Object.entries(MATS_AUT_ONT).forEach(([k, v]) => (restar[k] = -v));
      setMatAutoONT((prev) => {
        const r = sumDict(prev, restar);
        Object.keys(r).forEach((k) => r[k] <= 0 && delete r[k]);
        return r;
      });
    }
  };

  /* ==== DRUMP ==== */
  const handleAgregarDRUMP = () =>
    guard(() => {
      const code = drumpInput.trim().toUpperCase();
      if (!code) return;
      if (drumps.includes(code)) {
        toast.error("⚠️ DRUMP ya agregado.");
        return;
      }
      setDrumps((p) => [...p, code]);
      setDrumpInput("");
      toast.success("✅ DRUMP agregado");
    });

  const eliminarDRUMP = (code) => setDrumps((p) => p.filter((x) => x !== code));

  /* ==== Resumen equipos ==== */
  const resumenEquipos = useMemo(() => {
    const r = {};
    equipos.forEach((e) => {
      const t = (e.equipo || "otros").toUpperCase();
      r[t] = (r[t] || 0) + 1;
    });
    return Object.entries(r)
      .map(([t, c]) => `${t} ${c}`)
      .join(" | ");
  }, [equipos]);

  /* ==== Validación para abrir PREVIEW ==== */
  const canProceedPreview = () => {
    const manualesCanon = {};
    Object.entries(matManuales).forEach(([k, v]) => (manualesCanon[normalizeKey(k)] = Number(v) || 0));
    if ((manualesCanon.clevis || 0) > 0)
      manualesCanon.hebillas = Math.max(manualesCanon.hebillas || 0, manualesCanon.clevis * 2);
    const matsTotales = sumDict(matAutoONT, manualesCanon);
    const hayMateriales = Object.values(matsTotales).some((n) => (Number(n) || 0) > 0);

    if (tipo === "Residencial") {
      // Puede ser: solo DRUMP, solo equipos, o materiales.
      return drumps.length > 0 || equipos.length > 0 || hayMateriales;
    } else {
      // Condominio: metros o equipos o materiales
      return (Number(metrosCondominio) || 0) > 0 || equipos.length > 0 || hayMateriales;
    }
  };

  /* ==== PREVIEW ==== */
  const abrirPreview = () =>
    guard(() => {
      if (!cuadrillaSel?.id) {
        toast.error("Selecciona una cuadrilla.");
        return;
      }
      if (!canProceedPreview()) {
        if (tipo === "Residencial") {
          toast.error("Para Residencial: agrega al menos 1 DRUMP o equipos/materiales.");
        } else {
          toast.error("Para Condominio: agrega metros de bobina, equipos o materiales.");
        }
        return;
      }
      setShowPreview(true);
    });

  /* ==== CONFIRMAR ==== */
  const confirmarDespacho = () =>
    guard(async () => {
      if (procesando) return;
      setProcesando(true);
      const toastId = toast.loading("Registrando despacho...");

      try {
        const usuario = usuarioNombre || user?.email || "Usuario";
        const guiaId = await generarGuiaId();
        // --- colecciones para alertas ---
const lowMaterials = [];   // [{ nombre, restante }]
const lowEquipTypes = [];  // [{ tipo, restante }]


        // Materiales totales (canon)
        const manualesCanon = {};
        Object.entries(matManuales).forEach(([k, v]) => (manualesCanon[normalizeKey(k)] = Number(v) || 0));
        if ((manualesCanon.clevis || 0) > 0)
          manualesCanon.hebillas = Math.max(manualesCanon.hebillas || 0, manualesCanon.clevis * 2);
        const matsTotales = sumDict(matAutoONT, manualesCanon);

        // Bobina de almacén a descontar
        const bobinaAlmacen =
          tipo === "Residencial" ? drumps.length * RES_BOBINA_METROS : Number(metrosCondominio) || 0;

        // ===== BATCH =====
        const batch = writeBatch(db);

        // 1) Descontar materiales del almacén
        const matsAlmacen = { ...matsTotales };
        if ((matsAlmacen.cinta_bandi || 0) > 0)
          matsAlmacen.cinta_bandi_metros = matsAlmacen.cinta_bandi * CINTA_BANDI_METROS;

        for (const [mat, cant] of Object.entries(matsAlmacen)) {
  const cantN = Number(cant) || 0;
  if (cantN <= 0) continue;

  const ref = doc(db, "materiales_stock", mat);
  const snap = await getDoc(ref);
  const actual = snap.exists() ? Number(snap.data().cantidad || 0) : 0;

  const newQty = Math.max(0, actual - cantN);
  // 🔔 marcar alerta si queda poco
  if (newQty <= STOCK_MIN_MATERIAL) {
    lowMaterials.push({ nombre: mat, restante: newQty });
  }

  batch.set(
    ref,
    {
      nombre: mat,
      cantidad: newQty,
      actualizadoPor: usuario,
      actualizadoEn: serverTimestamp(),
    },
    { merge: true }
  );
}


        // 2) Descontar bobina de almacén
        if (bobinaAlmacen > 0) {
          const refBob = doc(db, "materiales_stock", "bobina");
          const snap = await getDoc(refBob);
          const actual = snap.exists() ? Number(snap.data().cantidad || 0) : 0;
          batch.set(
            refBob,
            {
              nombre: "bobina",
              cantidad: Math.max(0, actual - bobinaAlmacen),
              actualizadoPor: usuario,
              actualizadoEn: serverTimestamp(),
            },
            { merge: true }
          );
        }

        // 3) Sumar materiales a cuadrilla
        for (const [mat, cant] of Object.entries(matsTotales)) {
          const cantN = Number(cant) || 0;
          if (cantN <= 0) continue;
          const ref = doc(db, `cuadrillas/${cuadrillaSel.id}/stock_materiales/${mat}`);
          const snap = await getDoc(ref);
          const actual = snap.exists() ? Number(snap.data().cantidad || 0) : 0;
          batch.set(
            ref,
            {
              nombre: mat,
              cantidad: actual + cantN,
              actualizadoPor: usuario,
              actualizadoEn: serverTimestamp(),
            },
            { merge: true }
          );
        }

        // 4) Bobina a cuadrilla
if (tipo === "Residencial" && drumps.length > 0) {
  for (const code of drumps) {
    // --- 4.1 Crear doc individual en stock_bobinas ---
    const bRef = doc(db, `cuadrillas/${cuadrillaSel.id}/stock_bobinas`, code);
    batch.set(bRef, {
      codigo: code,
      metros: RES_BOBINA_METROS,
      estado: "activo",
      f_ingreso: serverTimestamp(),
      guia_despacho: guiaId,
      usuario,
    });
  }

  // --- 4.2 Sumar metros al acumulado en stock_materiales/bobina ---
  const refBobinaCuad = doc(db, `cuadrillas/${cuadrillaSel.id}/stock_materiales/bobina`);
  const snapBobinaCuad = await getDoc(refBobinaCuad);
  const actual = snapBobinaCuad.exists() ? Number(snapBobinaCuad.data().cantidad || 0) : 0;

  const metrosTotales = drumps.length * RES_BOBINA_METROS;

  batch.set(
    refBobinaCuad,
    {
      nombre: "bobina",
      cantidad: actual + metrosTotales,
      actualizadoPor: usuario,
      actualizadoEn: serverTimestamp(),
    },
    { merge: true }
  );
}


        // 🔎 Calcula stock restante por tipo de equipo en almacén (post-despacho)
const porTipo = equipos.reduce((acc, e) => {
  const t = (e.equipo || "OTROS").toString();
  acc[t] = (acc[t] || 0) + 1;
  return acc;
}, {});

for (const [tipoEq, cantDesp] of Object.entries(porTipo)) {
  const qs = await getDocs(
    query(collection(db, "equipos"), where("equipo", "==", tipoEq), where("estado", "==", "almacen"))
  );
  const restante = Math.max(0, qs.size - Number(cantDesp || 0));
  if (restante <= STOCK_MIN_EQUIPO) {
    lowEquipTypes.push({ tipo: tipoEq, restante });
  }
}


        // 5) Equipos -> stock_equipos y estado global
        for (const e of equipos) {
          const refEqStock = doc(db, `cuadrillas/${cuadrillaSel.id}/stock_equipos/${e.SN}`);
          batch.set(refEqStock, {
            SN: e.SN,
            tipo: e.equipo || "-",
            descripcion: e.descripcion || "",
            f_despacho: serverTimestamp(),
            usuario_despacho: usuario,
            estado: "campo",
            guia_despacho: guiaId,          // 👈 NUEVO
          });

          const q = query(collection(db, "equipos"), where("SN", "==", e.SN));
          const qs = await getDocs(q);
          if (!qs.empty) {
            const docRef = qs.docs[0].ref;
            batch.set(
              docRef,
              {
                estado: "campo",
                ubicacion: cuadrillaSel.nombre,
                f_despacho: serverTimestamp(),
                usuario_despacho: usuario,
                tecnicos: cuadrillaSel.nombresTecnicos || [],
                guia_despacho: guiaId,        // 👈 NUEVO
              },
              { merge: true }
            );
          }
        }

        await batch.commit();

        // 6) Guardar guía
        const guiaDoc = {
          guiaId,
          fecha: new Date().toLocaleString("es-PE"),
          usuario,
          creadoPor: usuario,
          cuadrilla: cuadrillaSel.nombre || "",
          tipo: cuadrillaSel.r_c || "",
          zona: cuadrillaSel.zona || "",
          tecnicos: cuadrillaSel.nombresTecnicos || [],
          tecnicosUID: cuadrillaSel.tecnicos || [],
          equipos,
          materiales: { automaticos: matAutoONT, manuales: matManuales, drumps },
          metrosCondominio: tipo === "Condominio" ? bobinaAlmacen : 0,
          observacion: observacion || "Sin observaciones",
          creadoEn: serverTimestamp(),
        };
        await setDoc(doc(db, "guias_despacho", guiaId), guiaDoc);

        // 7) PDF
        const urlPDF = await generarPDFySubir({ guiaId, datos: guiaDoc });
        toast.success("📄 PDF generado");

        // 8) Notificación
        const totalMats = Object.values(sumDict(matAutoONT, matManuales)).reduce((a, b) => a + (Number(b) || 0), 0);
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Despacho",
          mensaje: `📦 ${usuario} realizó un despacho para "${cuadrillaSel.nombre}". Equipos: ${equipos.length}, Materiales: ${totalMats}, Bobina: ${
            tipo === "Residencial" ? drumps.length * RES_BOBINA_METROS : guiaDoc.metrosCondominio
          } m`,
          usuario,
          fecha: serverTimestamp(),
          guiaId,
          link: urlPDF,
          detalles: {
            cuadrilla: cuadrillaSel.nombre,
            tipo: cuadrillaSel.r_c,
            zona: cuadrillaSel.zona,
            equipos: equipos.map((e) => ({ SN: e.SN, tipo: e.equipo })),
            materiales: sumDict(matAutoONT, matManuales),
            drumps,
            metrosCondominio: guiaDoc.metrosCondominio,
          },
          visto: false,
        });


        // 🔔 Toasts de alerta en UI
if (lowMaterials.length > 0) {
  lowMaterials.forEach(m =>
    toast(`Stock bajo de "${m.nombre.replaceAll("_"," ")}": quedan ${m.restante}`, { icon: "⚠️" })
  );
}
if (lowEquipTypes.length > 0) {
  lowEquipTypes.forEach(t =>
    toast(`Quedan pocos equipos tipo "${t.tipo}": ${t.restante}`, { icon: "⚠️" })
  );
}

// 📨 Notificación de alertas (opcional, útil para dashboard)
if (lowMaterials.length > 0 || lowEquipTypes.length > 0) {
  await addDoc(collection(db, "notificaciones"), {
    tipo: "Alerta stock bajo",
    fecha: serverTimestamp(),
    usuario,
    guiaId,
    detalles: {
      materiales: lowMaterials,
      equipos_por_tipo: lowEquipTypes,
    },
    visto: false,
  });
}


        toast.success("✅ Despacho registrado", { id: toastId });
        setShowPreview(false);

        // Reset
        setEquipos([]);
        setMatAutoONT({});
        setMatManuales({
          actas: 0, conectores: 0, rosetas: 0, acopladores: 0, patchcord: 0, pachcord: 0,
          cintillos_30: 0, cintillos_10: 0, cintillos_bandera: 0, cinta_aislante: 0,
          templadores: 0, anclajes_tipo_p: 0, clevis: 0, hebillas: 0, cinta_bandi: 0, caja_grapas: 0,
        });
        setDrumps([]);
        setDrumpInput("");
        setMetrosCondominio(300);
        setObservacion("");
        setPaso(1);
        setBusqueda("");
        setCuadrillaSel(null);
      } catch (e) {
        console.error(e);
        toast.error("❌ Error al registrar el despacho", { id: toastId });
      } finally {
        setProcesando(false);
      }
    });

  /* =====================================================================
     UI
  ===================================================================== */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      {/* PASO 1 */}
      {paso === 1 && (
        <div className="max-w-3xl mx-auto space-y-5">
          <h1 className="text-2xl font-bold text-center">🚚 Despacho a cuadrillas</h1>

          <Card className="border shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex gap-2">
                <Input
                  list="cuadrillas-list"
                  placeholder="Escribe el nombre de la cuadrilla"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                  className="h-11"
                />
                <Button
                  onClick={handleBuscar}
                  disabled={loading || !busqueda}
                  className="h-11 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700"
                >
                  Buscar
                </Button>
                <datalist id="cuadrillas-list">
                  {cuadrillas.map((c) => (
                    <option key={c.id} value={c.nombre} />
                  ))}
                </datalist>
              </div>

              {cuadrillaSel && (
                <>
                  <Card className="bg-green-50 border-green-300">
                    <CardContent className="p-4">
                      <div className="grid sm:grid-cols-2 gap-2 text-sm">
                        <div><b>Nombre:</b> {cuadrillaSel.nombre}</div>
                        <div><b>Tipo:</b> {cuadrillaSel.r_c} — {cuadrillaSel.tipo}</div>
                        <div><b>Zona:</b> {cuadrillaSel.zona || "—"}</div>
                        <div className="sm:col-span-2"><b>Técnicos:</b> {(cuadrillaSel.nombresTecnicos || []).join(", ") || "No asignados"}</div>
                      </div>
                      <Button
                        className="mt-4 w-full h-11 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700"
                        size="lg"
                        onClick={handleContinuar}
                      >
                        Continuar al Paso 2
                      </Button>
                    </CardContent>
                  </Card>

                  <StockCuadrilla titulo="🔧 Stock de Equipos en Cuadrilla" items={stockEquipos} tipo="equipos" />
                  <StockCuadrilla titulo="📦 Stock de Materiales en Cuadrilla" items={stockMateriales} tipo="materiales" />

                  {cuadrillaSel?.r_c === "Residencial" && bobinasActivas.length > 0 && (
                    <div className="border p-3 rounded-2xl bg-white shadow-sm">
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
                            <td className="p-2 text-right">{fmt(bobinasActivas.reduce((t, b) => t + (b.metros || 0), 0))} m</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* PASO 2 */}
      {paso === 2 && (
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              className="rounded-2xl h-10"
              onClick={() => { setPaso(1); toast.success("🔄 Regresaste al Paso 1"); }}
            >
              ⬅️ Paso 1
            </Button>
            {cuadrillaSel && (
              <Card className="bg-green-50 border-green-300">
                <CardContent className="p-3 text-center text-sm">
                  <div><b>Cuadrilla:</b> {cuadrillaSel.nombre}</div>
                  <div><b>Técnicos:</b> {(cuadrillaSel.nombresTecnicos || []).join(", ") || "—"}</div>
                </CardContent>
              </Card>
            )}
          </div>

          <h2 className="text-xl font-bold text-center">Paso 2: Escanear equipos</h2>

          <div className="flex items-center gap-3">
            <Input
              placeholder="Escanea o ingresa el SN"
              value={snInput}
              onChange={(e) => setSnInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleAgregarSN()}
              className="h-11"
            />
            <Button
              onClick={handleAgregarSN}
              className="h-11 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700"
            >
              Agregar
            </Button>
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">📋 Equipos escaneados ({equipos.length})</h3>
                {equipos.length > 0 && <span className="text-sm text-gray-600">{resumenEquipos}</span>}
              </div>

              {equipos.length === 0 ? (
                <p className="text-sm text-gray-500 mt-2">Aún no hay equipos.</p>
              ) : (
                <div className="overflow-x-auto mt-3">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left">SN</th>
                        <th className="px-3 py-2 text-left">Equipo</th>
                        <th className="px-3 py-2 text-left">Descripción</th>
                        <th className="px-3 py-2 text-left">F. Ingreso</th>
                        <th className="px-3 py-2 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {equipos.map((e) => (
                        <tr key={e.SN} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{e.SN}</td>
                          <td className="px-3 py-2">{e.equipo}</td>
                          <td className="px-3 py-2">{e.descripcion}</td>
                          <td className="px-3 py-2">{e.f_ingreso}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => eliminarSN(e.SN)}
                              className="text-red-600 hover:underline"
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

              {/* DRUMP (Residencial) */}
              {tipo === "Residencial" && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-2">🧵 Bobinas DRUMP (1000 m c/u)</h4>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Código DRUMP"
                      value={drumpInput}
                      onChange={(e) => setDrumpInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleAgregarDRUMP()}
                      className="max-w-xs h-11"
                    />
                    <Button
                      onClick={handleAgregarDRUMP}
                      className="h-11 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700"
                    >
                      Agregar
                    </Button>
                  </div>
                  {drumps.length > 0 && (
                    <div className="mt-2">
                      <ul className="list-disc pl-5 text-sm">
                        {drumps.map((d) => (
                          <li key={d} className="flex justify-between max-w-md">
                            {d}
                            <button
                              onClick={() => eliminarDRUMP(d)}
                              className="text-red-600 text-xs hover:underline"
                            >
                              Eliminar
                            </button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-sm mt-1">Total: <b>{drumps.length * RES_BOBINA_METROS}</b> m</p>
                    </div>
                  )}
                </div>
              )}

              {/* Metros (Condominio) */}
              {tipo === "Condominio" && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-2">🧵 Bobina (Condominio)</h4>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">Metros a entregar:</label>
                    <Input
                      type="number"
                      min={0}
                      max={2000}
                      value={metrosCondominio}
                      onChange={(e) =>
                        setMetrosCondominio(Number((e.target.value || "").replace(/\D/g, "")) || 0)
                      }
                      className="max-w-[120px] text-right h-11
                        [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-gray-500">Sugerido: 300–400 m</span>
                  </div>
                </div>
              )}

              {/* Materiales manuales — INPUTS simples */}
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg text-indigo-400">✚</span>
                  <h4 className="font-semibold">Materiales adicionales (manuales)</h4>
                </div>

                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Object.entries(matManuales).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <label className="text-sm capitalize">{k.replaceAll("_", " ")}:</label>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={v ?? 0}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, "");
                          setMatManuales((prev) => ({ ...prev, [k]: raw === "" ? 0 : Number(raw) }));
                        }}
                        className="w-20 text-right bg-white border border-slate-300 rounded-xl px-2 py-1.5
                          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                          focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>

                {Object.keys(matAutoONT).length > 0 && (
                  <div className="mt-5 bg-slate-50 border rounded-2xl p-3">
                    <h5 className="font-semibold mb-1">📦 Automáticos por ONT</h5>
                    <ul className="list-disc pl-5 text-sm">
                      {Object.entries(matAutoONT).map(([k, c]) => (
                        <li key={k}>{k.replaceAll("_", " ")}: <b>{c}</b></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Observaciones */}
              <div className="mt-6">
                <label className="block text-sm font-semibold mb-1">📝 Observaciones</label>
                <textarea
                  rows={3}
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  className="w-full border rounded-2xl p-3"
                  placeholder="Opcional"
                />
              </div>

              {/* PREVIEW */}
              <div className="mt-6">
                <Button
                  className="w-full h-11 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-indigo-500 to-blue-500 text-white font-semibold shadow
                             hover:opacity-95"
                  onClick={abrirPreview}
                  disabled={procesando}
                >
                  {procesando ? "Validando..." : "👀 Previsualizar y Confirmar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* MODAL PREVIEW */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Resumen de despacho</h3>
              <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="p-5 grid gap-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-2">
                <div><b>Guía:</b> se genera al confirmar</div>
                <div><b>Fecha:</b> {new Date().toLocaleString("es-PE")}</div>
                <div><b>Cuadrilla:</b> {cuadrillaSel?.nombre}</div>
                <div><b>Tipo:</b> {tipo}</div>
                <div className="sm:col-span-2"><b>Técnicos:</b> {(cuadrillaSel?.nombresTecnicos || []).join(", ") || "—"}</div>
              </div>

              <div className="border rounded-2xl p-3">
                <b>Equipos ({equipos.length}):</b>
                {equipos.length === 0 ? (
                  <div className="text-gray-500">—</div>
                ) : (
                  <ul className="list-disc pl-5 mt-1">
                    {equipos.map((e) => (
                      <li key={e.SN}>{e.SN} — {e.equipo}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="border rounded-2xl p-3">
                  <b>Materiales automáticos (ONT)</b>
                  {Object.keys(matAutoONT).length === 0 ? (
                    <div className="text-gray-500">—</div>
                  ) : (
                    <ul className="list-disc pl-5 mt-1">
                      {Object.entries(matAutoONT).map(([k, c]) => (
                        <li key={k}>{k.replaceAll("_", " ")}: {c}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="border rounded-2xl p-3">
                  <b>Materiales manuales</b>
                  {Object.values(matManuales).every((v) => (Number(v) || 0) === 0) ? (
                    <div className="text-gray-500">—</div>
                  ) : (
                    <ul className="list-disc pl-5 mt-1">
                      {Object.entries(matManuales).map(([k, v]) =>
                        (Number(v) || 0) > 0 && <li key={k}>{k.replaceAll("_", " ")}: {v}</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>

              {tipo === "Residencial" && (
                <div className="border rounded-2xl p-3">
                  <b>DRUMPs</b>
                  {drumps.length === 0 ? (
                    <div className="text-gray-500">—</div>
                  ) : (
                    <>
                      <ul className="list-disc pl-5 mt-1">{drumps.map((d) => <li key={d}>{d}</li>)}</ul>
                      <div className="mt-1"><b>Total metros:</b> {drumps.length * RES_BOBINA_METROS}</div>
                    </>
                  )}
                </div>
              )}

              {tipo === "Condominio" && (
                <div className="border rounded-2xl p-3">
                  <b>Bobina (metros)</b>
                  <div>{Number(metrosCondominio) || 0}</div>
                </div>
              )}

              <div className="border rounded-2xl p-3">
                <b>Observaciones:</b>
                <div>{observacion || "Sin observaciones"}</div>
              </div>
            </div>

            <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                className="rounded-2xl h-10"
                onClick={() => setShowPreview(false)}
              >
                Cancelar
              </Button>
              <Button
                className="rounded-2xl h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={confirmarDespacho}
                disabled={procesando}
              >
                {procesando ? "Registrando..." : "Confirmar y Registrar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
