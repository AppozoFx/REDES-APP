// src/app/almacen/recepcion-actas/page.js
"use client";

import { useState, useEffect, useRef } from "react";
import { db, auth, storage } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  addDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import toast from "react-hot-toast";


/* ===========================================================
   UI Helpers (colores y estilos consistentes)
=========================================================== */
const Title = ({ children }) => (
  <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#30518c]">
    {children}
  </h1>
);

const Card = ({ children, className = "" }) => (
  <div
    className={`bg-white/90 dark:bg-gray-900/80 backdrop-blur rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}
  >
    {children}
  </div>
);

const CardBody = ({ children, className = "" }) => (
  <div className={`p-4 md:p-5 ${className}`}>{children}</div>
);

const Label = ({ children }) => (
  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
    {children}
  </label>
);

const Input = (props) => (
  <input
    {...props}
    className={`border border-gray-300 dark:border-gray-700 rounded-xl w-full px-4 py-2.5 outline-none focus:ring-2 focus:ring-[#30518c]/60 focus:border-[#30518c] bg-white dark:bg-gray-800 text-sm ${props.className || ""}`}
  />
);

const Button = ({ children, variant = "primary", className = "", ...rest }) => {
  const base =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2";
  const variants = {
    primary:
      "bg-[#30518c] hover:bg-[#203a66] text-white focus:ring-[#30518c]/40",
    secondary:
      "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-gray-300",
    danger:
      "bg-red-500 hover:bg-red-600 text-white focus:ring-red-400",
    ghost:
      "bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-100 focus:ring-gray-300",
    orange:
      "bg-[#ff6413] hover:bg-[#e1560f] text-white focus:ring-[#ff6413]/40",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
};




export default function RecepcionActasPage() {
  const [cuadrilla, setCuadrilla] = useState("");
  const [listaCuadrillas, setListaCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [actaCode, setActaCode] = useState("");
  const [actas, setActas] = useState([]);
  const [guiaId, setGuiaId] = useState("");
  const [procesando, setProcesando] = useState(false);

  const inputRef = useRef(null);

  /* =========================
     Cargar cuadrillas y usuarios
  ========================= */
  useEffect(() => {
    async function fetchData() {
      const cuadrillaSnap = await getDocs(collection(db, "cuadrillas"));
      const usuarioSnap = await getDocs(collection(db, "usuarios"));
      setListaCuadrillas(
        cuadrillaSnap.docs.map((docu) => ({
          nombre: docu.data().nombre || docu.id,
          tecnicos: docu.data().tecnicos || [],
        }))
      );
      setUsuarios(
        usuarioSnap.docs.map((docu) => ({
          uid: docu.id,
          ...docu.data(),
        }))
      );
    }
    fetchData();
  }, []);

  useEffect(() => {
    const found = listaCuadrillas.find(
      (c) => c.nombre.toLowerCase() === cuadrilla.toLowerCase()
    );
    setTecnicos(found ? found.tecnicos : []);
  }, [cuadrilla, listaCuadrillas]);

  useEffect(() => {
    // Auto-focus al montar y cada vez que se agregan/limpian códigos
    inputRef.current?.focus();
  }, [actas.length]);

  const getNombreUsuario = (uid) => {
    const user = usuarios.find((u) => u.uid === uid);
    return user ? `${user.nombres || ""} ${user.apellidos || ""}`.trim() : uid;
  };

  /* =========================
     Entrada de actas
  ========================= */
  const handleActaKeyDown = (e) => {
    if (e.key === "Enter" && actaCode.trim()) agregarActa(actaCode.trim());
  };

  // Permite pegar múltiples líneas (una acta por línea)
  const handlePasteMulti = async (e) => {
    const text = e.clipboardData.getData("text");
    if (!text || !text.includes("\n")) return;
    e.preventDefault();
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (rows.length === 0) return;
    let nuevos = 0;
    rows.forEach((code) => {
      const ok = agregarActa(code, { silent: true });
      if (ok) nuevos++;
    });
    setActaCode("");
    toast.success(`➕ ${nuevos} acta(s) añadidas desde portapapeles`);
  };

  const agregarActa = (codigo, { silent = false } = {}) => {
    if (!codigo) return false;
    if (!actas.includes(codigo)) {
      setActas((prev) => [...prev, codigo]);
      if (!silent) toast.success(`✅ Acta ${codigo} añadida`);
      // limpiar y re-enfocar
      setActaCode("");
      setTimeout(() => inputRef.current?.focus(), 80);
      return true;
    } else {
      if (!silent) toast.error(`⚠️ El acta ${codigo} ya fue escaneada`);
      setActaCode("");
      setTimeout(() => inputRef.current?.focus(), 80);
      return false;
    }
  };

  const eliminarActa = (codigo) => {
    setActas((prev) => prev.filter((a) => a !== codigo));
    toast(`🗑️ Acta ${codigo} eliminada`, { duration: 1500 });
  };

  /* =========================
     WhatsApp helpers
  ========================= */
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
    const enlace = `https://wa.me/51${numero}?text=${encodeURIComponent(
      mensaje
    )}`;
    window.open(enlace, "_blank");
  };

  /* =========================
     Correlativo
  ========================= */
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

  /* =========================
     PDF
  ========================= */
  const generarPDFRecepcionActas = async (guiaIdLocal, datos) => {
    const calcularAlturaPDF = () => {
      const cabecera = 60;
      const tecn = datos.tecnicos.length * 5;
      const acts = datos.actas.length * 5;
      const barraYFirmas = 55;
      return Math.max(cabecera + tecn + acts + barraYFirmas, 200);
    };

    const alturaFinal = calcularAlturaPDF();
    const docPDF = new jsPDF({ unit: "mm", format: [80, alturaFinal] });

    let y = 10;
    const center = { align: "center" };
    docPDF.setFontSize(9).setFont("helvetica", "normal");

    docPDF.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, center);
    y += 5;
    docPDF.text("RUC: 20601345979", 40, y, center);
    y += 5;
    docPDF.text("Cal. Juan Prado de Zela Mza. F2 Lote. 3", 40, y, center);
    y += 5;
    docPDF.text("Apv. San Francisco de Cayran", 40, y, center);
    y += 5;
    docPDF.text("Celular/WSP: 913 637 815", 40, y, center);
    y += 7;

    docPDF.setFont("helvetica", "bold");
    docPDF.text(`GUÍA: ${guiaIdLocal}`, 40, y, center);
    y += 5;
    docPDF.setFont("helvetica", "normal");
    docPDF.text(`FECHA: ${new Date().toLocaleString()}`, 40, y, center);
    y += 5;
    docPDF.text(`USUARIO: ${datos.usuario}`, 40, y, center);
    y += 5;
    docPDF.text(`Cuadrilla: ${datos.cuadrilla}`, 40, y, center);
    y += 5;

    datos.tecnicos.forEach((tec, i) => {
      docPDF.text(`Técnico ${i + 1}: ${tec}`, 40, y, center);
      y += 5;
    });

    y += 3;
    docPDF.setFont("helvetica", "bold");
    docPDF.text(`${datos.actas.length} ACTAS RECEPCIONADAS`, 40, y, center);
    y += 6;
    docPDF.setFont("helvetica", "normal");

    datos.actas.forEach((acta) => {
      docPDF.text(`${acta} - ACTA`, 40, y, center);
      y += 5;
    });

    // Código de barras
    y += 4;
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, guiaIdLocal, {
      format: "CODE128",
      displayValue: false,
      width: 2,
      height: 15,
    });
    const imgData = canvas.toDataURL("image/png");
    docPDF.addImage(imgData, "PNG", 5, y, 70, 25);
    y += 39;

    // Firmas
    docPDF.line(10, y, 40, y);
    docPDF.line(45, y, 75, y);
    y += 10;
    docPDF.text("Cuadrilla", 25, y, center);
    docPDF.text("Almacén", 60, y, center);

    // Subir a Storage
    const pdfBlob = docPDF.output("blob");
    const storagePath = `guias_actas/${guiaIdLocal}.pdf`;
    // Usamos storage que importaste desde firebaseConfig
    const { ref: storageRef, uploadBytes, getDownloadURL } = await import(
      "firebase/storage"
    );
    const refStorage = storageRef(storage, storagePath);
    await uploadBytes(refStorage, pdfBlob);
    const urlComprobante = await getDownloadURL(refStorage);
    toast.success("📄 PDF subido a Firebase");

    // Enviar WhatsApp
    const celulares = await obtenerCelularesTecnicos(datos.tecnicosUID || []);
    celulares.forEach((numero) => {
      enviarPorWhatsAppManual(numero, {
        tipoGuia: "Recepción de Actas",
        guiaId: guiaIdLocal,
        cuadrilla: datos.cuadrilla,
        tecnicos: datos.tecnicos,
        usuario: datos.usuario,
        urlComprobante,
        extraInfo: `📑 *Cantidad de Actas:* ${datos.actas.length}`,
      });
    });

    // Imprimir (doble copia)
    const url = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        iframe.contentWindow?.print();
      }, 1500);
    };
    iframe.onafterprint = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };

    return urlComprobante;
  };

  /* =========================
     Registrar (con confirmación)
  ========================= */
  const handleRegistrar = async () => {
    if (!cuadrilla || actas.length === 0) {
      toast.error("⚠️ Complete los datos antes de registrar.");
      return;
    }

    const confirmed = window.confirm(
      `¿Registrar guía de actas para "${cuadrilla}" con ${actas.length} acta(s)?`
    );
    if (!confirmed) return;

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
          impreso: false,
        });
      });

      const urlComprobante = await generarPDFRecepcionActas(newGuiaId, {
        usuario: userFull,
        cuadrilla,
        tecnicos: tecnicos.map(getNombreUsuario),
        tecnicosUID: tecnicos,
        actas,
      });

      await updateDoc(docRef, { impreso: true });
      toast.success("✅ Guía generada correctamente", { id: toastId });

      await addDoc(collection(db, "notificaciones"), {
        tipo: "Recepción de Actas",
        mensaje: `📄 ${userFull} registró la guía ${newGuiaId} para la cuadrilla "${cuadrilla}" con ${actas.length} actas.`,
        usuario: userFull,
        fecha: serverTimestamp(),
        guiaId: newGuiaId,
        link: urlComprobante,
        detalles: {
          cuadrilla,
          tecnicos: tecnicos.map((uid) => getNombreUsuario(uid)),
          cantidadActas: actas.length,
          actas,
        },
        visto: false,
      });

      toast.success("🔔 Notificación registrada");

      // Limpiar
      setCuadrilla("");
      setActas([]);
      setTecnicos([]);
      setActaCode("");
      setGuiaId("");
      inputRef.current?.focus();
    } catch (error) {
      console.error(error);
      toast.error("❌ Error al generar la guía", { id: toastId });
    } finally {
      setProcesando(false);
    }
  };

  /* =========================
     Render
  ========================= */
  const tecnicosNombres = tecnicos.map(getNombreUsuario);
  const iniciales = (nombre) =>
    nombre
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Almacén</span>
          <span className="opacity-50">/</span>
          <span className="text-gray-700 dark:text-gray-200">Recepción de Actas</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Title>📄 Recepción de Actas</Title>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-orange-50 text-[#ff6413] px-3 py-1 text-xs font-medium ring-1 ring-[#ff6413]/20">
              {actas.length} acta(s)
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setActas([]);
                toast("🧹 Todas las actas fueron limpiadas", { duration: 1800 });
              }}
              className="hidden md:inline-flex"
            >
              Limpiar actas
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
          {/* Columna izquierda (form) */}
          <div className="lg:col-span-3 space-y-4">
            <Card>
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label>Seleccionar Cuadrilla</Label>
                    <Input
                      list="cuadrillas"
                      value={cuadrilla}
                      onChange={(e) => setCuadrilla(e.target.value)}
                      placeholder="Nombre de la cuadrilla"
                    />
                    <datalist id="cuadrillas">
                      {listaCuadrillas.map((c) => (
                        <option key={c.nombre} value={c.nombre} />
                      ))}
                    </datalist>
                  </div>

                  <div className="md:col-span-2">
                    <Label>Escanear / Ingresar Código de Acta</Label>
                    <div className="flex gap-2">
                      <Input
                        id="input-acta"
                        ref={inputRef}
                        value={actaCode}
                        onChange={(e) => setActaCode(e.target.value)}
                        onKeyDown={handleActaKeyDown}
                        onPaste={handlePasteMulti}
                        placeholder="Escanea y presiona Enter, o pega varias líneas…"
                      />
                      <Button
                        type="button"
                        onClick={() => actaCode.trim() && agregarActa(actaCode.trim())}
                        className="whitespace-nowrap"
                      >
                        Agregar
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Tip: puedes pegar múltiples códigos (uno por línea).
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                    Actas escaneadas
                  </h3>
                  {actas.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setActas([]);
                        toast("🧹 Todas las actas fueron limpiadas", {
                          duration: 1800,
                        });
                      }}
                    >
                      Limpiar todas
                    </Button>
                  )}
                </div>

                {actas.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    Aún no hay actas. Escanea o pega los códigos para comenzar.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {actas.map((a, i) => (
                      <span
                        key={i}
                        className="group inline-flex items-center gap-2 bg-[#30518c] text-white text-xs px-3 py-1 rounded-full"
                      >
                        {a}
                        <button
                          onClick={() => eliminarActa(a)}
                          className="text-white/80 group-hover:text-white transition"
                          title="Eliminar acta"
                        >
                          ✖
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">
                  Cuadrilla y Técnicos
                </h3>

                {cuadrilla ? (
                  <div className="mb-3">
                    <div className="text-sm">
                      <span className="font-medium">Cuadrilla:</span>{" "}
                      <span className="text-gray-700 dark:text-gray-200">
                        {cuadrilla}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    Selecciona una cuadrilla para ver los técnicos.
                  </p>
                )}

                {tecnicos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {tecnicosNombres.map((t) => (
                      <div
                        key={t}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700"
                      >
                        <div className="w-7 h-7 rounded-full bg-[#ff6413]/10 text-[#ff6413] flex items-center justify-center text-xs font-bold">
                          {iniciales(t)}
                        </div>
                        <span className="text-sm">{t}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Columna derecha (preview) */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardBody>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">
                  Vista previa
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Guía</span>
                    <span className="font-medium">
                      {guiaId || "Se generará al registrar"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Cuadrilla</span>
                    <span className="font-medium">{cuadrilla || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Técnicos</span>
                    <span className="font-medium">
                      {tecnicosNombres.length > 0
                        ? `${tecnicosNombres.length} técnico(s)`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Actas</span>
                    <span className="font-medium">{actas.length}</span>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300">
                  Al registrar se:
                  <ul className="list-disc ml-5 mt-2 space-y-1">
                    <li>Genera el correlativo y el PDF térmico (80mm).</li>
                    <li>Sube el PDF a Firebase Storage.</li>
                    <li>Envía WhatsApp a técnicos con el comprobante.</li>
                    <li>Crea notificación en <code>notificaciones</code>.</li>
                  </ul>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* Barra de acciones fija */}
      <div className="fixed bottom-0 inset-x-0 z-40">
        <div className="max-w-6xl mx-auto px-4 pb-4">
          <Card className="shadow-lg">
            <CardBody className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {actas.length > 0 ? (
                  <>
                    <span className="font-medium">{actas.length}</span> acta(s)
                    lista(s) para registrar
                  </>
                ) : (
                  "Escanea o pega actas para habilitar el registro"
                )}
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCuadrilla("");
                    setActas([]);
                    setTecnicos([]);
                    setActaCode("");
                    setGuiaId("");
                    inputRef.current?.focus();
                    toast("Formulario reiniciado");
                  }}
                  className="w-full md:w-auto"
                >
                  Reiniciar
                </Button>
                <Button
                  onClick={handleRegistrar}
                  disabled={procesando || !cuadrilla || actas.length === 0}
                  className="w-full md:w-auto"
                >
                  {procesando ? "Procesando…" : "Registrar y Generar Guía"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Overlay de procesamiento */}
      {procesando && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="animate-spin inline-block w-5 h-5 rounded-full border-2 border-t-transparent border-[#30518c]" />
              <span className="text-sm">
                Generando guía, subiendo PDF y notificando…
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
