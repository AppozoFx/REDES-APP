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
import { ref, deleteObject } from "firebase/storage";
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
      if (err?.code === "storage/object-not-found" || err?.code === "storage/unauthorized") continue;
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

  // Excel
  const [fileName, setFileName] = useState("");
  const [snExcel, setSnExcel] = useState([]); // preview SN
  const [procesando, setProcesando] = useState(false);

  // Cargar equipos con auditoría activa
  const cargar = async () => {
    setLoading(true);
    try {
      const qRef = query(collection(db, "equipos"), where("auditoria.requiere", "==", true));
      const snap = await getDocs(qRef);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEquipos(rows);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cargar auditorías");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  // KPIs
  const kpis = useMemo(() => {
    const total = equipos.length;
    const pend = equipos.filter((e) => e?.auditoria?.estado === "pendiente").length;
    const sust = equipos.filter((e) => e?.auditoria?.estado === "sustentada").length;
    return { total, pend, sust };
  }, [equipos]);

  // Listas únicas para selects
  const ubicacionesDisponibles = useMemo(
    () => [...new Set(equipos.map((e) => e?.ubicacion).filter(Boolean))].sort(),
    [equipos]
  );

  const estadosGenerales = useMemo(
    () => [...new Set(equipos.map((e) => e?.estado).filter(Boolean))].sort(),
    [equipos]
  );

  // Filtrado
  const equiposFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return equipos.filter((e) => {
      const okEstadoAud = filtroEstadoAud === "todos" ? true : e?.auditoria?.estado === filtroEstadoAud;
      const okUbic = filtroUbicacion === "todas" ? true : (e?.ubicacion ?? "") === filtroUbicacion;
      const okEstadoGen = filtroEstadoGeneral === "todos" ? true : (e?.estado ?? "") === filtroEstadoGeneral;
      const okQ =
        !q ||
        (e?.SN ?? "").toLowerCase().includes(q) ||
        (e?.equipo ?? "").toLowerCase().includes(q) ||
        (e?.ubicacion ?? "").toLowerCase().includes(q);
      return okEstadoAud && okUbic && okEstadoGen && okQ;
    });
  }, [equipos, filtroEstadoAud, filtroUbicacion, filtroEstadoGeneral, busqueda]);

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
            mensaje: `🔎 ${userData?.nombres ?? ""} ${userData?.apellidos ?? ""} marcó el SN ${sn} para auditoría.`,
            usuario: `${userData?.nombres ?? ""} ${userData?.apellidos ?? ""}`.trim(),
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
      toast.success(`Marcado masivo completado. OK: ${ok} • No encontrados: ${noEncontrados.length}`);
      setSnExcel([]);
      setFileName("");
    } catch (e) {
      console.error(e);
      toast.error("Fallo el marcado masivo");
    } finally {
      setProcesando(false);
    }
  };

  /* ========== Export manifest (Excel con FotoURL) ========== */
  const exportManifest = () => {
    const base = equiposFiltrados.map((e) => ({
      SN: e.SN,
      "F. Despacho": parseFecha(e.f_despacho),
      Técnicos: Array.isArray(e.tecnicos) ? e.tecnicos.join(", ") : e.tecnicos || "",
      Ubicación: e.ubicacion || "",
      Estado: e.estado || "",
      Auditoría: e?.auditoria?.estado || "pendiente",
      FotoURL: e?.auditoria?.fotoURL || "",
    }));
    if (base.length === 0) {
      toast.error("No hay filas para exportar");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(base);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AUDITORIA");
    XLSX.writeFile(wb, `AUDITORIA-MANIFEST-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Exportado");
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
      toast.success(`Nueva auditoría lista. Limpiados: ${limpiados}. Fotos borradas: ${fotosBorradas}.`);
    } catch (e) {
      console.error(e);
      toast.error("Error al limpiar auditoría");
    } finally {
      setProcesando(false);
    }
  };

  /* ==================== UI ==================== */

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h2 className="mb-4 text-2xl font-semibold">📋 Auditoría de Equipos</h2>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-sm text-gray-500">En auditoría</div>
          <div className="text-2xl font-semibold">{kpis.total}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-sm text-gray-500">Pendientes</div>
          <div className="text-2xl font-semibold">{kpis.pend}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-sm text-gray-500">Sustentadas</div>
          <div className="text-2xl font-semibold">{kpis.sust}</div>
        </div>
      </div>

      {/* Filtros y acciones */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Estado de la auditoría */}
        <select
          className="rounded border px-3 py-2"
          value={filtroEstadoAud}
          onChange={(e) => setFiltroEstadoAud(e.target.value)}
        >
          <option value="todos">Todos</option>
          <option value="pendiente">Pendiente</option>
          <option value="sustentada">Sustentada</option>
        </select>

        {/* Estado general */}
        <select
          className="rounded border px-3 py-2"
          value={filtroEstadoGeneral}
          onChange={(e) => setFiltroEstadoGeneral(e.target.value)}
        >
          <option value="todos">Estado (general)</option>
          {estadosGenerales.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Ubicación */}
        <select
          className="rounded border px-3 py-2"
          value={filtroUbicacion}
          onChange={(e) => setFiltroUbicacion(e.target.value)}
        >
          <option value="todas">Ubicación</option>
          {ubicacionesDisponibles.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        {/* Búsqueda */}
        <Input
          className="w-full max-w-xs"
          placeholder="🔍 Buscar por SN / equipo / ubicación"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        {/* Acciones */}
        <Button onClick={exportManifest} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          📤 Exportar Excel (URLs)
        </Button>

        <label className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
          📥 Cargar Excel (SN)
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

        <Button
          disabled={snExcel.length === 0 || procesando}
          onClick={marcarMasivo}
          className="rounded-lg bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          ⚡ Marcar {snExcel.length || ""} SN
        </Button>

        <Button
          disabled={procesando}
          onClick={nuevaAuditoria}
          className="rounded-lg bg-slate-700 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          🧹 Nueva auditoría (limpiar + borrar fotos)
        </Button>

        {fileName && (
          <span className="text-sm text-gray-600">
            Archivo: {fileName} ({snExcel.length} SN)
          </span>
        )}
      </div>

      {loading ? (
        <div className="rounded border p-6 text-center text-gray-600">Cargando…</div>
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded border">
          <table className="min-w-[1200px] text-sm">
            <thead className="sticky top-0 bg-gray-100">
              <tr>
                <th className="p-2">SN</th>
                <th className="p-2">F. Despacho</th>
                <th className="p-2">Técnicos</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Ubicación</th>
                <th className="p-2">Auditoría</th>
                <th className="p-2">Foto</th>
                <th className="p-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {equiposFiltrados.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2 font-mono">{e.SN}</td>
                  <td className="p-2">{parseFecha(e.f_despacho)}</td>
                  <td className="p-2">
                    {Array.isArray(e.tecnicos) ? e.tecnicos.join(", ") : e.tecnicos || "-"}
                  </td>
                  <td className="p-2">{e.estado || "-"}</td>
                  <td className="p-2">{e.ubicacion || "-"}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        e?.auditoria?.estado === "sustentada"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {e?.auditoria?.estado || "pendiente"}
                    </span>
                  </td>
                  <td className="p-2">
                    {e?.auditoria?.fotoURL ? (
                      <a
                        href={e.auditoria.fotoURL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Ver foto
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-2">
                    {e?.auditoria ? (
                      <Button
                        size="sm"
                        className="rounded bg-slate-600 px-3 py-1 text-white hover:bg-slate-700"
                        onClick={() => limpiarAuditoriaUno(e)}
                      >
                        🧹 Limpiar
                      </Button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}

              {equiposFiltrados.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-gray-500" colSpan={8}>
                    No hay equipos para mostrar con el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
