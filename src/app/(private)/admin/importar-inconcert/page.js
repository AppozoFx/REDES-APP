// src/app/inconcert/importar/page.js
"use client";

import { useState, useMemo } from "react";
import Papa from "papaparse";
import { db } from "@/firebaseConfig"; // ⚠️ Ajusta si tu export es distinto
import {
  collection,
  writeBatch,
  doc,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "@/context/AuthContext"; // ⚠️ Ajusta a tu ruta real
import toast, { Toaster } from "react-hot-toast";

export default function ImportarInconcertPage() {
  const { userData } = useAuth() || {};
  const usuarioImporta =
    userData?.nombres ||
    userData?.displayName ||
    userData?.email ||
    userData?.uid ||
    "sistema";

  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);   // previsualización (se oculta tras guardar)
  const [raw, setRaw] = useState([]);     // filas crudas CSV
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState(null); // {nuevos, existentes, batches}

  // Mapeo de encabezado CSV -> campo Firestore
  // BO se toma de "Tr." (columna AL)
  const CSV_TO_MODEL = {
    "Fecha de inicio": "inicioLlamadaInconcert",
    "Agente": "usuaruioInconcert",
    "Dir.": "telefonoCliente",
    "Finalizador": "cortaLlamadaInconcert",
    "Fecha Inicio Aten.": "entraLlamadaInconcert",
    "Fecha final": "finLlamadaInconcert",
    "Tpo. Dur.": "duracion",
    "Tpo. Esp.": "espera",
    "Tpo. Timb.": "timbrado",
    "Tpo. Aten.": "atencion",
    "Disp.": "observacionInconcert",
    "Tr.": "bo",
    "Tpo. Tr.": "transferencia",
    "Id Conversación": "_idConversacion", // para deduplicar
  };

  const TABLE_HEADERS = [
    { key: "inicioLlamadaInconcert", label: "Inicio Llamada" },
    { key: "usuaruioInconcert", label: "Usuario" },
    { key: "telefonoCliente", label: "Telefono Cliente" },
    { key: "cortaLlamadaInconcert", label: "Corta Llamada" },
    { key: "entraLlamadaInconcert", label: "Entra Llamada" },
    { key: "finLlamadaInconcert", label: "Fin Llamada" },
    { key: "duracion", label: "Duracion" },
    { key: "espera", label: "Espera" },
    { key: "timbrado", label: "Timbrado" },
    { key: "atencion", label: "Atencion" },
    { key: "observacionInconcert", label: "Observacion" },
    { key: "bo", label: "BO" },
    { key: "transferencia", label: "Trasferencia" },
  ];

  // Helpers
  const clean = (value) => {
    if (value === undefined || value === null) return null;
    const v = String(value).trim();
    if (!v || v.toUpperCase() === "N/A") return null;
    return v;
  };

  const mapRow = (rawRow) => {
    const mapped = {};
    for (const header in CSV_TO_MODEL) {
      const modelKey = CSV_TO_MODEL[header];
      mapped[modelKey] = clean(rawRow[header]);
    }
    return mapped;
  };

  // Handlers
  const handleFileChange = (e) => {
    setNotice("");
    setSummary(null);
    const f = e.target.files?.[0] || null;
    setFile(f);
    setRows([]);
    setRaw([]);
  };

  const parseCSV = () => {
    if (!file) return;
    setParsing(true);
    setRows([]);
    setRaw([]);
    setSummary(null);
    setNotice("Leyendo CSV...");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      encoding: "UTF-8",
      complete: (results) => {
        const rawData = results.data || [];
        const filtered = rawData.filter(
          (r) => clean(r["Dir."]) || clean(r["Fecha de inicio"])
        );
        const mapped = filtered.map(mapRow);

        setRaw(filtered);
        setRows(mapped);
        setParsing(false);
        setNotice(`Se cargaron ${mapped.length} filas para previsualizar.`);
        toast.success("CSV leído correctamente ✅", { id: "csv-ok" });
      },
      error: (err) => {
        setParsing(false);
        setNotice(`Error al leer CSV: ${err?.message || "desconocido"}`);
        toast.error("Error al leer el CSV ❌", { id: "csv-error" });
      },
    });
  };

  // Ids del CSV para deduplicar (Id Conversación)
  const csvIds = useMemo(() => {
    const ids = new Set();
    raw.forEach((r) => {
      const idc = clean(r["Id Conversación"]);
      if (idc) ids.add(idc);
    });
    return ids;
  }, [raw]);

  const saveToFirestore = async () => {
    if (!rows.length || saving) return;

    setSaving(true);
    setNotice("");
    setSummary(null);

    try {
      const colRef = collection(db, "inconcert");

      // Buscar existentes por _idConversacion (en chunks de 30 por 'in')
      let existentes = new Set();
      if (csvIds.size > 0) {
        const allIds = Array.from(csvIds);
        const chunkSize = 30;
        for (let i = 0; i < allIds.length; i += chunkSize) {
          const chunk = allIds.slice(i, i + chunkSize);
          const q = query(colRef, where("_idConversacion", "in", chunk));
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const v = d.data()?._idConversacion;
            if (v) existentes.add(v);
          });
        }
      }

      let nuevos = 0;
      let omitidos = 0;
      let batch = writeBatch(db);
      let batches = 1;

      for (let i = 0; i < rows.length; i++) {
        const rawRow = raw[i] || {};
        const modelRow = rows[i];

        const payload = {
          ...modelRow,
          _idConversacion: clean(rawRow["Id Conversación"]) || null,
          _agenteCrudo: clean(rawRow["Agente"]) || null,
          _dirCrudo: clean(rawRow["Dir."]) || null,
          _fuente: "CSV InConcert",
          _importadoPor: usuarioImporta,
          _importadoEn: serverTimestamp(),
        };

        // Evita duplicados: si ya existe ese Id, omitir
        if (payload._idConversacion && existentes.has(payload._idConversacion)) {
          omitidos++;
          continue;
        }

        const ref = payload._idConversacion
          ? doc(colRef, payload._idConversacion)
          : doc(colRef);

        batch.set(ref, payload, { merge: true });
        nuevos++;

        // Commit parcial con margen frente al límite de 500
        if (nuevos % 450 === 0) {
          await batch.commit();
          batch = writeBatch(db);
          batches++;
        }
      }

      // Commit final
      if (nuevos % 450 !== 0) {
        await batch.commit();
      }

      // Notificación en Firestore
      try {
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Importación",
          mensaje: `📥 ${usuarioImporta} importó INCONCERT. Nuevos: ${nuevos}, Omitidos: ${omitidos}`,
          usuario: usuarioImporta,
          fecha: serverTimestamp(),
          detalles: {
            nuevos,
            actualizados: 0, // este flujo no actualiza, solo inserta u omite
            duplicadosSinCambios: omitidos,
          },
          visto: false,
        });
      } catch (error) {
        console.error("❌ Error al registrar la notificación:", error);
        toast.error("⚠️ Importación correcta, pero falló la notificación", {
          id: "notif-error",
        });
      }

      // Éxito: ocultar previsualización y mostrar SOLO el resumen
      setSummary({ nuevos, existentes: omitidos, batches });
      setRows([]); // 🔴 oculta tabla de previsualización
      setSaving(false);
      setNotice("Guardado completado.");
      toast.success("✅ Importación completada", { id: "save-ok" });
    } catch (err) {
      console.error(err);
      setSaving(false);
      setNotice(`Error al guardar: ${err?.message || "desconocido"}`);
      toast.error("❌ Error al importar", { id: "save-error" });
    }
  };

  const handleNuevaImportacion = () => {
    // Resetea todo para empezar de cero
    setFile(null);
    setRows([]);
    setRaw([]);
    setSummary(null);
    setNotice("");
    toast.dismiss(); // limpia toasts previos
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Contenedor de toasts */}
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />

      <h1 className="text-2xl font-semibold mb-6">Importar INCONCERT</h1>

      {/* Selector de archivo súper visible */}
      <div className="mb-6">
        <label
          htmlFor="csvInput"
          className="w-full sm:w-auto inline-flex items-center gap-3 px-5 py-3 rounded-xl border-2 border-dashed border-blue-500 bg-blue-50 hover:bg-blue-100 cursor-pointer"
          title="Selecciona el archivo CSV"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5"
               fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 16v-8m0 0l-3 3m3-3l3 3M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
          <span className="font-medium">Seleccionar archivo CSV</span>
        </label>
        <input
          id="csvInput"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Nombre del archivo */}
        <div className="mt-2 text-sm text-gray-700">
          {file ? (
            <span>Archivo: <b>{file.name}</b></span>
          ) : (
            <span className="text-gray-500">Ningún archivo seleccionado</span>
          )}
        </div>

        {/* Acciones principales */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={parseCSV}
            disabled={!file || parsing || saving}
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {parsing ? "Leyendo CSV..." : "Leer CSV"}
          </button>

          <button
            onClick={saveToFirestore}
            disabled={!rows.length || saving}
            className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 inline-block animate-spin rounded-full border-2 border-white border-t-transparent" />
                Guardando...
              </span>
            ) : (
              "Guardar en Firestore"
            )}
          </button>

          {/* Nueva importación (visible cuando hay resumen) */}
          {summary && (
            <button
              onClick={handleNuevaImportacion}
              className="px-4 py-2 rounded bg-gray-700 text-white"
              title="Reiniciar para cargar otro archivo"
            >
              Nueva importación
            </button>
          )}
        </div>

        {/* Aviso/estado */}
        {notice && <p className="mt-3 text-sm">{notice}</p>}
      </div>

      {/* Overlay de loading mientras guarda */}
      {saving && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-5 shadow-lg flex items-center gap-3">
            <span className="h-5 w-5 inline-block animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
            <span>Guardando datos, por favor espera…</span>
          </div>
        </div>
      )}

      {/* Previsualización SOLO antes de guardar y si no hay resumen */}
      {rows.length > 0 && !summary && (
        <div className="overflow-auto border rounded mb-6">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                {TABLE_HEADERS.map((h) => (
                  <th key={h.key} className="px-3 py-2 text-left whitespace-nowrap">
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t">
                  {TABLE_HEADERS.map((h) => (
                    <td key={h.key} className="px-3 py-2 whitespace-nowrap">
                      {r[h.key] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resumen final: SOLO esto después de guardar */}
      {summary && (
        <div className="rounded-lg border p-4 bg-green-50">
          <h2 className="font-semibold mb-2">Resumen de importación</h2>
          <ul className="text-sm leading-7">
            <li>Nuevos insertados: <b className="text-green-700">{summary.nuevos}</b></li>
            <li>Omitidos por duplicidad: <b className="text-gray-700">{summary.existentes}</b></li>
          </ul>
        </div>
      )}
    </div>
  );
}
