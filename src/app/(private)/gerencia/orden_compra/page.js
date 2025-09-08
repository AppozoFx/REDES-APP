"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { useAuth } from "@/app/context/AuthContext";
import {
  collection,
  addDoc,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
} from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import toast from "react-hot-toast";

/* ========= Ítems y precios por defecto ========= */
const DESCRIPCIONES = {
  "001": { desc: "INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN RESIDENCIALES", precio: 120 },
  "002": { desc: "INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN CONDOMINIOS", precio: 80 },
  "003": { desc: "CABLEADO UTP CAT 5E COLOR PLOMO", precio: 40 },
  "004": { desc: "CABLEADO UTP CAT 6 COLOR BLANCO", precio: 55 },
};

/* ===== Helpers de fechas ===== */
const isTimestamp = (v) => v && typeof v === "object" && "seconds" in v && "nanoseconds" in v;
const normalizeDate = (v) => {
  if (!v) return "";
  if (isTimestamp(v)) return new Date(v.seconds * 1000).toISOString().slice(0, 10);
  if (typeof v === "string") {
    const maybeIso = v.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (maybeIso) return maybeIso;
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return "";
};

/* ===== Clasificadores ===== */
const isResidencial = (inst) =>
  String(inst?.residencialCondominio || inst?.r_c || inst?.tipo || "")
    .toLowerCase()
    .includes("resid");

const isCondominio = (inst) =>
  String(inst?.residencialCondominio || inst?.r_c || inst?.tipo || "")
    .toLowerCase()
    .includes("condo");

/* ===== Detección/cantidad CAT5e & CAT6 (suma cantidades reales) ===== */
const qtyCat5e = (inst) => {
  const txt = String(inst?.utp_cat || inst?.cableUTP || inst?.material || inst?.servicioCableadoMesh || "")
    .toLowerCase();
  const num = Number(inst?.cat5e);
  if (!isNaN(num) && num > 0) return num;
  if (txt.includes("5e") || /cat ?5e/.test(txt)) return 1;
  return 0;
};
const qtyCat6 = (inst) => {
  const txt = String(inst?.utp_cat || inst?.cableUTP || inst?.material || inst?.servicioCableadoMesh || "")
    .toLowerCase();
  const num = Number(inst?.cat6);
  if (!isNaN(num) && num > 0) return num;
  if (/\b6\b/.test(txt) || /cat ?6/.test(txt)) return 1;
  return 0;
};

export default function OrdenCompraPage() {
  const { userData } = useAuth();
  const fechaOrdenCompra = new Date().toLocaleDateString("es-PE");

  /* ======= Estado ======= */
  const [coordinadores, setCoordinadores] = useState([]);
  const [coordSel, setCoordSel] = useState(""); // UID

  const [periodo, setPeriodo] = useState({
    desde: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    hasta: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
  });

  const [items, setItems] = useState([]);
  const [editableTotal, setEditableTotal] = useState(0);
  const [porcentaje, setPorcentaje] = useState(0);

  const [form, setForm] = useState({
    razon: "",
    ruc: "",
    direccion: "CA. JUAN PRADO DE ZELA MZ,F2 LT.3 -SMP",
    atencion: "DNIEPER MAYTA - m.mayta@redesm",
    lugar: "REDES M&D S.A.C",
    tipooc: "SERVICIOS",
    fEntrega: "",
    condicionEntrega: "",
    cantidadEntrega: "",
    observacionEntrega: "",
    diasPago: "",
  });

  const [guardado, setGuardado] = useState(false);
  const [puedeNuevaOrden, setPuedeNuevaOrden] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  /* ======= Preview / compartir ======= */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [previewPath, setPreviewPath] = useState(""); // para borrar luego
  const [contact, setContact] = useState({ email: "", phone: "" });
  const previewBlobRef = useRef(null);

  /* ======= Siguiente código de OC (solo visual) ======= */
  const [nextOrderCode, setNextOrderCode] = useState("");

  /* ======= Tabla de resumen por cuadrilla ======= */
  const [cuadrillasResumen, setCuadrillasResumen] = useState([]); // [{cuadrilla, resid, condo, cat5e, cat6}]

  /* ======= Totales ======= */
  const subtotal = useMemo(() => items.reduce((acc, it) => acc + (Number(it.total) || 0), 0), [items]);
  const igv = useMemo(() => subtotal * 0.18, [subtotal]);
  const total = useMemo(() => subtotal + igv, [subtotal, igv]);

  useEffect(() => {
    setEditableTotal(total);
    setPorcentaje(total > 0 ? 100 : 0);
  }, [total]);

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setForm((prev) => ({ ...prev, [id]: value }));
    setGuardado(false);
  };

  const agregarItemManual = () =>
    setItems((prev) => [...prev, { cantidad: 0, codigo: "", descripcion: "", precio: 0, total: 0 }]);

  const actualizarItem = (index, campo, valor) => {
    const nuevos = [...items];
    if (campo === "codigo" && DESCRIPCIONES[valor]) {
      nuevos[index].descripcion = DESCRIPCIONES[valor].desc;
      nuevos[index].precio = DESCRIPCIONES[valor].precio;
    }
    nuevos[index][campo] = valor;
    const cantidad = Number(nuevos[index].cantidad) || 0;
    const precio = Number(nuevos[index].precio) || 0;
    nuevos[index].total = cantidad * precio;
    setItems(nuevos);
    setGuardado(false);
  };

  const eliminarItem = (index) => setItems((prev) => prev.filter((_, i) => i !== index));

  /* ======= Cargar coordinadores y el “siguiente código” ======= */
  useEffect(() => {
    (async () => {
      try {
        const qRef = query(collection(db, "usuarios"), where("rol", "array-contains", "Coordinador"));
        const snap = await getDocs(qRef);
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCoordinadores(data);
      } catch {
        toast.error("No se pudieron cargar los coordinadores");
      }
      try {
        const cRef = doc(db, "counters", "ordenes_compra");
        const cSnap = await getDoc(cRef);
        const current = cSnap.exists() ? cSnap.data().count || 0 : 0;
        const next = current + 1;
        setNextOrderCode(`OC-${new Date().getFullYear()}-${String(next).padStart(10, "0")}`);
      } catch {
        setNextOrderCode("(no disponible)");
      }
    })();
  }, []);

  /* ======= Autorrellenar RS/RUC y contacto ======= */
  useEffect(() => {
    if (!coordSel) return;
    const c = coordinadores.find((x) => x.id === coordSel);
    if (c) {
      setForm((prev) => ({
        ...prev,
        razon: c.razon_social || prev.razon,
        ruc: c.ruc || prev.ruc,
      }));
      setContact({
        email: c.email || "",
        phone: (c.celular || "").replace(/\D/g, ""),
      });
    }
  }, [coordSel, coordinadores]);

  /* ======= Cargar ítems + resumen por cuadrilla desde período ======= */
  const cargarDesdePeriodo = async () => {
    if (!coordSel) return toast.error("Selecciona un coordinador");

    const toastId = toast.loading("Cargando instalaciones del período…");
    try {
      const snap = await getDocs(collection(db, "liquidacion_instalaciones"));
      let lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Filtrar por coordinador UID exacto
      lista = lista.filter(
        (ins) => String(ins.coordinadorCuadrilla || "").toLowerCase() === String(coordSel).toLowerCase()
      );

      // Filtrar por fecha
      const { desde, hasta } = periodo;
      lista = lista.filter((ins) => {
        const f = normalizeDate(ins.fechaInstalacion) || normalizeDate(ins.fechaLiquidacion);
        return f && f >= desde && f <= hasta;
      });

      // ===== Resumen por cuadrilla (sumando cat5e/cat6) =====
      const group = new Map();
      for (const ins of lista) {
        const cuadrilla = String(ins.cuadrillaNombre || ins.cuadrilla || "-").trim() || "-";
        const entry = group.get(cuadrilla) || { cuadrilla, resid: 0, condo: 0, cat5e: 0, cat6: 0 };
        if (isResidencial(ins)) entry.resid += 1;
        if (isCondominio(ins)) entry.condo += 1;
        entry.cat5e += qtyCat5e(ins);
        entry.cat6 += qtyCat6(ins);
        group.set(cuadrilla, entry);
      }
      setCuadrillasResumen(
        Array.from(group.values()).sort((a, b) => a.cuadrilla.localeCompare(b.cuadrilla))
      );

      // ===== Totales para los ítems =====
      const resid = lista.filter(isResidencial).length;
      const condo = lista.filter(isCondominio).length;
      const cat5e = lista.reduce((s, ins) => s + qtyCat5e(ins), 0);
      const cat6 = lista.reduce((s, ins) => s + qtyCat6(ins), 0);

      const nuevos = [
        {
          codigo: "001",
          descripcion: DESCRIPCIONES["001"].desc,
          cantidad: resid,
          precio: DESCRIPCIONES["001"].precio,
          total: resid * DESCRIPCIONES["001"].precio,
        },
        {
          codigo: "002",
          descripcion: DESCRIPCIONES["002"].desc,
          cantidad: condo,
          precio: DESCRIPCIONES["002"].precio,
          total: condo * DESCRIPCIONES["002"].precio,
        },
        {
          codigo: "003",
          descripcion: DESCRIPCIONES["003"].desc,
          cantidad: cat5e,
          precio: DESCRIPCIONES["003"].precio,
          total: cat5e * DESCRIPCIONES["003"].precio,
        },
        {
          codigo: "004",
          descripcion: DESCRIPCIONES["004"].desc,
          cantidad: cat6,
          precio: DESCRIPCIONES["004"].precio,
          total: cat6 * DESCRIPCIONES["004"].precio,
        },
      ];
      setItems(nuevos);
      setGuardado(false);

      toast.success("Ítems y resumen por cuadrilla actualizados");
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron cargar las instalaciones");
    } finally {
      toast.dismiss(toastId);
    }
  };

  /* ======= Generación de PDF (plantilla mejorada, sin firmas ni barras) ======= */
  const numeroALetras = (num) => {
    const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
    const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
    const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS"];
    if (num === 100) return "CIEN";
    let words = "";
    if (num >= 1000) { const miles = Math.floor(num / 1000); words += (miles === 1 ? "MIL " : numeroALetras(miles) + " MIL "); num %= 1000; }
    if (num >= 100) { const c = Math.floor(num / 100); words += centenas[c] + " "; num %= 100; }
    if (num >= 20) { const d = Math.floor(num / 10); words += decenas[d]; const u = num % 10; if (u > 0) words += (d === 2 ? "I" + unidades[u] : " Y " + unidades[u]) + " "; }
    else if (num >= 10) { words += especiales[num - 10] + " "; }
    else if (num > 0) { words += unidades[num] + " "; }
    return words.trim();
  };

  const generarPDF = async (codigoOC) => {
    // --- Paleta / medidas ---
    const BRAND = { primary: [15, 76, 129], light: [240, 246, 255], gray: [90, 102, 121] };
    const M = 16; // margen exterior
    const docPDF = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const W = docPDF.internal.pageSize.getWidth();
    const H = docPDF.internal.pageSize.getHeight();

    // --- Logo y encabezado ---
    const logo = new Image();
    logo.src = "/image/logo.png";
    await new Promise((resolve) => (logo.onload = resolve));

    // Franja superior
    docPDF.setFillColor(...BRAND.primary);
    docPDF.rect(0, 0, W, 65, "F");

    // Logo proporcional (ajusta LOGO_H para cambiar altura sin deformar)
    const LOGO_H = 45; // <--- AJUSTA ALTURA AQUÍ
    const logoRatio = logo.width / logo.height || 3;
    const LOGO_W = LOGO_H * logoRatio;
    docPDF.addImage(logo, "PNG", M, 13, LOGO_W, LOGO_H);

    // Marca y RUC
    docPDF.setTextColor(255);
    docPDF.setFont("helvetica", "bold");
    docPDF.setFontSize(15);
    docPDF.text("REDES M&D S.A.C", M + LOGO_W + 10, 28);
    docPDF.setFont("helvetica", "normal");
    docPDF.setFontSize(10);
    docPDF.text("RUC 20601345979  ·  Lima - Perú", M + LOGO_W + 10, 46);

    // Caja "ORDEN DE COMPRA"
    const OC_W = 250;
    const OC_H = 50;
    const OC_X = W - M - OC_W;
    const OC_Y = 8; 

    docPDF.setDrawColor(255);
    docPDF.setFillColor(255);
    docPDF.roundedRect(OC_X, OC_Y, OC_W, OC_H, 12, 12, "FD");

    docPDF.setTextColor(20);
    docPDF.setFont("helvetica", "bold");
    docPDF.setFontSize(12);
    docPDF.text("ORDEN DE COMPRA", OC_X + OC_W / 2, OC_Y + 23, { align: "center" });

    docPDF.setFont("helvetica", "normal");
    docPDF.setFontSize(11);
    docPDF.text(String(codigoOC || ""), OC_X + OC_W / 2, OC_Y + 43, { align: "center" });

    // --- Fechas y proveedor (cards superiores) ---
    const fechaOC = new Date().toLocaleDateString("es-PE");
    const fechaEntregaTxt = form.fEntrega
      ? new Date(form.fEntrega + "T00:00:00").toLocaleDateString("es-PE")
      : "-";

    const cardH = 60;

    const boxedTitle = (x, y, w, h, title) => {
      docPDF.setDrawColor(220);
      docPDF.setFillColor(...BRAND.light);
      docPDF.roundedRect(x, y, w, h, 8, 8, "FD");
      docPDF.setFont("helvetica", "bold");
      docPDF.setFontSize(10);
      docPDF.setTextColor(60);
      docPDF.text(title, x + 10, y + 16);
      docPDF.setFont("helvetica", "normal");
      docPDF.setFontSize(10);
      docPDF.setTextColor(20);
    };

    const L1_X = M;
    const L1_W = 190;
    const R1_X = L1_X + L1_W + 10;
    const R1_W = W - M - R1_X;

    boxedTitle(L1_X, 76, L1_W, cardH, "Fechas");
    docPDF.text(`Emisión: ${fechaOC}`, L1_X + 10, 76 + 34);
    docPDF.text(`Entrega: ${fechaEntregaTxt}`, L1_X + 10, 76 + 50);

    boxedTitle(R1_X, 76, R1_W, cardH, "Proveedor");
    docPDF.text(`Razón Social: ${form.razon || ""}`, R1_X + 10, 76 + 34);
    docPDF.text(`RUC: ${form.ruc || ""}`, R1_X + 10, 76 + 50);

    // --- Bloque de detalles (dirección/atención/entrega/tipo) ---
    const yInfo = 76 + cardH + 12;
    boxedTitle(M, yInfo, W - 2 * M, 86, "Detalles");

    const wrap = (txt, width) => docPDF.splitTextToSize(String(txt || ""), width);

    docPDF.text("Dirección:", M + 10, yInfo + 30);
    docPDF.text(wrap(form.direccion, W - 2 * M - 90), M + 90, yInfo + 30);

    docPDF.text("Atención:", M + 10, yInfo + 50);
    docPDF.text(String(form.atencion || ""), M + 90, yInfo + 50);

    docPDF.text("Lugar Entrega:", M + 10, yInfo + 70);
    docPDF.text(String(form.lugar || ""), M + 90, yInfo + 70);

    docPDF.text("Tipo OC:", W / 2 + 40, yInfo + 70);
    docPDF.text(String(form.tipooc || ""), W / 2 + 100, yInfo + 70);

    // --- Tabla de items ---
    const startTableY = yInfo + 100;
    const formatMoney = (v) => `S/ ${(Number(v || 0)).toFixed(2)}`;
    const safeItems = Array.isArray(items) ? items.filter((it) => it.cantidad && it.codigo) : [];

    autoTable(docPDF, {
      startY: startTableY,
      margin: { left: M, right: M },
      head: [["ITEM", "CANT.", "CÓDIGO", "DESCRIPCIÓN", "PRECIO U.", "TOTAL"]],
      body: safeItems.length
        ? safeItems.map((it, i) => [
            i + 1,
            it.cantidad,
            it.codigo,
            it.descripcion,
            formatMoney(it.precio),
            formatMoney(it.total),
          ])
        : [["-", "-", "-", "SIN ITEMS", "-", "-"]],
      styles: {
        fontSize: 9,
        cellPadding: 6,
        lineColor: [210, 215, 225],
        lineWidth: 0.4,
        valign: "middle",
      },
      headStyles: {
        fillColor: BRAND.primary,
        textColor: 255,
        fontStyle: "bold",
        halign: "center",
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 45 },
        1: { halign: "center", cellWidth: 60 },
        2: { halign: "center", cellWidth: 70 },
        3: { halign: "left" },
        4: { halign: "right", cellWidth: 90 },
        5: { halign: "right", cellWidth: 90 },
      },
      alternateRowStyles: { fillColor: [248, 250, 253] },
      didDrawPage: () => {
        const str = `Página ${docPDF.internal.getNumberOfPages()}`;
        docPDF.setFont("helvetica", "normal");
        docPDF.setFontSize(9);
        docPDF.setTextColor(...BRAND.gray);
        docPDF.text(str, W - M, H - 10, { align: "right" });
      },
    });


    // Después de la tabla de ítems
const finalY = docPDF.lastAutoTable ? docPDF.lastAutoTable.finalY : 100;
    


   // --- Resumen a la derecha + "SON:" centrado ---
const lastY = docPDF.lastAutoTable?.finalY || startTableY;
const cardW = 230;
const cardH2 = 84;
const cardX = W - M - cardW;
const cardY = lastY + 12;

// Card resumen
docPDF.setDrawColor(220);
docPDF.setFillColor(255);
docPDF.roundedRect(cardX, cardY, cardW, cardH2, 8, 8, "FD");
docPDF.setFont("helvetica", "bold");
docPDF.setFontSize(10);
docPDF.setTextColor(45);
docPDF.text("Resumen", cardX + 10, cardY + 18);

docPDF.setFont("helvetica", "normal");
docPDF.setFontSize(10);
docPDF.text(`Subtotal: ${formatMoney(subtotal)}`, cardX + 10, cardY + 38);
docPDF.text(`IGV (18%): ${formatMoney(igv)}`, cardX + 10, cardY + 54);
docPDF.setFont("helvetica", "bold");
docPDF.text(`TOTAL: ${formatMoney(total)}`, cardX + 10, cardY + 72);

// Total en letras (siempre coherente con tabla)
const subCalc = safeItems.reduce((a, b) => a + (Number(b.total) || 0), 0);
const igvCalc = subCalc * 0.18;
const totCalc = subCalc + igvCalc;
const entero = Number.isFinite(totCalc) ? Math.floor(totCalc) : 0;
const dec = Number.isFinite(totCalc) ? Math.round((totCalc - entero) * 100) : 0;
const enLetras = numeroALetras(entero) || "CERO";
const textoFinal = `SON: ${enLetras} CON ${(dec < 10 ? "0" + dec : dec)}/100 SOLES`;

// Centrado justo debajo del Resumen
const sonY = cardY + cardH2 + 12;
docPDF.setFont("helvetica", "normal");
docPDF.setTextColor(60);
docPDF.text(textoFinal, W / 2, sonY, { align: "center" });

/* =========================
   CONDICIONES DE PAGO
   ========================= */
// Aseguramos iniciar DESPUÉS del Resumen
const startPayY = Math.max(cardY + cardH2, lastY) + 18;

const diasPago = form.diasPago?.trim() ? form.diasPago : "60";
const porcentajePago =
  editableTotal > 0 && total > 0 ? ((editableTotal / total) * 100).toFixed(0) + "%" : "100%";

autoTable(docPDF, {
  startY: startPayY,
  margin: { left: M, right: M },
  head: [
    [{ content: "CONDICIONES DE PAGO", colSpan: 4, styles: { halign: "center" } }],
    ["MEDIO", "CONDICIÓN", "Total a Pagar", "DÍAS"],
  ],
  body: [["01 FACTURA", "CE - CONTRA ENTREGA", porcentajePago, diasPago]],
  theme: "grid",
  styles: { fontSize: 9, lineColor: [210, 215, 225], lineWidth: 0.4 },
  headStyles: { fillColor: [236, 244, 255], textColor: 30, fontStyle: "bold" },
});

/* =========================
   CONDICIONES DE ENTREGA
   ========================= */
const condicionEntrega =
  form.condicionEntrega && form.condicionEntrega.trim() !== "" ? form.condicionEntrega : "NINGUNA";
const cantidadEntrega =
  form.cantidadEntrega && String(form.cantidadEntrega).trim() !== "" ? form.cantidadEntrega : "-";
const fechaEntregaTexto = form.fEntrega
  ? new Date(form.fEntrega + "T00:00:00").toLocaleDateString("es-PE")
  : "-";
const observacionEntrega =
  form.observacionEntrega && form.observacionEntrega.trim() !== ""
    ? form.observacionEntrega
    : "SIN OBSERVACIONES";

// Segunda tabla: arrancamos debajo de la anterior
const startDeliveryY = (docPDF.lastAutoTable?.finalY || startPayY) + 10;
autoTable(docPDF, {
  startY: startDeliveryY,
  margin: { left: M, right: M },
  head: [
    [{ content: "CONDICIONES DE ENTREGA", colSpan: 4, styles: { halign: "center" } }],
    ["CONDICIÓN", "CANTIDAD", "FECHA", "OBSERVACIÓN"],
  ],
  body: [[condicionEntrega, cantidadEntrega, fechaEntregaTexto, observacionEntrega]],
  theme: "grid",
  styles: { fontSize: 9, lineColor: [210, 215, 225], lineWidth: 0.4 },
  headStyles: { fillColor: [236, 244, 255], textColor: 30, fontStyle: "bold" },
});



    // --- Footer legal ---
    const footer = [
      "NOTA: La presente orden de compra está sujeta a los términos y condiciones acordados.",
      "Cualquier modificación o anulación deberá comunicarse por los canales autorizados.",
      "Redes M&D no se responsabiliza por demoras derivadas de causas ajenas a su control.",
    ];
    docPDF.setFontSize(8);
    docPDF.setTextColor(...BRAND.gray);
    docPDF.text(footer, W / 2, H - 26, { align: "center" });

    return docPDF;
  };

  /* ======= PREVIEW ======= */
  const abrirPreview = async () => {
    try {
      const codigoTemporal = nextOrderCode || `OC-PREVIEW-${Date.now()}`;
      const pdf = await generarPDF(codigoTemporal);
      const blob = pdf.output("blob");
      previewBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShareUrl("");
      setPreviewPath("");
      setPreviewOpen(true);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar la previsualización");
    }
  };

  const crearEnlaceCompartir = async () => {
    if (!previewBlobRef.current) return toast.error("Primero genera la previsualización");
    const toastId = toast.loading("Subiendo PDF de previsualización…");
    try {
      const storage = getStorage();
      const codigoTemp = `OC-PREVIEW-${Date.now()}`;
      const path = `ordenes_compra/previews/${codigoTemp}.pdf`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, previewBlobRef.current);
      const url = await getDownloadURL(ref);
      setShareUrl(url);
      setPreviewPath(path);
      toast.success("Enlace de previsualización listo");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo crear el enlace para compartir");
    } finally {
      toast.dismiss(toastId);
    }
  };

  const copiarEnlace = async () => {
    if (!shareUrl) return toast.error("Crea el enlace primero");
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Enlace copiado");
  };

  const linkWhatsApp = () => {
    const phone = (contact.phone || "").replace(/\D/g, "");
    if (!phone) return "#";
    const msg = `Hola, te comparto la Orden de Compra.\n${shareUrl || "(genera el enlace arriba)"}\n\nGracias.`;
    return `https://wa.me/51${phone}?text=${encodeURIComponent(msg)}`;
  };

  const linkMailto = () => {
    const subject = "Orden de Compra - Redes M&D";
    const body = `Hola,\n\nTe comparto la Orden de Compra.\n${shareUrl || "(genera el enlace arriba)"}\n\nSaludos.`;
    return `mailto:${encodeURIComponent(contact.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  /* ======= Guardado final ======= */
  const generarCodigoOC = async () => {
    const refCounter = doc(db, "counters", "ordenes_compra");
    const codigo = await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(refCounter);
      const data = docSnap.exists() ? docSnap.data() : { count: 0 };
      const nuevoCount = (data.count || 0) + 1;
      transaction.set(refCounter, { count: nuevoCount });
      return `OC-${new Date().getFullYear()}-${String(nuevoCount).padStart(10, "0")}`;
    });
    return codigo;
  };

  async function guardarOrdenYSubirPDF(
    codigoOC,
    docPDF,
    form,
    items,
    subtotal,
    igv,
    total,
    userData,
    isUpdate = false,
    docId = null
  ) {
    const storage = getStorage();
    const dbRef = collection(db, "ordenes_compra");
    const path = `ordenes_compra/${codigoOC}.pdf`;
    const pdfBlob = docPDF.output("blob");
    const ref = storageRef(storage, path);
    await uploadBytes(ref, pdfBlob);
    const downloadURL = await getDownloadURL(ref);

    const datos = {
      codigo: codigoOC,
      proveedor: { ...form },
      items,
      subtotal,
      igv,
      total,
      pdfUrl: downloadURL,
      actualizadoPor: `${userData?.nombres} ${userData?.apellidos}`,
      actualizadoEn: serverTimestamp(),
    };

    if (isUpdate && docId) {
      await updateDoc(doc(db, "ordenes_compra", docId), datos);
    } else {
      datos.creadoPor = `${userData?.nombres} ${userData?.apellidos}`;
      datos.creadoEn = serverTimestamp();
      await addDoc(dbRef, datos);
    }
    return downloadURL;
  }

  const registrarOrden = async () => {
    const toastId = toast.loading("⏳ Generando y guardando la orden…");
    try {
      setIsLoading(true);
      setGuardado(false);
      setPuedeNuevaOrden(false);

      const codigo = await generarCodigoOC();
      const docPDF = await generarPDF(codigo);

      const pdfUrl = await guardarOrdenYSubirPDF(
        codigo,
        docPDF,
        form,
        items,
        subtotal,
        igv,
        total,
        userData
      );

      if (previewPath) {
        try {
          await deleteObject(storageRef(getStorage(), previewPath));
        } catch (e) {
          console.warn("No se pudo borrar el preview:", e?.message || e);
        }
      }

      toast.dismiss(toastId);
      toast.success(`✅ Orden registrada (${codigo}) y PDF subido`);
      console.log("PDF URL:", pdfUrl);

      setGuardado(true);
      setPuedeNuevaOrden(true);
      docPDF.save(`${codigo}.pdf`);

      // actualizar el “siguiente número”
      try {
        const cRef = doc(db, "counters", "ordenes_compra");
        const cSnap = await getDoc(cRef);
        const current = cSnap.exists() ? cSnap.data().count || 0 : 0;
        setNextOrderCode(`OC-${new Date().getFullYear()}-${String(current + 1).padStart(10, "0")}`);
      } catch {}
    } catch (error) {
      toast.dismiss(toastId);
      toast.error("❌ Error al registrar la orden");
      console.error(error);
      setGuardado(false);
      setPuedeNuevaOrden(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (!userData?.rol?.includes("Gerencia"))
    return <p className="text-center text-red-500 font-bold">Acceso denegado</p>;

  const coord = coordinadores.find((c) => c.id === coordSel);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <HeaderSection
        title="Orden de Compra"
        subtitle="Generación y control para Gerencia"
        nextCode={nextOrderCode}
      />

      {/* Filtros */}
      <div className="rounded-2xl bg-white shadow border p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Coordinador</Label>
            <select
              className="w-full border px-3 py-2 rounded"
              value={coordSel}
              onChange={(e) => setCoordSel(e.target.value)}
            >
              <option value="">— Selecciona —</option>
              {coordinadores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombres} {c.apellidos} — {c.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Desde</Label>
            <input
              type="date"
              className="w-full border px-3 py-2 rounded"
              value={periodo.desde}
              onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))}
            />
          </div>
          <div>
            <Label>Hasta</Label>
            <input
              type="date"
              className="w-full border px-3 py-2 rounded"
              value={periodo.hasta}
              onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button primary onClick={cargarDesdePeriodo}>
            Cargar desde período
          </Button>
          <Button onClick={agregarItemManual}>Agregar Ítem manual</Button>
          <Button accent onClick={abrirPreview}>
            Vista previa PDF
          </Button>
        </div>
      </div>

      {/* Contexto */}
      <div className="rounded-2xl border bg-white shadow p-5">
        <p className="text-xs uppercase tracking-wider text-gray-500">Contexto</p>
        <h3 className="mt-1 text-lg font-semibold text-gray-900">
          {coord ? `${coord.nombres} ${coord.apellidos}` : "—"}{" "}
          <span className="text-gray-400">
            ({periodo.desde} → {periodo.hasta})
          </span>
        </h3>
      </div>

      {/* Tabla Resumen por Cuadrilla */}
      <div className="rounded-2xl bg-white shadow border p-5">
        <h2 className="text-lg font-semibold mb-3">Resumen por cuadrilla</h2>
        <div className="overflow-x-auto">
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 border text-left">Cuadrilla</th>
                <th className="p-2 border">Residencial</th>
                <th className="p-2 border">Condominio</th>
                <th className="p-2 border">CAT 5e</th>
                <th className="p-2 border">CAT 6</th>
              </tr>
            </thead>
            <tbody>
              {cuadrillasResumen.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-gray-500" colSpan={5}>
                    Sin datos. Carga un período.
                  </td>
                </tr>
              )}
              {cuadrillasResumen.map((q) => (
                <tr key={q.cuadrilla} className="hover:bg-gray-50">
                  <td className="p-2 border text-left">{q.cuadrilla}</td>
                  <td className="p-2 border text-center">{q.resid}</td>
                  <td className="p-2 border text-center">{q.condo}</td>
                  <td className="p-2 border text-center">{q.cat5e}</td>
                  <td className="p-2 border text-center">{q.cat6}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proveedor */}
      <div className="rounded-2xl bg-white shadow border p-5">
        <div className="grid grid-cols-2 gap-4">
          {["razon", "ruc", "direccion", "atencion", "lugar", "tipooc"].map((id) => (
            <div key={id} className={id === "direccion" ? "col-span-2" : ""}>
              <Label className="capitalize">{id}</Label>
              <input
                type="text"
                id={id}
                value={form[id]}
                onChange={handleInputChange}
                className="w-full border px-3 py-2 rounded focus:outline-none focus:ring focus:border-blue-400"
              />
            </div>
          ))}
          <div>
            <Label>Fecha de Orden de Compra</Label>
            <p className="w-full border px-3 py-2 rounded bg-gray-100">{fechaOrdenCompra}</p>
          </div>
          <div>
            <Label>Fecha de Entrega</Label>
            <input
              type="date"
              id="fEntrega"
              value={form.fEntrega}
              onChange={handleInputChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl bg-white shadow border p-5">
        <div className="overflow-x-auto">
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 border">#</th>
                <th className="p-2 border">Cantidad</th>
                <th className="p-2 border">Código</th>
                <th className="p-2 border">Descripción</th>
                <th className="p-2 border">Precio</th>
                <th className="p-2 border">Total</th>
                <th className="p-2 border">Acción</th>
              </tr>
            </thead>
            <tbody className="text-center">
              {items.map((item, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="p-2 border">{i + 1}</td>
                  <td className="p-2 border">
                    <input
                      type="number"
                      value={item.cantidad}
                      onChange={(e) =>
                        actualizarItem(i, "cantidad", parseFloat(e.target.value) || 0)
                      }
                      className="w-24 border px-2 py-1 rounded"
                    />
                  </td>
                  <td className="p-2 border">
                    <select
                      value={item.codigo}
                      onChange={(e) => actualizarItem(i, "codigo", e.target.value)}
                      className="w-24 border rounded px-1"
                    >
                      <option value="">—</option>
                      {Object.keys(DESCRIPCIONES).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 border">
                    <input
                      type="text"
                      value={item.descripcion}
                      readOnly
                      className="w-full bg-gray-100 px-2 py-1 rounded"
                    />
                  </td>
                  <td className="p-2 border">
                    <input
                      type="number"
                      value={item.precio}
                      onChange={(e) =>
                        actualizarItem(i, "precio", parseFloat(e.target.value) || 0)
                      }
                      className="w-24 border px-2 py-1 rounded"
                    />
                  </td>
                  <td className="p-2 border text-right pr-4">S/ {(item.total || 0).toFixed(2)}</td>
                  <td className="p-2 border text-center">
                    <button
                      onClick={() => eliminarItem(i)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan="7">
                    Sin ítems
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-right space-y-1 text-sm">
          <p>
            Subtotal: <strong>S/ {subtotal.toFixed(2)}</strong>
          </p>
          <p>
            IGV (18%): <strong>S/ {igv.toFixed(2)}</strong>
          </p>
          <p className="font-bold text-lg">Total: S/ {total.toFixed(2)}</p>
        </div>
      </div>

      {/* Pago/Entrega */}
      <div className="rounded-2xl bg-white shadow border p-5 space-y-4">
        <h2 className="text-lg font-semibold">Condiciones de Pago</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Medio</Label>
            <input
              type="text"
              value="01 Factura"
              readOnly
              className="w-full border px-3 py-2 rounded bg-gray-100"
            />
          </div>
          <div>
            <Label>Condición</Label>
            <input
              type="text"
              value="CE - CONTRA ENTREGA"
              readOnly
              className="w-full border px-3 py-2 rounded bg-gray-100"
            />
          </div>
          <div>
            <Label>Total a pagar</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">S/</span>
              <input
                type="number"
                value={editableTotal}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  setEditableTotal(v);
                  setPorcentaje(total > 0 ? (v / total) * 100 : 0);
                }}
                className="w-full border pl-8 px-3 py-2 rounded"
              />
            </div>
          </div>
          <div>
            <Label>Días</Label>
            <input
              type="text"
              id="diasPago"
              value={form.diasPago}
              onChange={handleInputChange}
              placeholder="60"
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div className="col-span-2">
            <p className="text-sm font-semibold">Porcentaje: {porcentaje.toFixed(2)}%</p>
          </div>
        </div>

        <h2 className="text-lg font-semibold">Condiciones de Entrega</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Condición</Label>
            <input
              type="text"
              id="condicionEntrega"
              value={form.condicionEntrega}
              onChange={handleInputChange}
              placeholder="NINGUNA"
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div>
            <Label>Cantidad</Label>
            <input
              type="number"
              id="cantidadEntrega"
              value={form.cantidadEntrega}
              onChange={handleInputChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div>
            <Label>Fecha</Label>
            <input
              type="date"
              id="fEntrega"
              value={form.fEntrega}
              onChange={handleInputChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div>
            <Label>Observación</Label>
            <input
              type="text"
              id="observacionEntrega"
              value={form.observacionEntrega}
              onChange={handleInputChange}
              placeholder="Sin observaciones"
              className="w-full border px-3 py-2 rounded"
            />
          </div>
        </div>
      </div>

      {/* Botones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Button primary disabled={isLoading || guardado} onClick={registrarOrden}>
          {isLoading ? "Generando orden..." : guardado ? "Orden Guardada" : "Guardar y Generar PDF"}
        </Button>
        <Button
          disabled={!puedeNuevaOrden}
          onClick={() => {
            toast((t) => (
              <span>
                ¿Confirmar nueva orden?
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    setForm({
                      razon: "",
                      ruc: "",
                      direccion: "CA. JUAN PRADO DE ZELA MZ,F2 LT.3 -SMP",
                      atencion: "DNIEPER MAYTA - m.mayta@redesm",
                      lugar: "REDES M&D S.A.C",
                      tipooc: "SERVICIOS",
                      fEntrega: "",
                      condicionEntrega: "",
                      cantidadEntrega: "",
                      observacionEntrega: "",
                      diasPago: "",
                    });
                    setItems([]);
                    setEditableTotal(0);
                    setPorcentaje(0);
                    setGuardado(false);
                    setPuedeNuevaOrden(false);
                    setCoordSel("");
                    setCuadrillasResumen([]);
                    toast.success("Formulario listo para nueva orden");
                  }}
                  className="ml-2 bg-green-500 text-white px-2 py-1 rounded"
                >
                  Sí
                </button>
                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="ml-2 bg-red-500 text-white px-2 py-1 rounded"
                >
                  No
                </button>
              </span>
            ));
          }}
        >
          Nueva Orden
        </Button>
      </div>

      {/* Modal de Previsualización */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="text-lg font-semibold">Previsualización de PDF</h3>
              <button
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewUrl("");
                }}
                className="text-gray-600 hover:text-black"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
              <div className="lg:col-span-2 border-r">
                {previewUrl ? (
                  <iframe src={previewUrl} className="w-full h-[75vh]" />
                ) : (
                  <div className="h-[75vh] flex items-center justify-center text-gray-500">
                    Generando…
                  </div>
                )}
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <Label>Correo</Label>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>
                <div>
                  <Label>WhatsApp (solo números)</Label>
                  <input
                    type="tel"
                    value={contact.phone}
                    onChange={(e) =>
                      setContact((c) => ({ ...c, phone: e.target.value.replace(/\D/g, "") }))
                    }
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>

                <div className="space-y-2">
                  <Button
                    accent
                    onClick={() => {
                      if (!previewUrl) return;
                      const a = document.createElement("a");
                      a.href = previewUrl;
                      a.download = `OC-PREVIEW.pdf`;
                      a.click();
                    }}
                  >
                    Descargar PDF
                  </Button>

                  <Button onClick={crearEnlaceCompartir}>Crear enlace para compartir</Button>

                  <div className="flex gap-2">
                    <Button disabled={!shareUrl} href={linkWhatsApp()} asLink>
                      Compartir WhatsApp
                    </Button>
                    <Button disabled={!shareUrl} href={linkMailto()} asLink>
                      Enviar Email
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={shareUrl}
                      className="flex-1 border px-3 py-2 rounded text-xs"
                      placeholder="Genera el enlace para compartir"
                    />
                    <Button onClick={copiarEnlace} disabled={!shareUrl}>
                      Copiar
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t flex justify-end">
              <Button
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewUrl("");
                }}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====== UI helpers ====== */
function HeaderSection({ title, subtitle, nextCode }) {
  return (
    <div className="rounded-2xl bg-white shadow border p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="text-sm">
        <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          Próximo N° de OC: <strong>{nextCode || "—"}</strong>
        </span>
      </div>
    </div>
  );
}
function Label({ children, className }) {
  return <label className={`text-sm font-semibold block mb-1 ${className || ""}`}>{children}</label>;
}
function Button({ children, onClick, disabled, primary, accent, href, asLink }) {
  const base = `px-4 py-2 rounded font-medium transition`;
  const styles = disabled
    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
    : primary
    ? "bg-green-600 hover:bg-green-700 text-white"
    : accent
    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
    : "bg-blue-600 hover:bg-blue-700 text-white";
  if (asLink && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${base} ${styles}`} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
