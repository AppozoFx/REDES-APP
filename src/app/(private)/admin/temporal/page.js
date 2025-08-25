"use client";

import { useMemo, useState } from "react";
import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  query,
  where,
  limit as fbLimit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";

/** Detecta si un doc de stock_equipos es un agregado (contador) o un detalle por SN */
const esDocAgregado = (data) => {
  if (!data || typeof data !== "object") return false;
  const claves = Object.keys(data);
  const esAgregadoBasico = typeof data.cantidad === "number";
  const tieneCamposSN =
    "SN" in data || "equipo" in data || "descripcion" in data || "estado" in data || "f_ingreso" in data;
  return esAgregadoBasico && !tieneCamposSN && claves.every((k) => ["cantidad", "tipo", "actualizadoEn"].includes(k));
};

// Busca en la colección maestra 'equipos' por SN para completar campos faltantes
const buscarEnMaestroPorSN = async (sn) => {
  const qSnap = await getDocs(
    query(collection(db, "equipos"), where("SN", "==", sn), fbLimit(1))
  );
  if (qSnap.empty) return null;
  const d = qSnap.docs[0].data();
  return {
    equipo: d.equipo || "",
    f_ingreso: d.f_ingreso || null,
    estado: d.estado || null,
    descripcion: d.descripcion || "",
  };
};

export default function HerramientasTemporales() {
  const [aplicando, setAplicando] = useState(false);
  const [dryRun, setDryRun] = useState(true); // ✅ por defecto simula
  const [soloCuadrilla, setSoloCuadrilla] = useState(""); // ej: c_K8
  const [soloActivas, setSoloActivas] = useState(true);
  const [resumen, setResumen] = useState([]); // [{cuadrillaId, migrados, borrados, saltados, tipos, totalSN}]
  const [log, setLog] = useState([]);
  const appendLog = (m) => setLog((prev) => [...prev, m]);

  const tituloModo = useMemo(() => (dryRun ? "DRY-RUN (simulación)" : "APPLY (escribiendo)"), [dryRun]);

  const listarCuadrillas = async () => {
    if (soloCuadrilla.trim()) {
      // Buscar una sola cuadrilla
      const ref = doc(db, "cuadrillas", soloCuadrilla.trim());
      const snap = await getDocs(query(collection(db, "cuadrillas"), where("__name__", "==", ref.id)));
      if (snap.empty) {
        throw new Error(`No existe la cuadrilla "${soloCuadrilla}"`);
      }
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      // Todas (opción: solo activas)
      const base = soloActivas
        ? query(collection(db, "cuadrillas"), where("estado", "==", "activo"))
        : collection(db, "cuadrillas");
      const s = await getDocs(base);
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  };

  const migrarCuadrilla = async (cuadrillaId) => {
    appendLog(`➡️ [${cuadrillaId}] Revisando stock_equipos…`);
    const stockRef = collection(db, `cuadrillas/${cuadrillaId}/stock_equipos`);
    const stockSnap = await getDocs(stockRef);

    let migrados = 0, borrados = 0, saltados = 0;

    if (stockSnap.empty) {
      appendLog(`   └─ No hay documentos en stock_equipos.`);
      return { cuadrillaId, migrados, borrados, saltados };
    }

    for (const d of stockSnap.docs) {
      const data = d.data();
      const agregado = esDocAgregado(data);
      if (agregado) { // es contador por tipo, se deja
        saltados++;
        continue;
      }

      // Documento vacío o con forma de SN → migrar
      const sn = (data && data.SN) ? String(data.SN) : d.id;
      let equipo = (data && data.equipo) ? String(data.equipo) : "";
      let f_ingreso = data && data.f_ingreso ? data.f_ingreso : null;
      let estado = (data && data.estado) ? String(data.estado) : "campo";
      let descripcion = (data && data.descripcion) ? String(data.descripcion) : "";

      if (!equipo || !f_ingreso) {
        const m = await buscarEnMaestroPorSN(sn);
        if (m) {
          equipo = equipo || m.equipo || "";
          f_ingreso = f_ingreso || m.f_ingreso || null;
          estado = estado || m.estado || "campo";
          descripcion = descripcion || m.descripcion || "";
        }
      }

      const payload = {
        SN: sn,
        equipo: equipo || "",
        descripcion,
        estado: estado || "campo",
        f_ingreso: f_ingreso || serverTimestamp(),
        migradoDe: "stock_equipos",
        migradoEn: serverTimestamp(),
      };

      const asignadoRef = doc(db, `cuadrillas/${cuadrillaId}/equipos_asignados/${sn}`);
      const viejoRef = doc(db, `cuadrillas/${cuadrillaId}/stock_equipos/${d.id}`);

      if (!dryRun) {
        await setDoc(asignadoRef, payload, { merge: true });
        await deleteDoc(viejoRef).catch(() => {});
      }

      migrados++;
      borrados++;
      appendLog(`   • ${sn} → equipos_asignados ${dryRun ? "[simulado]" : ""}`);
    }

    return { cuadrillaId, migrados, borrados, saltados };
  };

  const reconciliarCuadrilla = async (cuadrillaId) => {
    appendLog(`🔄 [${cuadrillaId}] Reconciliando contadores…`);
    const asignadosRef = collection(db, `cuadrillas/${cuadrillaId}/equipos_asignados`);
    const asignadosSnap = await getDocs(asignadosRef);

    const conteo = {};
    asignadosSnap.forEach((d) => {
      const data = d.data() || {};
      const tipo = (data.equipo || "").toString().trim() || "(sin_tipo)";
      conteo[tipo] = (conteo[tipo] || 0) + 1;
    });

    const tipos = Object.keys(conteo);
    for (const tipo of tipos) {
      const ref = doc(db, `cuadrillas/${cuadrillaId}/stock_equipos/${tipo}`);
      const payload = { tipo, cantidad: conteo[tipo], actualizadoEn: serverTimestamp() };
      if (!dryRun) await setDoc(ref, payload, { merge: true });
      appendLog(`   • ${tipo}: ${conteo[tipo]} ${dryRun ? "[simulado]" : ""}`);
    }

    return { cuadrillaId, tipos: tipos.length, totalSN: asignadosSnap.size };
  };

  const ejecutarMigracion = async () => {
    setAplicando(true);
    setResumen([]);
    setLog([]);
    toast.loading(`Migrando SN • ${tituloModo}`, { id: "migra" });

    try {
      const cuad = await listarCuadrillas();
      const res = [];
      for (const c of cuad) {
        const r = await migrarCuadrilla(c.id);
        res.push(r);
      }
      setResumen(res);
      toast.success("Migración completada", { id: "migra" });
    } catch (e) {
      console.error(e);
      toast.error(`Error en migración: ${e.message}`, { id: "migra" });
    } finally {
      setAplicando(false);
    }
  };

  const ejecutarReconciliar = async () => {
    setAplicando(true);
    setLog([]);
    toast.loading(`Reconciliando contadores • ${tituloModo}`, { id: "reco" });

    try {
      const cuad = await listarCuadrillas();
      const res = [];
      for (const c of cuad) {
        const r = await reconciliarCuadrilla(c.id);
        res.push(r);
      }
      // fusionar con resumen existente si ya migraste
      setResumen((prev) => {
        const m = new Map(prev.map((x) => [x.cuadrillaId, x]));
        for (const r of res) {
          const base = m.get(r.cuadrillaId) || { cuadrillaId: r.cuadrillaId };
          m.set(r.cuadrillaId, { ...base, ...r });
        }
        return Array.from(m.values());
      });
      toast.success("Reconciliación completada", { id: "reco" });
    } catch (e) {
      console.error(e);
      toast.error(`Error al reconciliar: ${e.message}`, { id: "reco" });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h1 className="mb-2 text-2xl font-bold">🛠️ Herramientas temporales (Migración de equipos)</h1>
      <p className="mb-4 text-gray-600">
        Migra SN de <code>stock_equipos</code> → <code>equipos_asignados</code> y reconcilia contadores por tipo.
      </p>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="flex items-center gap-2">
          <input
            id="dry"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="accent-indigo-600"
          />
          <label htmlFor="dry" className="text-sm">
            Modo simulación (DRY-RUN)
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="act"
            type="checkbox"
            checked={soloActivas}
            onChange={(e) => setSoloActivas(e.target.checked)}
            className="accent-indigo-600"
            disabled={!!soloCuadrilla.trim()}
          />
          <label htmlFor="act" className="text-sm">
            Solo cuadrillas activas
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={soloCuadrilla}
            onChange={(e) => setSoloCuadrilla(e.target.value)}
            placeholder="Procesar SOLO cuadrilla (ej: c_K8)"
            className="w-full rounded border px-3 py-2"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={ejecutarMigracion}
          disabled={aplicando}
          className="rounded-xl bg-orange-500 px-4 py-2 font-semibold text-white shadow-md hover:bg-orange-600"
        >
          {aplicando ? "Procesando…" : "🚚 Migrar SN (stock → asignados)"}
        </Button>

        <Button
          onClick={ejecutarReconciliar}
          disabled={aplicando}
          className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white shadow-md hover:bg-amber-700"
        >
          {aplicando ? "Procesando…" : "♻️ Reconciliar contadores"}
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
                  <th className="p-2 text-left">Migrados</th>
                  <th className="p-2 text-left">Borrados legado</th>
                  <th className="p-2 text-left">Agregados saltados</th>
                  <th className="p-2 text-left">Tipos actualizados</th>
                  <th className="p-2 text-left">SN en asignados</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => (
                  <tr key={r.cuadrillaId} className="border-t">
                    <td className="p-2 font-mono">{r.cuadrillaId}</td>
                    <td className="p-2">{r.migrados ?? "-"}</td>
                    <td className="p-2">{r.borrados ?? "-"}</td>
                    <td className="p-2">{r.saltados ?? "-"}</td>
                    <td className="p-2">{r.tipos ?? "-"}</td>
                    <td className="p-2">{r.totalSN ?? "-"}</td>
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
