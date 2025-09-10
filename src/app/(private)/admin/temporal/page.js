"use client";

import { useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";

const BATCH_LIMIT = 450;

// Un doc está “vacío” si no tiene ningún campo
const esDocVacio = (data) => !data || Object.keys(data).length === 0;

// Por seguridad: NO es vacío si aparenta ser contador o SN
const tieneCamposDeSN = (d) =>
  !!d &&
  ("SN" in d || "equipo" in d || "descripcion" in d || "estado" in d || "f_ingreso" in d);

const esContador = (d) => {
  if (!d || typeof d !== "object") return false;
  const claves = Object.keys(d);
  const esAgregadoBasico = typeof d.cantidad === "number";
  const soloCamposEsperados = claves.every((k) =>
    ["cantidad", "tipo", "actualizadoEn"].includes(k)
  );
  return esAgregadoBasico && soloCamposEsperados;
};

export default function Page() {
  const [dryRun, setDryRun] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [soloCuadrilla, setSoloCuadrilla] = useState(""); // ej: c_K13_MOTO
  const [soloActivas, setSoloActivas] = useState(true);
  const [log, setLog] = useState([]);
  const [resumen, setResumen] = useState([]); // [{cuadrillaId, vaciosDetectados, eliminados}]

  const tituloModo = useMemo(
    () => (dryRun ? "DRY-RUN (simulación)" : "APPLY (borrando)"),
    [dryRun]
  );
  const appendLog = (m) => setLog((prev) => [...prev, m]);

  const listarCuadrillas = async () => {
    if (soloCuadrilla.trim()) {
      const s = await getDocs(
        query(collection(db, "cuadrillas"), where("__name__", "==", soloCuadrilla.trim()))
      );
      if (s.empty) throw new Error(`No existe la cuadrilla "${soloCuadrilla}"`);
      return s.docs.map((d) => ({ id: d.id }));
    }
    const base = soloActivas
      ? query(collection(db, "cuadrillas"), where("estado", "==", "activo"))
      : collection(db, "cuadrillas");
    const s = await getDocs(base);
    return s.docs.map((d) => ({ id: d.id }));
  };

  const borrarEnLotes = async (paths) => {
    let eliminados = 0;
    for (let i = 0; i < paths.length; i += BATCH_LIMIT) {
      const slice = paths.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      slice.forEach((p) => batch.delete(doc(db, p)));
      await batch.commit();
      eliminados += slice.length;
      appendLog(`   ✔️ Eliminados (acum): ${eliminados}/${paths.length}`);
    }
    return eliminados;
  };

  const limpiarCuadrilla = async (cuadrillaId) => {
    appendLog(`➡️ [${cuadrillaId}] Revisando stock_equipos…`);
    const stockRef = collection(db, `cuadrillas/${cuadrillaId}/stock_equipos`);
    const snap = await getDocs(stockRef);

    if (snap.empty) {
      appendLog(`   └─ Sin documentos.`);
      return { cuadrillaId, vaciosDetectados: 0, eliminados: 0 };
    }

    const aEliminar = [];
    snap.docs.forEach((d) => {
      const data = d.data();
      if (esDocVacio(data)) {
        aEliminar.push(d.ref.path);
        return;
      }
      // Si no es vacío, NO tocar contadores ni SN con datos
      if (!tieneCamposDeSN(data) && !esContador(data) && esDocVacio(data)) {
        aEliminar.push(d.ref.path);
      }
    });

    appendLog(`   • Vacíos detectados: ${aEliminar.length}`);

    let eliminados = 0;
    if (!dryRun && aEliminar.length > 0) {
      eliminados = await borrarEnLotes(aEliminar);
    }
    if (dryRun && aEliminar.length > 0) {
      appendLog(`   (DRY-RUN) Se eliminarían ${aEliminar.length} documentos.`);
    }

    return { cuadrillaId, vaciosDetectados: aEliminar.length, eliminados };
  };

  const ejecutar = async () => {
    setAplicando(true);
    setResumen([]);
    setLog([]);
    toast.loading(`Limpiando documentos vacíos • ${tituloModo}`, { id: "clean" });

    try {
      const cuadrillas = await listarCuadrillas();
      const res = [];
      for (const c of cuadrillas) {
        const r = await limpiarCuadrilla(c.id);
        res.push(r);
      }
      setResumen(res);
      toast.success("Proceso finalizado", { id: "clean" });
    } catch (e) {
      console.error(e);
      toast.error(`Error: ${e?.message || "desconocido"}`, { id: "clean" });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h1 className="mb-2 text-2xl font-bold">🧹 Limpiar documentos vacíos — stock_equipos</h1>
      <p className="mb-4 text-gray-600">
        Elimina únicamente los <b>documentos sin campos</b> en <code>cuadrillas/&lt;id&gt;/stock_equipos</code>.
        Los contadores por tipo y los SN con datos se preservan.
      </p>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="accent-indigo-600"
          />
          <span className="text-sm">Modo simulación (DRY-RUN)</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={soloActivas}
            onChange={(e) => setSoloActivas(e.target.checked)}
            className="accent-indigo-600"
            disabled={!!soloCuadrilla.trim()}
          />
          <span className="text-sm">Solo cuadrillas activas</span>
        </label>

        <input
          value={soloCuadrilla}
          onChange={(e) => setSoloCuadrilla(e.target.value)}
          placeholder="Procesar SOLO cuadrilla (ej: c_K13_MOTO)"
          className="w-full rounded border px-3 py-2"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            if (!dryRun) {
              const ok = confirm("Esto borrará documentos VACÍOS. ¿Continuar?");
              if (!ok) return;
            }
            await ejecutar();
          }}
          disabled={aplicando}
          className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white shadow-md hover:bg-rose-700"
        >
          {aplicando ? "Procesando…" : "🧽 Detectar y eliminar vacíos"}
        </Button>
      </div>

      {/* Log */}
      <div className="mb-4 max-h-60 overflow-auto rounded border bg-gray-50 p-3 text-xs text-gray-700">
        {log.length === 0 ? <em>Sin logs aún…</em> : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      {/* Resumen */}
      {resumen.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-semibold">Resumen</h2>
          <div className="overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">Cuadrilla</th>
                  <th className="p-2 text-left">Vacíos detectados</th>
                  <th className="p-2 text-left">Eliminados</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => (
                  <tr key={r.cuadrillaId} className="border-t">
                    <td className="p-2 font-mono">{r.cuadrillaId}</td>
                    <td className="p-2">{r.vaciosDetectados}</td>
                    <td className="p-2">{dryRun ? "0 (simulado)" : r.eliminados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
