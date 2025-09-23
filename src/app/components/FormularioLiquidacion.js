// src/app/components/FormularioLiquidacion.js
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/firebaseConfig";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Button } from "@/app/components/ui/button";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";

/* ----------------------------- utilidades UI ----------------------------- */
const prettyBar = {
  cancel:
    "group inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 " +
    "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 " +
    "shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 " +
    "active:scale-[.98] w-full sm:w-auto",
  confirm: (disabled) =>
    "group inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 " +
    (disabled
      ? "bg-gray-400 text-white cursor-not-allowed w-full sm:w-auto"
      : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md " +
        "hover:from-blue-700 hover:to-indigo-700 active:scale-[.98] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
        "w-full sm:w-auto"),
};

const smallNote = "text-[11px] leading-4";
const cx = (...a) => a.filter(Boolean).join(" ");

/* Normalizadores */
const norm = (s) => (s || "").trim().toUpperCase();
const normText = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const toDateLoose = (v) =>
  v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v || Date.now());

/** SN en otros campos (excluye el actual) */
const dupInOthers = (sn, where, form) => {
  const needle = norm(sn);
  if (!needle) return false;

  const pools = [];
  if (where?.except !== "ONT") pools.push(norm(form.snONT));
  if (where?.except !== "MESH") (form.snMESH || []).forEach((v, i) => where?.index !== i && pools.push(norm(v)));
  if (where?.except !== "BOX") (form.snBOX || []).forEach((v, i) => where?.index !== i && pools.push(norm(v)));
  if (where?.except !== "FONO") pools.push(norm(form.snFONO));

  return pools.filter(Boolean).includes(needle);
};

/* Detección de tipificaciones en el texto del plan/descripcion */
function detectTipificaciones(inst) {
  const base = [
    inst?.plan,
    inst?.campaña,
    inst?.campania,
    inst?.detalle,
    inst?.observacion,
    inst?.observacionLlamada,
    inst?.tipoServicio,
  ]
    .map(normText)
    .join(" ");

  const compact = base.replace(/\s+/g, "");

  const gamer = compact.includes("INTERNETGAMER") || /\bGAMER\b/.test(base);
  const kitWifiPro = base.includes("KIT WIFI PRO") || compact.includes("KITWIFIPRO");
  const cableadoMesh =
    base.includes("SERVICIO CABLEADO DE MESH") ||
    base.includes("CABLEADO DE MESH") ||
    /SERVICIO\s*MESH/.test(base);

  return { gamer, kitWifiPro, cableadoMesh };
}

export default function FormularioLiquidacion({ instalacion, onFinalizar, onCancelar }) {
  const { userData } = useAuth();

  const [stockEquipos, setStockEquipos] = useState([]);
  const [procesando, setProcesando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false); // 🔒 tras liquidar

  const tipoCategoria = instalacion?.residencialCondominio || instalacion?.categoria || "";
  const esCorreccion = !!instalacion?.esCorreccion;

  const [formulario, setFormulario] = useState({
    // (eliminados: nActa, metraje, rotuloCTO, templadores, anclajeP, clevis, hebillas)
    snONT: "",
    proidONT: "",
    snMESH: [],
    snBOX: [],
    snFONO: "",
    planGamer: "",
    kitWifiPro: "",
    servicioCableadoMesh: "",
    cat5e: 0,
    cat6: 0,
    puntosUTP: 0,
    observacion: "",
    estadoLiquidacion: "Pendiente",
  });

  /* --------- Autochequeo por tipificaciones (INTERNETGAMER, KIT, MESH) --------- */
  useEffect(() => {
    const { gamer, kitWifiPro, cableadoMesh } = detectTipificaciones(instalacion);
    setFormulario((prev) => {
      const next = { ...prev };
      if (!prev.planGamer && gamer) next.planGamer = "GAMER";
      if (!prev.kitWifiPro && kitWifiPro) next.kitWifiPro = "KIT WIFI PRO (AL CONTADO)";
      if (!prev.servicioCableadoMesh && cableadoMesh) next.servicioCableadoMesh = "SERVICIO CABLEADO DE MESH";
      // derivadas
      next.cat6 = next.planGamer ? 1 : 0;
      next.puntosUTP = parseInt(next.cat5e || 0) + next.cat6;
      return next;
    });
  }, [instalacion]);

  /* ---------------------------- stock de cuadrilla --------------------------- */
  useEffect(() => {
    if (!instalacion?.cuadrillaId) return;
    (async () => {
      try {
        const refCol = collection(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`);
        const snapshot = await getDocs(refCol);
        const equipos = snapshot.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, tipoFinal: data.tipo || data.equipo || "" };
        });
        setStockEquipos(equipos);
      } catch (err) {
        console.error(err);
        toast.error("Error al obtener stock de equipos");
      }
    })();
  }, [instalacion?.cuadrillaId]);

  const ontDisponibles = stockEquipos.filter((e) => e.tipoFinal === "ONT");
  const meshDisponibles = stockEquipos.filter((e) => e.tipoFinal === "MESH");
  const boxDisponibles = stockEquipos.filter((e) => e.tipoFinal === "BOX");
  const fonoDisponibles = stockEquipos.filter((e) => e.tipoFinal === "FONO");

  /* ------------------------ duplicados (bloqueo global) ----------------------- */
  const duplicatesSet = useMemo(() => {
    const vals = [];
    if (formulario.snONT) vals.push(norm(formulario.snONT));
    (formulario.snMESH || []).forEach((v) => v && vals.push(norm(v)));
    (formulario.snBOX || []).forEach((v) => v && vals.push(norm(v)));
    if (formulario.snFONO) vals.push(norm(formulario.snFONO));

    const count = vals.reduce((m, v) => (m.set(v, (m.get(v) || 0) + 1), m), new Map());
    return new Set([...count].filter(([, c]) => c > 1).map(([v]) => v));
  }, [formulario]);

  const isDupVal = (val) => val && duplicatesSet.has(norm(val));
  const hasDuplicates = duplicatesSet.size > 0;

  /* -------------------------- handlers de formulario ------------------------- */
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let nuevoValor = value;

    if (type === "checkbox") {
      if (name === "planGamer") nuevoValor = checked ? "GAMER" : "";
      if (name === "kitWifiPro") nuevoValor = checked ? "KIT WIFI PRO (AL CONTADO)" : "";
      if (name === "servicioCableadoMesh") nuevoValor = checked ? "SERVICIO CABLEADO DE MESH" : "";
    }

    const updated = { ...formulario, [name]: nuevoValor };
    updated.cat6 = updated.planGamer ? 1 : 0; // Cat6 depende de Gamer
    updated.puntosUTP = parseInt(updated.cat5e || 0) + updated.cat6; // suma
    setFormulario(updated);
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
      ...(name === "servicioCableadoMesh" && {
        cat5e: checked ? prev.cat5e : 0,
        cat6: checked ? (prev.planGamer ? 1 : 0) : 0,
        puntosUTP: checked ? prev.cat5e + (prev.planGamer ? 1 : 0) : 0,
      }),
      ...(name === "planGamer" && {
        cat6: checked ? 1 : 0,
        puntosUTP: prev.cat5e + (checked ? 1 : 0),
      }),
    }));
  };

  const handleCat5eChange = (e) => {
    const valor = parseInt(e.target.value) || 0;
    setFormulario((prev) => ({ ...prev, cat5e: valor, puntosUTP: valor + (prev.cat6 || 0) }));
  };

  useEffect(() => {
    setFormulario((prev) => ({ ...prev, puntosUTP: prev.cat5e + prev.cat6 }));
  }, [formulario.cat6]);

  const buscarEquipoPorSN = async (sn) => {
    const qx = query(collection(db, "equipos"), where("SN", "==", sn));
    return await getDocs(qx);
  };

  const handleSelectONT = async (snSeleccionado) => {
    if (!snSeleccionado) {
      setFormulario((f) => ({ ...f, snONT: "", proidONT: "", estadoLiquidacion: "Pendiente" }));
      return;
    }

    const sn = snSeleccionado.trim();
    let proidFinal = ontDisponibles.find((o) => o.SN === sn)?.proid || "";

    if (!proidFinal) {
      try {
        const q = query(collection(db, "equipos"), where("SN", "==", sn));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          const docData = querySnap.docs[0].data();
          proidFinal = docData.proid || "";
          if (!proidFinal) toast.error(`⚠️ El SN ${sn} no tiene PROID en base de datos.`);
        } else {
          toast.error(`❌ El SN ${sn} no fue encontrado en la colección principal.`);
        }
      } catch (error) {
        console.error("Error al buscar el ONT en Firestore:", error);
        toast.error("Ocurrió un error al consultar la base de datos.");
      }
    }

    setFormulario((prev) => ({
      ...prev,
      snONT: sn,
      proidONT: proidFinal,
      estadoLiquidacion: sn && proidFinal ? "Liquidado" : "Pendiente",
    }));

    // Aviso de duplicado si existe en OTROS campos
    if (dupInOthers(sn, { except: "ONT" }, { ...formulario, snONT: sn })) {
      toast.error(`Serie duplicada: ${sn} ya fue ingresada en otro campo.`);
    }
  };

  

  /* -------------------------------- confirmar -------------------------------- */
  const handleConfirmar = async () => {
    if (hasDuplicates) return toast.error("Hay series duplicadas. Corrige antes de confirmar.");
    if (!formulario.snONT) return toast.error("⚠️ Debes seleccionar un SN ONT para continuar.");
    if (!ontDisponibles.find((o) => o.SN === formulario.snONT)) return toast.error("⚠️ El SN ONT no es válido.");

    for (let sn of (formulario.snMESH || []).filter(Boolean)) {
      if (!meshDisponibles.find((m) => m.SN === sn)) return toast.error(`⚠️ El SN MESH ${sn} no es válido.`);
    }
    for (let sn of (formulario.snBOX || []).filter(Boolean)) {
      if (!boxDisponibles.find((b) => b.SN === sn)) return toast.error(`⚠️ El SN BOX ${sn} no es válido.`);
    }
    if (formulario.snFONO && !fonoDisponibles.find((f) => f.SN === formulario.snFONO))
      return toast.error("⚠️ El SN FONO no es válido.");

    setProcesando(true);
    const loadingToast = toast.loading("Procesando liquidación...");

    try {
      // 1) Guardar la liquidación
      await setDoc(doc(db, "liquidacion_instalaciones", instalacion.codigoCliente), {
        ...formulario,
        cliente: instalacion.cliente,
        direccion: instalacion.direccion,
        cuadrillaNombre: instalacion.cuadrillaNombre,
        fechaInstalacion: instalacion.fechaInstalacion,
        fechaLiquidacion: serverTimestamp(),
        usuario: `${userData?.nombres} ${userData?.apellidos}`,
        dia: instalacion.dia || "",
        documento: instalacion.documento || "",
        plan: instalacion.plan || "",
        residencialCondominio: instalacion.residencialCondominio || "",
        telefono: instalacion.telefono || "",
        tipoCuadrilla: instalacion.tipoCuadrilla || "",
        tipoServicio: instalacion.tipoServicio || "",
        codigoCliente: instalacion.codigoCliente || "",
        coordenadas: {
          lat: instalacion.coordenadas?.lat || 0,
          lng: instalacion.coordenadas?.lng || 0,
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
        observacionLlamada: instalacion.observacionLlamada || "",
      });

      // 2) Actualizar equipos y retirar del stock
      const buscarEquipoPorSN = async (sn) => {
        const qx = query(collection(db, "equipos"), where("SN", "==", sn));
        return await getDocs(qx);
      };
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
            usuario: `${userData?.nombres} ${userData?.apellidos}`,
          });
        } catch (error) {
          console.error(`Error al actualizar equipo SN ${sn}:`, error);
          toast.error(`Error al actualizar el equipo ${sn}`);
        }
      };

      const snEquipos = [
        formulario.snONT,
        ...(formulario.snMESH || []),
        ...(formulario.snBOX || []),
        formulario.snFONO,
      ].filter(Boolean);

      if (snEquipos.length === 0) throw new Error("No hay equipos seleccionados para procesar.");

      for (const sn of snEquipos) {
        await deleteDoc(doc(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`, sn));
        await actualizarEquipo(sn);
      }

      // 3) Notificación (SIN PDF y SIN Storage)
const payload = {
  tipo: "Liquidación",
  codigoCliente: instalacion.codigoCliente,
  cliente: instalacion.cliente,
  direccion: instalacion.direccion,
  cuadrilla: instalacion.cuadrillaNombre || "Sin cuadrilla",
  usuario: `${userData?.nombres} ${userData?.apellidos}`,
  fecha: serverTimestamp(),
  equipos: {
    snONT: formulario.snONT,
    proidONT: formulario.proidONT,
    snMESH: (formulario.snMESH || []).filter(Boolean),
    snBOX: (formulario.snBOX || []).filter(Boolean),
    snFONO: formulario.snFONO || "",
  },
  servicios: {
    planGamer: !!formulario.planGamer,
    kitWifiPro: !!formulario.kitWifiPro,
    servicioCableadoMesh: !!formulario.servicioCableadoMesh,
    cat5e: Number(formulario.cat5e || 0),
    cat6: Number(formulario.cat6 || 0),
    puntosUTP: Number(formulario.puntosUTP || 0),
  },
  // Puedes dejar un mensaje estandarizado sin link
  mensaje: `✅ Cliente: ${instalacion.cliente} • Pedido: ${instalacion.codigoCliente} • Cuadrilla: ${instalacion.cuadrillaNombre} • Liquidado por: ${userData?.nombres} ${userData?.apellidos}`,
};

await addDoc(collection(db, "notificaciones"), payload);

toast.dismiss(loadingToast);

// Toast flotante elegante (SIN link al comprobante)
toast.custom(
  (t) => {
    const mesh = payload.equipos?.snMESH || [];
    const box  = payload.equipos?.snBOX  || [];
    return (
      <div
        className={`max-w-md w-full rounded-lg shadow-lg p-4 border bg-white
                    ${t.visible ? "animate-enter" : "animate-leave"}`}
      >
        <div className="text-sm font-semibold text-[#30518c] mb-1">
          Liquidación registrada
        </div>
        <div className="text-sm text-gray-800 leading-5">
          ✅ <b>{payload.cliente}</b> — Pedido <b>{payload.codigoCliente}</b><br />
          👷 Cuadrilla: {payload.cuadrilla}<br />
          🔌 ONT: <b>{payload.equipos.snONT || "—"}</b>
          {payload.equipos.proidONT ? ` (PROID ${payload.equipos.proidONT})` : ""}<br />
          📶 MESH: {mesh.length}{mesh.length ? ` — SN: ${mesh.join(", ")}` : ""}<br />
          🗳️ BOX: {box.length}{box.length ? ` — SN: ${box.join(", ")}` : ""}<br />
          {payload.equipos.snFONO ? <>☎️ FONO: {payload.equipos.snFONO}<br /></> : null}
          🎮 INTERNETGAMER: {payload.servicios.planGamer ? "Sí" : "No"}<br />
          📦 KIT WIFI PRO: {payload.servicios.kitWifiPro ? "Sí" : "No"}<br />
          🟣 Cableado MESH: {payload.servicios.servicioCableadoMesh ? "Sí" : "No"}<br />
          UTP: {payload.servicios.puntosUTP} (Cat5e {payload.servicios.cat5e} / Cat6 {payload.servicios.cat6})<br />
          👤 Liquidado por: <b>{payload.usuario}</b>
        </div>
      </div>
    );
  },
  { duration: 7000, position: "top-right" }
);

// Mensaje breve adicional (opcional)
toast.success("✅ Liquidación completada con éxito.");



      // 🔒 bloquear UI y avisar al padre
      setBloqueado(true);
      onFinalizar?.({
        estado: "Liquidado",
        codigoCliente: instalacion.codigoCliente,
        fechaInstalacion: toDateLoose(instalacion.fechaInstalacion),
        cuadrillaNombre: instalacion.cuadrillaNombre,
      });
    } catch (error) {
      console.error("❌ Error durante la liquidación:", error);
      toast.dismiss(loadingToast);
      toast.error("Ocurrió un error al procesar la liquidación. Intenta nuevamente.");
    } finally {
      setProcesando(false);
    }
  };

  /* ----------------------------------- UI ----------------------------------- */
  const fInst = toDateLoose(instalacion?.fechaInstalacion);
  const dupBanner = hasDuplicates && `⚠ Hay series repetidas: ${[...duplicatesSet].join(", ")}`;

  const classValid = (ok) =>
    `border rounded px-3 py-2 w-full transition ${ok ? "bg-green-100 border-green-500" : "bg-red-100 border-red-500"}`;

  const okONT =
    !!formulario.snONT &&
    !!ontDisponibles.find((o) => o.SN === formulario.snONT) &&
    !dupInOthers(formulario.snONT, { except: "ONT" }, formulario);
  const okFONO =
    !!formulario.snFONO &&
    !!fonoDisponibles.find((f) => f.SN === formulario.snFONO) &&
    !dupInOthers(formulario.snFONO, { except: "FONO" }, formulario);

  const lat = instalacion?.coordenadas?.lat;
  const lng = instalacion?.coordenadas?.lng;
  const mapSrc =
    typeof lat === "number" && typeof lng === "number"
      ? `https://www.google.com/maps?q=${lat},${lng}&z=16&output=embed`
      : null;

  return (
    <div
      className={`relative p-6 bg-white shadow-lg rounded-xl max-w-5xl mx-auto border ${
        bloqueado ? "ring-2 ring-emerald-500" : "border-gray-100"
      }`}
    >
      {/* overlay de bloqueo por LIQUIDADO */}
      {bloqueado && (
        <div className="absolute inset-0 z-20 bg-white/70 backdrop-blur-sm flex items-center justify-center text-emerald-700 font-semibold">
          Liquidación registrada ✅
        </div>
      )}

      {/* OVERLAY DE CARGA (bloqueo global mientras procesando) */}
      {procesando && (
        <div className="fixed inset-0 z-[999] bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 shadow-2xl w-[320px] text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-4 border-gray-200 border-t-blue-600 animate-spin" />
            <p className="font-semibold text-gray-800">Registrando liquidación…</p>
            <p className="text-xs text-gray-500 mt-1">Por favor espera</p>
          </div>
        </div>
      )}

      <h2 className="text-xl md:text-2xl font-bold mb-4 text-center text-gray-800 tracking-tight">
        <span className="mr-2">🧾</span>Liquidación de Instalación
      </h2>

      {esCorreccion && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          🔧 <strong>Modo Corrección:</strong> Estás ajustando una liquidación previa.
        </div>
      )}

      {dupBanner && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          {dupBanner}
        </div>
      )}

      <div className={`${bloqueado ? "pointer-events-none opacity-60" : ""}`}>
        {/* DATOS FIJOS + MAPA */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* detalles */}
          <div className="md:col-span-2">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">Fecha instalación</dt>
                <dd className="font-medium text-gray-800">{fInst ? fInst.toLocaleDateString() : "Sin fecha"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Cuadrilla</dt>
                <dd className="font-medium text-gray-800">{instalacion?.cuadrillaNombre || "Sin cuadrilla"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Código de Pedido</dt>
                <dd className="font-medium text-gray-800">{instalacion?.codigoCliente || "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Documento</dt>
                <dd className="font-medium text-gray-800">{instalacion?.documento || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Cliente</dt>
                <dd className="font-medium text-gray-800">{instalacion?.cliente || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Dirección</dt>
                <dd className="font-medium text-gray-800">{instalacion?.direccion || "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Tipo</dt>
                <dd className="font-medium text-gray-800">{tipoCategoria || "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Plan</dt>
                <dd className="font-medium text-gray-800">{instalacion?.plan || "—"}</dd>
              </div>
            </dl>
          </div>

          {/* mapa */}
          <div className="md:col-span-1">
            <div className="rounded-lg border overflow-hidden h-40 md:h-full min-h-[160px] bg-gray-50">
              {mapSrc ? (
                <iframe
                  title="Ubicación de instalación"
                  src={mapSrc}
                  className="w-full h-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 p-3 text-center">
                  Sin coordenadas disponibles
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ONT + PROID */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <Input
              list="ont-options"
              name="snONT"
              value={formulario.snONT}
              onChange={(e) => setFormulario({ ...formulario, snONT: e.target.value })}
              onBlur={(e) => handleSelectONT(e.target.value.trim())}
              placeholder="SN ONT"
              className={
                formulario.snONT
                  ? okONT
                    ? classValid(true)
                    : classValid(false)
                  : "border rounded px-3 py-2 w-full transition bg-gray-50"
              }
            />
            <datalist id="ont-options">
              {ontDisponibles.map((o) => (
                <option key={o.id} value={o.SN} />
              ))}
            </datalist>

            {formulario.snONT && !ontDisponibles.find((o) => o.SN === formulario.snONT) && (
              <p className={cx(smallNote, "text-red-500 mt-1")}>⚠️ SN ONT no válido o fuera de stock.</p>
            )}
            {isDupVal(formulario.snONT) && (
              <p className={cx(smallNote, "text-red-600 mt-1")}>Serie repetida en otro campo.</p>
            )}
          </div>

          <Input
            value={formulario.proidONT}
            readOnly
            placeholder="🔢 PROID ONT"
            className="bg-gray-100 border border-gray-300 text-gray-700 cursor-default"
          />
        </div>

        {/* MESH / BOX */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
          {Array.from({ length: Math.min(meshDisponibles.length, 4) }).map((_, idx) => {
            const val = formulario.snMESH[idx] || "";
            const okMESH =
              !!val &&
              !!meshDisponibles.find((m) => m.SN === val) &&
              !dupInOthers(val, { except: "MESH", index: idx }, formulario);
            return (
              <div key={`mesh-${idx}`}>
                <Input
                  list="mesh-options"
                  value={val}
                  onChange={(e) => {
                    const nuevos = [...(formulario.snMESH || [])];
                    nuevos[idx] = e.target.value;
                    setFormulario({ ...formulario, snMESH: nuevos });
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (dupInOthers(v, { except: "MESH", index: idx }, formulario)) {
                      toast.error(`Serie duplicada: ${v} ya fue ingresada en otro campo.`);
                    }
                  }}
                  placeholder={`SN MESH ${idx + 1}`}
                  className={val ? (okMESH ? classValid(true) : classValid(false)) : "border rounded px-3 py-2 w-full bg-gray-50"}
                />
                <datalist id="mesh-options">
                  {meshDisponibles.map((m) => (
                    <option key={m.id} value={m.SN} />
                  ))}
                </datalist>
                {val && !meshDisponibles.find((m) => m.SN === val) && (
                  <p className={cx(smallNote, "text-red-500 mt-1")}>⚠️ SN MESH no válido.</p>
                )}
                {isDupVal(val) && <p className={cx(smallNote, "text-red-600 mt-1")}>Serie repetida.</p>}
              </div>
            );
          })}

          {Array.from({ length: Math.min(boxDisponibles.length, 4) }).map((_, idx) => {
            const val = (formulario.snBOX || [])[idx] || "";
            const okBOX =
              !!val &&
              !!boxDisponibles.find((b) => b.SN === val) &&
              !dupInOthers(val, { except: "BOX", index: idx }, formulario);
            return (
              <div key={`box-${idx}`}>
                <Input
                  list={`box-options-${idx}`}
                  value={val}
                  onChange={(e) => {
                    const nuevos = [...(formulario.snBOX || [])];
                    nuevos[idx] = e.target.value;
                    setFormulario({ ...formulario, snBOX: nuevos });
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (dupInOthers(v, { except: "BOX", index: idx }, formulario)) {
                      toast.error(`Serie duplicada: ${v} ya fue ingresada en otro campo.`);
                    }
                  }}
                  placeholder={`SN BOX ${idx + 1}`}
                  className={val ? (okBOX ? classValid(true) : classValid(false)) : "border rounded px-3 py-2 w-full bg-gray-50"}
                />
                <datalist id={`box-options-${idx}`}>
                  {boxDisponibles.map((b) => (
                    <option key={b.id} value={b.SN} />
                  ))}
                </datalist>
                {val && !boxDisponibles.find((b) => b.SN === val) && (
                  <p className={cx(smallNote, "text-red-500 mt-1")}>⚠️ SN BOX {idx + 1} no válido.</p>
                )}
                {isDupVal(val) && <p className={cx(smallNote, "text-red-600 mt-1")}>Serie repetida.</p>}
              </div>
            );
          })}
        </div>

        {/* FONO */}
        {fonoDisponibles.length > 0 && (
          <div className="mb-3">
            <Input
              list="fono-options"
              name="snFONO"
              value={formulario.snFONO}
              onChange={(e) => setFormulario({ ...formulario, snFONO: e.target.value })}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (dupInOthers(v, { except: "FONO" }, formulario)) {
                  toast.error(`Serie duplicada: ${v} ya fue ingresada en otro campo.`);
                }
              }}
              placeholder="SN FONO"
              className={
                formulario.snFONO ? (okFONO ? classValid(true) : classValid(false)) : "border rounded px-3 py-2 w-full bg-gray-50"
              }
            />
            <datalist id="fono-options">
              {fonoDisponibles.map((f) => (
                <option key={f.id} value={f.SN} />
              ))}
            </datalist>
          </div>
        )}

        {/* Servicios y materiales (simplificado) */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="planGamer"
              checked={!!formulario.planGamer}
              onChange={handleCheckboxChange}
              className="w-5 h-5 accent-blue-600"
            />
            <span className="text-sm font-medium">🎮 Plan Gamer</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="kitWifiPro"
              checked={!!formulario.kitWifiPro}
              onChange={handleCheckboxChange}
              className="w-5 h-5 accent-green-600"
            />
            <span className="text-sm font-medium">📦 KIT WIFI PRO (AL CONTADO)</span>
          </label>

          <label className="flex items-center gap-2 col-span-2">
            <input
              type="checkbox"
              name="servicioCableadoMesh"
              checked={!!formulario.servicioCableadoMesh}
              onChange={handleCheckboxChange}
              className="w-5 h-5 accent-purple-600"
            />
            <span className="text-sm font-medium">🔧 SERVICIO CABLEADO DE MESH</span>
          </label>

          <Input
            type="number"
            name="cat5e"
            placeholder="Cat 5E"
            value={formulario.cat5e}
            onChange={handleCat5eChange}
            disabled={!formulario.servicioCableadoMesh}
            className={`border-2 ${
              formulario.servicioCableadoMesh
                ? "border-blue-500 focus:ring-2 focus:ring-blue-300"
                : "bg-gray-100 text-gray-500 cursor-not-allowed"
            }`}
          />

          <Input
            type="number"
            name="cat6"
            placeholder="Cat 6 (auto)"
            value={formulario.cat6}
            disabled
            className="bg-gray-100 text-gray-500 cursor-not-allowed"
          />

          <Input
            type="number"
            name="puntosUTP"
            placeholder="Puntos UTP"
            value={formulario.puntosUTP}
            disabled
            className="bg-gray-100 text-gray-500 cursor-not-allowed col-span-2"
          />
        </div>

        <Textarea
          name="observacion"
          placeholder="📝 Observaciones"
          className="w-full p-3 border rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-300 transition min-h-[110px]"
          onChange={handleChange}
        />

        <p className="mt-2 text-sm font-semibold text-gray-600">
          Estado de Liquidación:{" "}
          <span className={formulario.estadoLiquidacion === "Liquidado" ? "text-green-600" : "text-red-500"}>
            {formulario.estadoLiquidacion}
          </span>
        </p>
      </div>

      {/* BARRA DE ACCIONES (sticky) */}
      <div
        className="sticky bottom-0 left-0 right-0 mt-5 -mx-6 border-t bg-white/95 supports-[backdrop-filter]:bg-white/80 backdrop-blur
                   px-6 py-3.5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end
                   shadow-[0_-6px_16px_rgba(0,0,0,0.06)]"
      >
        <div className="flex-1 text-xs text-gray-500">
          {esCorreccion ? "🔧 Modo corrección" : "Listo para liquidar"}
          {hasDuplicates && <span className="ml-2 text-amber-700">• Hay series duplicadas</span>}
        </div>

        <Button
          disabled={procesando || bloqueado}
          onClick={() => (onCancelar?.() ?? onFinalizar?.({ cancelled: true }))}
          className={prettyBar.cancel}
          title="Volver sin guardar"
        >
          <svg className="h-4 w-4 text-gray-500 group-hover:rotate-90 transition-transform" viewBox="0 0 24 24" fill="none">
            <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Cancelar
        </Button>

        <Button
          onClick={handleConfirmar}
          disabled={procesando || hasDuplicates || bloqueado}
          className={prettyBar.confirm(procesando || hasDuplicates || bloqueado)}
          title={hasDuplicates ? "Corrige los SN duplicados" : "Confirmar liquidación"}
        >
          {procesando ? (
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Procesando…
            </span>
          ) : (
            <>
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 00-1.4 0L9 11.6 6.7 9.3A1 1 0 005.3 10.7l3 3a1 1 0 001.4 0l7-7a1 1 0 000-1.4z"
                  clipRule="evenodd"
                />
              </svg>
              ✅ Confirmar Liquidación
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
