// src/app/liquidacion/liquidacion-almacen/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";

import { db } from "@/firebaseConfig";
import {
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp,
  orderBy,
  limit,
} from "firebase/firestore";

import { useAuth } from "@/app/context/AuthContext";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import FormularioLiquidacion from "@/app/components/FormularioLiquidacion";

/* -------------------------- Helpers -------------------------- */
function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const norm = (s = "") => (s || "").toString().trim().toLowerCase();
const toDateLoose = (v) => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const isFinalizada = (estado) => norm(estado) === "finalizada";

// Rango: [start, end) sin plugins
const inRangeInclusiveStart = (m, start, end) => {
  const t = dayjs(m).valueOf();
  return t >= dayjs(start).valueOf() && t < dayjs(end).valueOf();
};

/* --- Tipificaciones y resaltado (Plan) --- */
const TIP_RULES = [
  {
    key: "gamer",
    label: "INTERNETGAMER",
    regex: /INTERNET\s*GAMER|INTERNETGAMER|(^|\s)GAMER(\s|$)/gi,
    chipClass: "bg-emerald-200 text-emerald-900 border-emerald-300",
  },
  {
    key: "mesh",
    label: "SERVICIO CABLEADO DE MESH",
    regex: /SERVICIO\s*CABLEADO\s*DE\s*MESH/gi,
    chipClass: "bg-indigo-200 text-indigo-900 border-indigo-300",
  },
  {
    key: "kit",
    label: "KIT WIFI PRO",
    regex: /KIT\s*WIFI\s*PRO(\s*\((EN\s*VENTA|AL\s*CONTADO)\))?/gi,
    chipClass: "bg-blue-200 text-blue-900 border-blue-300",
  },
];

function detectTipsFromText(s) {
  const text = (s || "");
  return TIP_RULES.reduce((acc, r) => {
    acc[r.key] = r.regex.test(text);
    r.regex.lastIndex = 0; // reset por si se reusa
    return acc;
  }, {});
}

function HighlightPlan({ text }) {
  if (!text) return <span className="text-gray-500">—</span>;
  // aplicamos todas las reglas secuencialmente
  let nodes = [text];
  TIP_RULES.forEach((rule, i) => {
    const next = [];
    nodes.forEach((chunk) => {
      if (typeof chunk !== "string") return next.push(chunk);
      const re = new RegExp(rule.regex); // nueva instancia para no heredar lastIndex
      let last = 0;
      let m;
      // Usar global de verdad
      const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      while ((m = globalRe.exec(chunk)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (start > last) next.push(chunk.slice(last, start));
        next.push(
          <mark
            key={`hl-${i}-${start}-${end}`}
            className={`rounded px-1.5 py-0.5 ${rule.chipClass.replace("border-", "bg-")} `}
            style={{ boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
          >
            {chunk.slice(start, end)}
          </mark>
        );
        last = end;
      }
      if (last < chunk.length) next.push(chunk.slice(last));
    });
    nodes = next;
  });
  return <>{nodes}</>;
}

/* ------------------------- Component ------------------------- */
export default function LiquidacionInstalaciones() {
  const { userData } = useAuth();

  // Filtros
  const [filtros, setFiltros] = useState({
    fecha: dayjs().format("YYYY-MM-DD"),
    cuadrilla: "",
  });
  const debouncedCuadrilla = useDebounce(filtros.cuadrilla);

  // Datos
  const [instalaciones, setInstalaciones] = useState([]);
  const [liquidadasInfo, setLiquidadasInfo] = useState({});
  const [instalacionSeleccionada, setInstalacionSeleccionada] = useState(null);

  // UI
  const [cargando, setCargando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [versionTabla, setVersionTabla] = useState(0);

  // Diagnóstico
  const [lastError, setLastError] = useState(null);
  const [lastQueryInfo, setLastQueryInfo] = useState(null);
  const [compatMode, setCompatMode] = useState(false);

  // KPIs
  const totalFinalizadas = instalaciones.length;
  const totalLiquidadas = useMemo(() => {
    const f = filtros.fecha;
    const c = norm(debouncedCuadrilla);
    let count = 0;
    for (const [, liq] of Object.entries(liquidadasInfo)) {
      if (!liq.fechaInstalacion) continue;
      const fechaOk = dayjs(liq.fechaInstalacion).format("YYYY-MM-DD") === f;
      const cuadrillaOk = !c || norm(liq.cuadrillaNombre).includes(c);
      if (fechaOk && cuadrillaOk) count++;
    }
    return count;
  }, [liquidadasInfo, filtros.fecha, debouncedCuadrilla]);
  const totalPendientes = useMemo(
    () => Math.max(totalFinalizadas - totalLiquidadas, 0),
    [totalFinalizadas, totalLiquidadas]
  );

  /* ------------------------ Data Fetch ------------------------ */
  const obtenerInstalaciones = async () => {
    setCargando(true);
    setLastError(null);
    setCompatMode(false);
    try {
      const dayStart = dayjs(filtros.fecha).startOf("day").toDate();
      const nextDayStart = dayjs(filtros.fecha).add(1, "day").startOf("day").toDate();

      // PLAN A: rango Timestamp
      const ref = collection(db, "instalaciones");
      const qA = query(
        ref,
        where("estado", "==", "Finalizada"),
        where("fechaInstalacion", ">=", Timestamp.fromDate(dayStart)),
        where("fechaInstalacion", "<", Timestamp.fromDate(nextDayStart)),
        orderBy("fechaInstalacion", "asc"),
        limit(800)
      );

      let snap = await getDocs(qA);
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      rows = rows.filter((r) => (r.tipoServicio || "") !== "GARANTIA");

      const qText = norm(debouncedCuadrilla);
      if (qText) {
        rows = rows.filter((r) => norm(r.cuadrillaNombre).includes(qText));
      }

  
      // Fallback si no vino nada
if (snap.size === 0) {
  // PLAN B: rango por STRING (asumiendo formato YYYY-MM-DD o ISO que empieza con YYYY-MM-DD)
  const startStr = dayjs(filtros.fecha).format("YYYY-MM-DD");
  const endStr = dayjs(filtros.fecha).add(1, "day").format("YYYY-MM-DD");

  const qB = query(
    ref,
    where("estado", "in", ["Finalizada", "finalizada"]),
    where("fechaInstalacion", ">=", startStr),
    where("fechaInstalacion", "<", endStr),
    orderBy("fechaInstalacion", "asc"),
    limit(800)
  );

  snap = await getDocs(qB);
  let all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  all = all.filter((r) => (r.tipoServicio || "") !== "GARANTIA");

  const qText = norm(debouncedCuadrilla);
  if (qText) all = all.filter((r) => norm(r.cuadrillaNombre).includes(qText));

  rows = all;
  setCompatMode(true);
}


      setLastQueryInfo({
        fecha: filtros.fecha,
        cuadrilla: filtros.cuadrilla || "(sin filtro)",
        fetched: snap.size,
        afterClientFilter: rows.length,
      });

      setInstalaciones(rows);
      setVersionTabla((v) => v + 1);

      if (rows.length === 0) {
        toast(
          (t) => (
            <div className="text-sm">
              <b>Sin resultados</b>
              <br />
              Fecha: {filtros.fecha}
              <br />
              Cuadrilla: {filtros.cuadrilla || "(sin filtro)"}
              <div className="mt-2">
                <button
                  className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
                  onClick={() => toast.dismiss(t.id)}
                >
                  Entendido
                </button>
              </div>
            </div>
          ),
          { duration: 4500 }
        );
      }
    } catch (error) {
      console.error("Error al obtener instalaciones:", error);
      setLastError(error?.message || String(error));
      toast.error("No se pudieron cargar las instalaciones.");
    } finally {
      setCargando(false);
    }
  };

  // Liquidadas (mismo enfoque con fallback)
  useEffect(() => {
    const dayStart = dayjs(filtros.fecha).startOf("day").toDate();
    const nextDayStart = dayjs(filtros.fecha).add(1, "day").startOf("day").toDate();

    const ref = collection(db, "liquidacion_instalaciones");
    const qLiq = query(
      ref,
      where("fechaInstalacion", ">=", Timestamp.fromDate(dayStart)),
      where("fechaInstalacion", "<", Timestamp.fromDate(nextDayStart)),
      orderBy("fechaInstalacion", "asc"),
      limit(2000)
    );

    const unsub = onSnapshot(
      qLiq,
      async (snapshot) => {
        if (snapshot.empty) {
  const startStr = dayjs(filtros.fecha).format("YYYY-MM-DD");
  const endStr = dayjs(filtros.fecha).add(1, "day").format("YYYY-MM-DD");

  const qB = query(
    ref,
    where("fechaInstalacion", ">=", startStr),
    where("fechaInstalacion", "<", endStr),
    orderBy("fechaInstalacion", "asc"),
    limit(2000)
  );

  const snapB = await getDocs(qB);

  const info = {};
  snapB.docs.forEach((d) => {
    const data = d.data();
    const fecha = toDateLoose(data.fechaInstalacion);
    info[d.id] = {
      corregido: data.corregido === true,
      fechaInstalacion: fecha,
      fechaLiquidacion: toDateLoose(data.fechaLiquidacion),
      cuadrillaNombre: data.cuadrillaNombre || "",
    };
  });

  setLiquidadasInfo(info);
  return;
}


        const info = {};
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const fecha = toDateLoose(data.fechaInstalacion);
          info[d.id] = {
            corregido: data.corregido === true,
            fechaInstalacion: fecha,
            fechaLiquidacion: toDateLoose(data.fechaLiquidacion),
            cuadrillaNombre: data.cuadrillaNombre || "",
          };
        });
        setLiquidadasInfo(info);
      },
      (err) => {
        console.error("onSnapshot(liquidaciones) error:", err);
        setLastError(err?.message || String(err));
      }
    );

    return () => unsub();
  }, [filtros.fecha]);

  useEffect(() => {
    obtenerInstalaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.fecha, debouncedCuadrilla]);

  /* ---------------------- Acciones (UX) ----------------------- */
  const manejarLiquidacion = (inst) => {
    if (liquidadasInfo.hasOwnProperty(inst.codigoCliente)) {
      toast("Esta instalación ya fue liquidada.");
      return;
    }
    setInstalacionSeleccionada(inst);
  };

  const manejarCorreccion = (instalacion) => {
    toast(
      (t) => (
        <div className="p-4 max-w-xs">
          <p className="font-semibold mb-2">🔧 ¿Confirmar corrección?</p>
          <p className="text-sm text-gray-700 mb-4">
            ¿Corregir la liquidación de <strong>{instalacion.cliente}</strong>?
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="bg-gray-200 text-gray-800 px-3 py-1 rounded hover:bg-gray-300"
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
      ),
      { duration: 10000, position: "top-center" }
    );
  };

  const procesarCorreccion = async (instalacion) => {
    try {
      setProcesando(true);
      const loadingId = toast.loading("Procesando corrección...");

      const docRef = doc(db, "liquidacion_instalaciones", instalacion.codigoCliente);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        toast.dismiss(loadingId);
        setProcesando(false);
        return toast.error("No se encontró la liquidación.");
      }

      const datosLiquidacion = docSnap.data();
      const snEquipos = [
        datosLiquidacion.snONT,
        ...(datosLiquidacion.snMESH || []),
        ...(datosLiquidacion.snBOX || []),
        datosLiquidacion.snFONO,
      ].filter(Boolean);

      for (const sn of snEquipos) {
        const qEq = query(collection(db, "equipos"), where("SN", "==", sn), limit(1));
        const qry = await getDocs(qEq);

        if (!qry.empty) {
          const equipoDoc = qry.docs[0];
          const equipoData = equipoDoc.data();

          const stockRef = doc(db, `cuadrillas/${instalacion.cuadrillaId}/stock_equipos`, sn);
          await setDoc(stockRef, {
            ...equipoData,
            devueltoPor:
              `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim() ||
              userData?.email ||
              "sistema",
            fechaDevolucion: serverTimestamp(),
          });

          await updateDoc(equipoDoc.ref, {
            estado: "campo",
            ubicacion: instalacion.cuadrillaNombre || instalacion.cuadrillaId,
          });
        }
      }

      await updateDoc(docRef, {
        corregido: true,
        correccionFecha: serverTimestamp(),
        corregidoPor:
          `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim() ||
          userData?.email ||
          "sistema",
      });

      await addDoc(collection(db, "notificaciones"), {
        tipo: "Corrección",
        mensaje: `🔧 Se corrigió la liquidación de ${instalacion.cliente}.`,
        codigoCliente: instalacion.codigoCliente,
        usuario:
          `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim() ||
          userData?.email ||
          "sistema",
        fecha: serverTimestamp(),
      });

      toast.dismiss(loadingId);
      toast.success("✅ Liquidación corregida exitosamente.");

      setLiquidadasInfo((prev) => ({
        ...prev,
        [instalacion.codigoCliente]: {
          ...(prev[instalacion.codigoCliente] || {}),
          corregido: true,
        },
      }));

      setInstalacionSeleccionada({ ...instalacion, esCorreccion: true });
    } catch (error) {
      console.error("Error al corregir la liquidación:", error);
      toast.error("❌ Ocurrió un error al corregir la liquidación.");
    } finally {
      setProcesando(false);
    }
  };

  // estilos compactos para acciones de la tabla
  const btnStyles = {
    primary:
      "w-full sm:w-auto group inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg " +
      "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-sm " +
      "hover:from-blue-700 hover:to-indigo-700 active:scale-[.98] " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",

    success:
      "w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg " +
      "border border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold shadow-sm " +
      "hover:bg-emerald-100 disabled:opacity-70",

    warning:
      "w-full sm:w-auto group inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg " +
      "border border-amber-500 bg-amber-500 text-white font-semibold shadow-sm " +
      "hover:bg-amber-600 active:scale-[.98] " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
  };

  /* -------------------------- Render -------------------------- */
  return (
    <div className="p-6 relative">
      {(cargando || procesando) && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-900 rounded-xl p-6 shadow-2xl w-[280px] text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-4 border-gray-200 border-t-blue-600 animate-spin" />
            <p className="font-medium text-gray-800 dark:text-gray-100">
              {procesando ? "Procesando..." : "Cargando..."}
            </p>
            <p className="text-xs text-gray-500 mt-1">Por favor espera</p>
          </div>
        </div>
      )}

      {instalacionSeleccionada ? (
        <div>
          <Button onClick={() => setInstalacionSeleccionada(null)} className="mb-4" variant="outline">
            ← Volver
          </Button>

          <FormularioLiquidacion
            instalacion={instalacionSeleccionada}
            onCancelar={() => setInstalacionSeleccionada(null)}
            onFinalizar={(res) => {
              setInstalacionSeleccionada(null);
              obtenerInstalaciones(); // refresca la lista de finalizadas

              // Optimista
              if (res?.estado === "Liquidado" && res?.codigoCliente) {
                setLiquidadasInfo((prev) => ({
                  ...prev,
                  [res.codigoCliente]: {
                    corregido: false,
                    fechaInstalacion: res.fechaInstalacion,
                    fechaLiquidacion: new Date(),
                    cuadrillaNombre: res.cuadrillaNombre || "",
                  },
                }));
              }
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-2xl font-bold tracking-tight">Liquidación de Instalaciones</h1>
          </div>

          <div className="sticky top-0 z-10 bg-white/80 dark:bg-neutral-950/80 backdrop-blur rounded-xl border p-4 mb-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">Fecha</label>
                <Input
                  type="date"
                  value={filtros.fecha}
                  onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">Buscar cuadrilla</label>
                <Input
                  placeholder="Ej. TOP 02, KS RESIDE…"
                  value={filtros.cuadrilla}
                  onChange={(e) => setFiltros((f) => ({ ...f, cuadrilla: e.target.value }))}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={obtenerInstalaciones} disabled={cargando}>
                  {cargando ? "Cargando..." : "Buscar"}
                </Button>
              </div>
            </div>
          </div>

          {(lastError || lastQueryInfo) && (
            <div className="mb-3 rounded-lg border p-3 text-xs bg-gray-50 dark:bg-neutral-900">
              {lastError ? (
                <div className="text-red-600">
                  <b>Último error:</b> {lastError}
                  <Button className="ml-3" size="sm" variant="outline" onClick={obtenerInstalaciones}>
                    Reintentar
                  </Button>
                </div>
              ) : (
                <div className="text-gray-600 dark:text-gray-300">
                  <b>Consulta:</b> Fecha={lastQueryInfo?.fecha} | Cuadrilla={lastQueryInfo?.cuadrilla} |{" "}
                  Docs Firestore={lastQueryInfo?.fetched} | Tras filtros={lastQueryInfo?.afterClientFilter}
                  {compatMode && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">
                      Modo compatibilidad (fecha string)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard color="blue" title="Finalizadas" value={totalFinalizadas} />
            <KpiCard color="green" title="Liquidadas" value={totalLiquidadas} />
            <KpiCard color="red" title="Pendientes" value={totalPendientes} />
          </div>

          <div className="overflow-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-neutral-900 sticky top-0 z-[1]">
                <tr className="text-left">
                  <Th>Código</Th>
                  <Th>Cliente</Th>
                  <Th>Dirección</Th>
                  <Th>Plan</Th>
                  <Th>Cuadrilla</Th>
                  <Th>Categoría</Th>
                  <Th className="text-center">Acción</Th>
                </tr>
              </thead>

              <tbody key={versionTabla} className="divide-y">
                {cargando ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="animate-pulse">
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-24" /></td>
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-40" /></td>
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-64" /></td>
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-20" /></td>
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-32" /></td>
                      <td className="p-3"><div className="h-3 bg-gray-200 rounded w-20" /></td>
                      <td className="p-3 text-center"><div className="h-8 bg-gray-200 rounded w-24 mx-auto" /></td>
                    </tr>
                  ))
                ) : instalaciones.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-6 text-gray-500">
                      Sin resultados para <b>{filtros.fecha}</b>
                      {filtros.cuadrilla ? <> y cuadrilla <b>{filtros.cuadrilla}</b></> : null}.
                      <div className="mt-3 flex gap-2 justify-center">
                        <Button size="sm" variant="outline" onClick={obtenerInstalaciones}>
                          Reintentar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setFiltros((f) => ({ ...f, cuadrilla: "" }))}
                        >
                          Limpiar filtro de cuadrilla
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  instalaciones.map((inst) => {
                    const estaLiquidado = liquidadasInfo.hasOwnProperty(inst.codigoCliente);
                    const estaCorregido = liquidadasInfo[inst.codigoCliente]?.corregido === true;

                    const tips = detectTipsFromText(inst.plan || "");

                    return (
                      <tr key={inst.id} className="hover:bg-gray-50/60">
                        <Td><code className="font-semibold">{inst.codigoCliente}</code></Td>
                        <Td>{inst.cliente}</Td>
                        {/* DIRECCIÓN completa (sin truncar) */}
<Td className="align-top">
  <div
    className="max-w-[520px] whitespace-pre-line break-words leading-snug"
    title={inst.direccion}
  >
    {inst.direccion}
  </div>
</Td>

                        {/* PLAN con resaltado + chips (sin truncar) */}
<Td className="align-top">
  <div
    className="max-w-[720px] whitespace-pre-line break-words leading-snug"
    title={inst.plan}
  >
    <HighlightPlan text={inst.plan?.split("|").join("\n")} />
  </div>

  {(tips.gamer || tips.mesh || tips.kit) && (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {tips.gamer && (
        <Chip className="border-emerald-300 bg-emerald-200 text-emerald-900">
          INTERNETGAMER
        </Chip>
      )}
      {tips.mesh && (
        <Chip className="border-indigo-300 bg-indigo-200 text-indigo-900">
          SERVICIO CABLEADO DE MESH
        </Chip>
      )}
      {tips.kit && (
        <Chip className="border-blue-300 bg-blue-200 text-blue-900">
          KIT WIFI PRO
        </Chip>
      )}
    </div>
  )}
</Td>


                        <Td>
                          <span className="inline-flex items-center gap-2">
                            {inst.cuadrillaNombre}
                            {estaLiquidado ? (
                              <Badge color="green">Liquidado</Badge>
                            ) : (
                              <Badge color="orange">Pendiente</Badge>
                            )}
                            {estaCorregido && <Badge color="yellow">Corregida</Badge>}
                          </span>
                        </Td>
                        <Td>{inst.residencialCondominio || "N/A"}</Td>

                        <Td className="text-center">
                          {estaLiquidado ? (
                            <div className="flex flex-col sm:flex-row gap-2 justify-center">
                              <Button disabled className={btnStyles.success} title="Instalación ya liquidada">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L9 11.586 6.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l7-7a1 1 0 000-1.414z" clipRule="evenodd" />
                                </svg>
                                <span className="whitespace-nowrap">Liquidado</span>
                              </Button>

                              <Button
                                className={btnStyles.warning}
                                onClick={() => manejarCorreccion(inst)}
                                title="Registrar corrección de la liquidación"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5 9a7 7 0 0112.908-2.917M19 15a7 7 0 01-12.908 2.917" />
                                </svg>
                                <span className="whitespace-nowrap">Corregir</span>
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className={btnStyles.primary}
                              onClick={() => manejarLiquidacion(inst)}
                              title="Abrir formulario de liquidación"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M9 2a1 1 0 00-1 1v3H5a1 1 0 000 2h3v3a1 1 0 002 0V8h3a1 1 0 100-2h-3V3a1 1 0 00-1-1z" />
                              </svg>
                              <span className="whitespace-nowrap">Liquidar</span>
                            </Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------- Sub-UI --------------------------- */
function Th({ children, className = "" }) {
  return (
    <th
      className={
        "p-3 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 " +
        className
      }
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }) {
  return <td className={"p-3 align-middle " + className}>{children}</td>;
}
function Badge({ color = "gray", children }) {
  const map = {
    gray: "bg-gray-100 text-gray-700 border-gray-200",
    green: "bg-green-100 text-green-800 border-green-200",
    yellow: "bg-yellow-100 text-yellow-800 border-yellow-200",
    orange: "bg-orange-100 text-orange-800 border-orange-200",
    blue: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
        (map[color] || map.gray)
      }
    >
      {children}
    </span>
  );
}
function KpiCard({ color = "blue", title, value }) {
  const bg = {
    blue: "bg-blue-50/60 dark:bg-blue-950/20",
    green: "bg-green-50/60 dark:bg-green-950/20",
    red: "bg-red-50/60 dark:bg-red-950/20",
  }[color];
  const text = {
    blue: "text-blue-700 dark:text-blue-300",
    green: "text-green-700 dark:text-green-300",
    red: "text-red-700 dark:text-red-300",
  }[color];
  const val = {
    blue: "text-blue-900 dark:text-blue-100",
    green: "text-green-900 dark:text-green-100",
    red: "text-red-900 dark:text-red-100",
  }[color];

  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className={`text-sm ${text}`}>{title}</p>
      <p className={`text-3xl font-bold ${val} text-center`}>{value}</p>
    </div>
  );
}
function Chip({ className = "", children }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-4 ${className}`}>
      {children}
    </span>
  );
}
