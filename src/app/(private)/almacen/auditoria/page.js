// src/app/almacen/auditoria/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/context/AuthContext";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp,
  deleteField,
  updateDoc,
} from "firebase/firestore";
import { ref, deleteObject, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/firebaseConfig";

import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";
import * as XLSX from "xlsx";
import { format } from "date-fns";

/* ==================== Helpers ==================== */

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toSN = (v) => String(v ?? "").trim().toUpperCase();

const parseFecha = (val) => {
  if (!val) return "";
  if (val?.toDate) return format(val.toDate(), "d/M/yyyy");
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : format(d, "d/M/yyyy");
};

const parseFechaHora = (val) => {
  if (!val) return "";
  if (val?.toDate) return format(val.toDate(), "d/M/yyyy HH:mm");
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : format(d, "d/M/yyyy HH:mm");
};

// Construye refs candidatas para borrar la foto de Storage
const buildAuditoriaRefs = (equipo) => {
  const refs = [];
  const p = equipo?.auditoria?.fotoPath;
  if (typeof p === "string" && p.trim()) refs.push(ref(storage, p));
  const u = equipo?.auditoria?.fotoURL;
  if (typeof u === "string" && u.trim()) refs.push(ref(storage, u)); // http(s) o gs://
  const sn = toSN(equipo?.SN);
  if (sn) {
    refs.push(ref(storage, `auditoria/${sn}.jpg`));
    refs.push(ref(storage, `auditoria/${sn}.png`));
  }
  // dedup
  const m = new Map();
  refs.forEach((r) => m.set(r.fullPath || r.toString(), r));
  return [...m.values()];
};

const borrarFotoAuditoriaSiExiste = async (equipo) => {
  const refs = buildAuditoriaRefs(equipo);
  for (const r of refs) {
    try {
      await deleteObject(r);
      return true;
    } catch (err) {
      if (
        err?.code === "storage/object-not-found" ||
        err?.code === "storage/unauthorized"
      )
        continue;
      throw err;
    }
  }
  return false;
};

/* ==================== Página ==================== */

export default function AuditoriaPage() {
  const { userData } = useAuth();

  const [equipos, setEquipos] = useState([]); // solo requiere === true
  const [filtroEstadoAud, setFiltroEstadoAud] = useState("todos"); // todos|pendiente|sustentada
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(false);
  const [filtroUbicacion, setFiltroUbicacion] = useState("todas"); // ubicación general
  const [filtroEstadoGeneral, setFiltroEstadoGeneral] = useState("todos"); // estado general
  const [excluirInstalados, setExcluirInstalados] = useState(true); // no contar instalados

  // Excel
  const [fileName, setFileName] = useState("");
  const [snExcel, setSnExcel] = useState([]); // preview SN
  const [procesando, setProcesando] = useState(false);

  // Controlamos subida de foto por fila
  const [subiendoId, setSubiendoId] = useState(null);

  // Modal para ver foto
  const [fotoModal, setFotoModal] = useState({
    open: false,
    url: "",
    sn: "",
  });

  // Observaciones editadas (por id de equipo)
  const [obsDraft, setObsDraft] = useState({});

  // Cargar equipos con auditoría activa
  const cargar = async () => {
    setLoading(true);
    try {
      const qRef = query(
        collection(db, "equipos"),
        where("auditoria.requiere", "==", true)
      );
      const snap = await getDocs(qRef);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEquipos(rows);

      // Inicializar/mezclar observaciones sin perder lo ya escrito
      setObsDraft((prev) => {
        const next = { ...prev };
        rows.forEach((e) => {
          if (next[e.id] === undefined) {
            next[e.id] = e.observacion || "";
          }
        });
        return next;
      });
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cargar auditorías");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ========== Métricas y listas para filtros ========== */

  // Base común para listas (respetando excluirInstalados y estadoAuditoria)
  const baseParaListas = useMemo(() => {
    let list = [...equipos];

    if (excluirInstalados) {
      list = list.filter(
        (e) => (e?.estado ?? "").toString().toUpperCase() !== "INSTALADO"
      );
    }

    if (filtroEstadoAud !== "todos") {
      list = list.filter((e) => e?.auditoria?.estado === filtroEstadoAud);
    }

    return list;
  }, [equipos, excluirInstalados, filtroEstadoAud]);

  // KPIs
  const kpis = useMemo(() => {
    const base = baseParaListas;
    const total = base.length;
    const pend = base.filter((e) => e?.auditoria?.estado === "pendiente").length;
    const sust = base.filter((e) => e?.auditoria?.estado === "sustentada").length;
    return { total, pend, sust };
  }, [baseParaListas]);

  // Listas únicas para selects
  const ubicacionesDisponibles = useMemo(
    () =>
      [...new Set(baseParaListas.map((e) => e?.ubicacion).filter(Boolean))].sort(),
    [baseParaListas]
  );

  const estadosGenerales = useMemo(
    () =>
      [...new Set(baseParaListas.map((e) => e?.estado).filter(Boolean))].sort(),
    [baseParaListas]
  );

  // Filtrado principal
  const equiposFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return equipos.filter((e) => {
      if (
        excluirInstalados &&
        (e?.estado ?? "").toString().toUpperCase() === "INSTALADO"
      ) {
        return false;
      }

      const okEstadoAud =
        filtroEstadoAud === "todos"
          ? true
          : e?.auditoria?.estado === filtroEstadoAud;
      const okUbic =
        filtroUbicacion === "todas"
          ? true
          : (e?.ubicacion ?? "") === filtroUbicacion;
      const okEstadoGen =
        filtroEstadoGeneral === "todos"
          ? true
          : (e?.estado ?? "") === filtroEstadoGeneral;
      const okQ =
        !q ||
        (e?.SN ?? "").toLowerCase().includes(q) ||
        (e?.equipo ?? "").toLowerCase().includes(q) ||
        (e?.ubicacion ?? "").toLowerCase().includes(q);

      return okEstadoAud && okUbic && okEstadoGen && okQ;
    });
  }, [
    equipos,
    filtroEstadoAud,
    filtroUbicacion,
    filtroEstadoGeneral,
    busqueda,
    excluirInstalados,
  ]);

  /* ========== Acciones por fila ========== */

  const limpiarAuditoriaUno = async (equipo) => {
    try {
      if (!equipo?.id) return;

      // 1) Borrar foto si existe (ignora not-found)
      try {
        await borrarFotoAuditoriaSiExiste(equipo);
      } catch (_) {
        /* noop */
      }

      // 2) Quitar campo auditoria en Firestore
      await updateDoc(doc(db, "equipos", equipo.id), { auditoria: deleteField() });

      // 3) Reflejar en UI: quitamos la fila (esta vista muestra solo equipos en auditoría)
      setEquipos((prev) => prev.filter((x) => x.id !== equipo.id));

      toast.success(`SN ${equipo.SN}: auditoría limpiada`);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo limpiar la auditoría de este equipo");
    }
  };

  // Subir foto (con opción de marcar sustentado o solo actualizarla)
  const subirFotoAuditoria = async (equipo, file, { marcarSustentado }) => {
    if (!equipo?.id || !file) return;

    const sn = toSN(equipo.SN);
    if (!sn) {
      toast.error("El equipo no tiene SN válido");
      return;
    }

    setSubiendoId(equipo.id);
    try {
      // Borrar foto anterior, si hubiera
      try {
        await borrarFotoAuditoriaSiExiste(equipo);
      } catch (_) {}

      // Elegir extensión simple
      let ext = "jpg";
      if (
        file.type === "image/png" ||
        file.name?.toLowerCase().endsWith(".png")
      ) {
        ext = "png";
      }

      const path = `auditoria/${sn}.${ext}`;
      const storageRef = ref(storage, path);

      // Subir a Storage
      await uploadBytes(storageRef, file);

      // Obtener URL
      const url = await getDownloadURL(storageRef);

      // Construir objeto auditoria (respetando lo que ya hay)
      const auditoriaBase = equipo.auditoria || {};
      const auditoriaUpdate = {
        ...auditoriaBase,
        fotoPath: path,
        fotoURL: url,
        actualizadoEn: serverTimestamp(),
      };

      if (marcarSustentado) {
        auditoriaUpdate.estado = "sustentada";
        auditoriaUpdate.requiere = true;
      }

      await updateDoc(doc(db, "equipos", equipo.id), {
        auditoria: auditoriaUpdate,
      });

      // Actualizamos en estado local
      setEquipos((prev) =>
        prev.map((x) => (x.id === equipo.id ? { ...x, auditoria: auditoriaUpdate } : x))
      );

      toast.success(
        marcarSustentado
          ? `SN ${sn} sustentado correctamente`
          : `Foto de auditoría actualizada para SN ${sn}`
      );
    } catch (e) {
      console.error(e);
      toast.error("No se pudo subir la foto de auditoría");
    } finally {
      setSubiendoId(null);
    }
  };

  /* ========== Subir Excel: leer SN ========== */

  const onFile = async (file) => {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const sns = rows
        .map((r) => toSN(r.SN ?? r.sn ?? r.Sn ?? r["sn "] ?? r["SN "]))
        .filter((v) => !!v);
      const unique = [...new Set(sns)];
      if (unique.length === 0) {
        toast.error("No se encontraron SN válidos en el Excel");
        setFileName("");
        setSnExcel([]);
        return;
      }
      setFileName(file.name);
      setSnExcel(unique);
      toast.success(`Leídos ${unique.length} SN únicos`);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo leer el Excel");
    }
  };

  /* ========== Resolver SN → docId ========== */

  const resolverSNs = async (sns) => {
    const mapa = new Map(); // SN -> { id, data }
    const noEncontrados = new Set(sns);

    for (const group of chunk(sns, 10)) {
      const qRef = query(collection(db, "equipos"), where("SN", "in", group));
      const snap = await getDocs(qRef);
      snap.forEach((d) => {
        const data = d.data();
        const sn = toSN(data.SN);
        if (sn) {
          mapa.set(sn, { id: d.id, data });
          noEncontrados.delete(sn);
        }
      });
    }
    return { mapa, noEncontrados: [...noEncontrados] };
  };

  /* ========== Marcar masivo (como “Sustentar”) ========== */

  const marcarMasivo = async () => {
    if (snExcel.length === 0) {
      toast.error("Primero sube un Excel con SN");
      return;
    }
    setProcesando(true);
    try {
      const { mapa, noEncontrados } = await resolverSNs(snExcel);
      const porMarcar = snExcel.filter((sn) => mapa.has(sn));
      if (porMarcar.length === 0) {
        toast.error("Ningún SN del Excel existe en la base");
        setProcesando(false);
        return;
      }

      let ok = 0;

      // Batches en grupos de 400 (updates) + 400 (notificaciones)
      for (const grupo of chunk(porMarcar, 400)) {
        const batch = writeBatch(db);
        const batchNotif = writeBatch(db);

        grupo.forEach((sn) => {
          const { id, data } = mapa.get(sn);
          const equipoDoc = doc(db, "equipos", id);

          batch.set(
            equipoDoc,
            {
              auditoria: {
                requiere: true,
                estado: "pendiente",
                fotoPath: `auditoria/${sn}.jpg`,
                fotoURL: data?.auditoria?.fotoURL || "",
                marcadoPor: userData?.uid || "",
                actualizadoEn: serverTimestamp(),
              },
            },
            { merge: true }
          );

          // Notificación por SN
          const notifDoc = doc(collection(db, "notificaciones"));
          batchNotif.set(notifDoc, {
            tipo: "Auditoría - Marcar SN",
            mensaje: `🔎 ${userData?.nombres ?? ""} ${
              userData?.apellidos ?? ""
            } marcó el SN ${sn} para auditoría.`,
            usuario: `${userData?.nombres ?? ""} ${
              userData?.apellidos ?? ""
            }`.trim(),
            fecha: serverTimestamp(),
            visto: false,
            detalles: {
              sn,
              equipo: data?.equipo || "",
              de: data?.ubicacion || "",
              a: "auditoría pendiente",
            },
          });
        });

        await batch.commit();
        await batchNotif.commit();
        ok += grupo.length;
        toast(`Marcados ${ok}/${porMarcar.length}`, { icon: "✅" });
      }

      if (noEncontrados.length) {
        console.warn("SN no encontrados:", noEncontrados);
        toast(`No encontrados: ${noEncontrados.length}`, { icon: "⚠️" });
      }

      await cargar();
      toast.success(
        `Marcado masivo completado. OK: ${ok} • No encontrados: ${noEncontrados.length}`
      );
      setSnExcel([]);
      setFileName("");
    } catch (e) {
      console.error(e);
      toast.error("Fallo el marcado masivo");
    } finally {
      setProcesando(false);
    }
  };

  /* ========== Plantilla Excel (SN) ========== */

  const descargarPlantillaSN = () => {
    try {
      const rows = [{ SN: "EjemploSN001234567" }, { SN: "EjemploSN001234568" }];
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "PLANTILLA_SN");
      XLSX.writeFile(wb, "PLANTILLA-AUDITORIA-SN.xlsx");
      toast.success("Plantilla descargada");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar la plantilla");
    }
  };

  /* ========== Export manifest (Excel con links) ========== */

  const exportManifest = () => {
    // Orden de columnas:
    // SN | Equipo | F. Despacho | Técnicos | Ubicación | Estado | Auditoría | Observacion | FotoURL
    const rows = equiposFiltrados.map((e) => [
      e.SN,
      e.equipo || "",
      parseFecha(e.f_despacho),
      Array.isArray(e.tecnicos) ? e.tecnicos.join(", ") : e.tecnicos || "",
      e.ubicacion || "",
      e.estado || "",
      e?.auditoria?.estado || "pendiente",
      e?.observacion || "",
      e?.auditoria?.fotoURL || "",
    ]);

    if (rows.length === 0) {
      toast.error("No hay filas para exportar");
      return;
    }

    const header = [
      "SN",
      "Equipo",
      "F. Despacho",
      "Técnicos",
      "Ubicación",
      "Estado",
      "Auditoría",
      "Observacion",
      "FotoURL",
    ];

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();

    // Convertir la columna FotoURL en fórmula HYPERLINK
    const ref = ws["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      const FOTO_COL_INDEX = 8; // 0..8 → FotoURL

      for (let R = 1; R <= range.e.row; ++R) {
        const addr = XLSX.utils.encode_cell({ r: R, c: FOTO_COL_INDEX });
        const cell = ws[addr];
        if (cell && typeof cell.v === "string" && cell.v.startsWith("http")) {
          const url = cell.v;
          ws[addr] = {
            t: "s",
            v: "Ver foto",
            f: `HYPERLINK("${url}","Ver foto")`,
          };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "AUDITORIA");
    XLSX.writeFile(
      wb,
      `AUDITORIA-MANIFEST-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    toast.success("Exportado");
  };

  /* ========== Guardar observaciones en lote ========== */

  const guardarObservaciones = async () => {
    try {
      setProcesando(true);

      const batch = writeBatch(db);
      let cambios = 0;

      equipos.forEach((e) => {
        const nuevo = obsDraft[e.id] ?? "";
        const actual = e.observacion ?? "";
        if (nuevo !== actual) {
          batch.update(doc(db, "equipos", e.id), { observacion: nuevo });
          cambios++;
        }
      });

      if (cambios === 0) {
        toast("No hay cambios por guardar");
        return;
      }

      await batch.commit();

      // Reflejar en estado local
      setEquipos((prev) =>
        prev.map((e) => ({
          ...e,
          observacion: obsDraft[e.id] ?? e.observacion ?? "",
        }))
      );

      toast.success(`Observaciones guardadas (${cambios} cambios)`);
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron guardar las observaciones");
    } finally {
      setProcesando(false);
    }
  };

  /* ========== Nueva auditoría (limpieza masiva + borrar fotos) ========== */

  const nuevaAuditoria = async () => {
    if (equipos.length === 0) {
      toast("No hay equipos en auditoría para limpiar");
      return;
    }
    const confirmar = window.confirm(
      `Esto eliminará el campo "auditoria" en Firestore y borrará las fotos en Storage para ${equipos.length} equipos. ¿Continuar?`
    );
    if (!confirmar) return;

    setProcesando(true);
    try {
      // 1) Borrar fotos en paralelo por lotes pequeños
      let fotosBorradas = 0;
      for (const grupo of chunk(equipos, 25)) {
        await Promise.all(
          grupo.map(async (e) => {
            try {
              const ok = await borrarFotoAuditoriaSiExiste(e);
              if (ok) fotosBorradas++;
            } catch (_) {}
          })
        );
      }

      // 2) Borrar campo auditoria en batches
      let limpiados = 0;
      for (const grupo of chunk(equipos, 450)) {
        const batch = writeBatch(db);
        grupo.forEach((e) => {
          batch.update(doc(db, "equipos", e.id), { auditoria: deleteField() });
        });
        await batch.commit();
        limpiados += grupo.length;
        toast(`Limpios ${limpiados}/${equipos.length}`, { icon: "🧹" });
      }

      await cargar();
      toast.success(
        `Nueva auditoría lista. Limpiados: ${limpiados}. Fotos borradas: ${fotosBorradas}.`
      );
    } catch (e) {
      console.error(e);
      toast.error("Error al limpiar auditoría");
    } finally {
      setProcesando(false);
    }
  };

  /* ==================== UI ==================== */

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-screen">
      <Toaster position="top-right" />

      {/* Header */}
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h2 className="text-2xl font-semibold text-slate-900">
      📋 Auditoría de Equipos
    </h2>
    <p className="text-sm text-slate-500">
      Gestiona los equipos observados, sustenta con fotos y controla el avance
      de la auditoría de manera centralizada.
    </p>
  </div>

  <div className="flex flex-wrap gap-2">
    {/* Actualizar */}
    <Button
      type="button"
      variant="outline"
      className="flex items-center gap-2 rounded-full border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      onClick={cargar}
      disabled={loading || procesando}
    >
      <span>🔄</span>
      <span>Actualizar</span>
    </Button>

    {/* Nueva auditoría */}
    <Button
      type="button"
      className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
      onClick={nuevaAuditoria}
      disabled={procesando}
    >
      <span>🧹</span>
      <span>Nueva auditoría</span>
    </Button>

    {/* Guardar cambios de observaciones (si ya lo tienes implementado) */}
    <Button
      type="button"
      className="flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
      onClick={guardarObservaciones}
      disabled={procesando}
    >
      <span>💾</span>
      <span>Guardar cambios</span>
    </Button>
  </div>
</div>


      {/* KPIs + toggle instalados */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-slate-500">
            En auditoría (según filtros)
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {kpis.total}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-amber-600">Pendientes</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">
            {kpis.pend}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-emerald-600">Sustentadas</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">
            {kpis.sust}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow-sm flex items-center">
          <label className="flex items-center gap-2 text-xs sm:text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              checked={excluirInstalados}
              onChange={(e) => setExcluirInstalados(e.target.checked)}
            />
            <span>
              No contar equipos{" "}
              <span className="font-semibold">instalados</span> en auditoría
            </span>
          </label>
        </div>
      </div>

      {/* Filtros & acciones */}
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Estado de la auditoría */}
          <div className="flex flex-col text-xs">
            <span className="text-slate-500 mb-1">Estado auditoría</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              value={filtroEstadoAud}
              onChange={(e) => setFiltroEstadoAud(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="sustentada">Sustentada</option>
            </select>
          </div>

          {/* Estado general */}
          <div className="flex flex-col text-xs">
            <span className="text-slate-500 mb-1">Estado general</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              value={filtroEstadoGeneral}
              onChange={(e) => setFiltroEstadoGeneral(e.target.value)}
            >
              <option value="todos">Todos</option>
              {estadosGenerales.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Ubicación */}
          <div className="flex flex-col text-xs">
            <span className="text-slate-500 mb-1">Ubicación</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              value={filtroUbicacion}
              onChange={(e) => setFiltroUbicacion(e.target.value)}
            >
              <option value="todas">Todas</option>
              {ubicacionesDisponibles.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Búsqueda */}
          <div className="flex-1 min-w-[220px]">
            <span className="mb-1 block text-xs text-slate-500">Buscar</span>
            <Input
              className="w-full"
              placeholder="🔍 SN, equipo o ubicación"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>

        {/* Zona Excel / acciones masivas */}
<div className="mt-2 flex flex-wrap items-center gap-2 justify-between border-t pt-3">
  <div className="flex flex-wrap gap-2">
    {/* Exportar Excel */}
    <Button
      type="button"
      onClick={exportManifest}
      className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
    >
      <span>📤</span>
      <span>Exportar Excel (con links)</span>
    </Button>

    {/* Plantilla SN */}
    <Button
      type="button"
      variant="outline"
      className="flex items-center gap-2 rounded-full border-slate-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
      onClick={descargarPlantillaSN}
    >
      <span>📄</span>
      <span>Descargar plantilla SN</span>
    </Button>

    {/* Cargar Excel SN */}
    <label className="flex cursor-pointer items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
      <span>📥</span>
      <span>Cargar Excel (SN)</span>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>

    {/* Marcar SN */}
    <Button
      type="button"
      disabled={snExcel.length === 0 || procesando}
      onClick={marcarMasivo}
      className="flex items-center gap-2 rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-fuchsia-600 disabled:opacity-60"
    >
      <span>⚡</span>
      <span>Marcar SN</span>
      {snExcel.length > 0 && (
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
          {snExcel.length}
        </span>
      )}
    </Button>
  </div>

  {/* Resumen archivo cargado */}
  {fileName && (
    <div className="text-xs text-slate-500 max-w-xs text-right">
      <div className="font-medium text-slate-700 truncate">
        Archivo: {fileName}
      </div>
      <div>{snExcel.length} SN encontrados para marcar masivo</div>
    </div>
  )}
</div>

      </div>

      {/* Tabla */}
      {loading ? (
        <div className="rounded-xl border bg-white p-6 text-center text-slate-600 shadow-sm">
          Cargando auditoría…
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm max-h-[75vh] overflow-auto">
          <table className="min-w-[1200px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr className="text-left text-xs font-medium text-slate-600">
                <th className="p-2">SN</th>
                <th className="p-2">Equipo</th>
                <th className="p-2">F. Despacho</th>
                <th className="p-2">Técnicos</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Ubicación</th>
                <th className="p-2">Auditoría</th>
                <th className="p-2">Foto</th>
                <th className="p-2">Observación</th>
                <th className="p-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {equiposFiltrados.map((e) => (
                <tr key={e.id} className="border-t hover:bg-slate-50/60">
                  <td className="p-2 font-mono text-xs text-slate-800">
                    {e.SN}
                  </td>
                  <td className="p-2 text-slate-800">{e.equipo || "-"}</td>
                  <td className="p-2 text-slate-700">
                    {parseFecha(e.f_despacho) || "-"}
                  </td>
                  <td className="p-2 text-slate-700">
                    {Array.isArray(e.tecnicos)
                      ? e.tecnicos.join(", ")
                      : e.tecnicos || "-"}
                  </td>
                  <td className="p-2 text-slate-700">{e.estado || "-"}</td>
                  <td className="p-2 text-slate-700">{e.ubicacion || "-"}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        e?.auditoria?.estado === "sustentada"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
                      }`}
                    >
                      {e?.auditoria?.estado || "pendiente"}
                    </span>
                  </td>
                  <td className="p-2">
                    {e?.auditoria?.fotoURL ? (
                      <div className="flex items-center gap-3">
                        {/* Indicador + tooltip con fecha */}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
                          onClick={() =>
                            setFotoModal({
                              open: true,
                              url: e.auditoria.fotoURL,
                              sn: e.SN,
                            })
                          }
                          title={
                            parseFechaHora(e?.auditoria?.actualizadoEn)
                              ? `Última actualización: ${parseFechaHora(
                                  e?.auditoria?.actualizadoEn
                                )}`
                              : undefined
                          }
                        >
                          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          Ver foto
                        </button>

                        {/* Mini preview */}
                        <img
                          src={e.auditoria.fotoURL}
                          alt={`Foto auditoría ${e.SN}`}
                          className="h-10 w-10 rounded border object-cover cursor-pointer"
                          onClick={() =>
                            setFotoModal({
                              open: true,
                              url: e.auditoria.fotoURL,
                              sn: e.SN,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Sin foto</span>
                    )}
                  </td>

                  {/* Observación editable */}
                  <td className="p-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Escribe una observación..."
                      value={obsDraft[e.id] ?? ""}
                      onChange={(ev) =>
                        setObsDraft((prev) => ({
                          ...prev,
                          [e.id]: ev.target.value,
                        }))
                      }
                    />
                  </td>

                  {/* Acciones */}
                  <td className="p-2 text-right">
                    <div className="flex flex-col items-end gap-1">
                      {/* Botón Sustentar cuando está pendiente */}
                      {e?.auditoria?.estado === "pendiente" && (
                        <>
                          <input
                            id={`file-sustentar-${e.id}`}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={subiendoId === e.id}
                            onChange={(ev) => {
                              const file = ev.target.files?.[0];
                              if (file) {
                                subirFotoAuditoria(e, file, {
                                  marcarSustentado: true,
                                });
                                ev.target.value = "";
                              }
                            }}
                          />

                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded-md shadow-sm disabled:opacity-60"
                            disabled={subiendoId === e.id}
                            onClick={() =>
                              document
                                .getElementById(`file-sustentar-${e.id}`)
                                ?.click()
                            }
                          >
                            {subiendoId === e.id ? "Subiendo..." : "📷 Sustentar"}
                          </Button>
                        </>
                      )}

                      {/* Botón Actualizar foto cuando ya está sustentada */}
                      {e?.auditoria?.estado === "sustentada" && (
                        <>
                          <input
                            id={`file-actualizar-${e.id}`}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={subiendoId === e.id}
                            onChange={(ev) => {
                              const file = ev.target.files?.[0];
                              if (file) {
                                subirFotoAuditoria(e, file, {
                                  marcarSustentado: false,
                                });
                                ev.target.value = "";
                              }
                            }}
                          />

                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-3 text-xs bg-sky-600 text-white hover:bg-sky-700 rounded-md shadow-sm disabled:opacity-60"
                            disabled={subiendoId === e.id}
                            onClick={() =>
                              document
                                .getElementById(`file-actualizar-${e.id}`)
                                ?.click()
                            }
                          >
                            {subiendoId === e.id
                              ? "Subiendo..."
                              : "Actualizar foto"}
                          </Button>
                        </>
                      )}

                      {/* Botón Limpiar */}
                      {e?.auditoria ? (
                        <Button
                          size="sm"
                          type="button"
                          className="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded-md shadow-sm disabled:opacity-60 py-1 h-7 text-xs"
                          onClick={() => limpiarAuditoriaUno(e)}
                        >
                          🧹 Limpiar
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {equiposFiltrados.length === 0 && (
                <tr>
                  <td
                    className="p-6 text-center text-slate-500 text-sm"
                    colSpan={10}
                  >
                    No hay equipos para mostrar con el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal para ver foto */}
      {fotoModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setFotoModal({ open: false, url: "", sn: "" })}
        >
          <div
            className="relative max-w-3xl w-[90vw] bg-white rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div className="text-sm font-medium text-slate-700">
                Foto auditoría – SN {fotoModal.sn}
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800 text-lg"
                onClick={() => setFotoModal({ open: false, url: "", sn: "" })}
              >
                ×
              </button>
            </div>
            <div className="p-3 flex justify-center bg-slate-50">
              <img
                src={fotoModal.url}
                alt={`Foto auditoría ${fotoModal.sn}`}
                className="max-h-[75vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
