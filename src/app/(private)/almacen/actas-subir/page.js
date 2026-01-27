"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { storage } from "@/firebaseConfig";
import { ref, uploadBytesResumable, getDownloadURL, listAll } from "firebase/storage";
import toast from "react-hot-toast";

import JSZip from "jszip";
import { saveAs } from "file-saver";

/* =========================
   Helpers
========================= */
const pad2 = (n) => String(n).padStart(2, "0");
const toDateFolder = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Acepta "YYYY-MM-DD" o "DD/MM/YYYY" y devuelve "YYYY-MM-DD"
const normalizeDateFolder = (v) => {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
};

const sanitizeFileName = (s) =>
  (s || "")
    .replace(/[\/\\:\*\?"<>\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const safeNameStrict = (s) => sanitizeFileName(s).replace(/[^a-zA-Z0-9._ -]/g, "_");

const bytesToHuman = (bytes) => {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

const isPdf = (file) => file && String(file.name || "").toLowerCase().endsWith(".pdf");

function Badge({ children, tone = "neutral" }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border";
  const tones = {
    neutral: "bg-background text-foreground border-border",
    ready: "bg-slate-50 text-slate-700 border-slate-200",
    uploading: "bg-amber-50 text-amber-700 border-amber-200",
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    error: "bg-red-50 text-red-700 border-red-200",
    canceled: "bg-zinc-50 text-zinc-700 border-zinc-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return <span className={`${base} ${tones[tone] || tones.neutral}`}>{children}</span>;
}

function ProgressBar({ value = 0 }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden border border-border">
      <div className="h-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}

/* =========================
   Cloud Function URL (directa)
   - Debe apuntar EXACTO a la función
========================= */
const RENOMBRAR_FN_URL =
  process.env.NEXT_PUBLIC_RENOMBRAR_FN_URL ||
  "https://us-central1-redesmyd-f8616.cloudfunctions.net/renombrarActaManual";

/* =========================
   Page
========================= */
export default function SubirActasPage() {
  const inputRef = useRef(null);

  // ✅ siempre ISO
  const [dateStr, setDateStr] = useState(() => toDateFolder(new Date()));
  const dateFolder = useMemo(() => normalizeDateFolder(dateStr) || toDateFolder(new Date()), [dateStr]);

  /* =========================
     Resultado final (OK/ERROR)
  ========================= */
  const [okFiles, setOkFiles] = useState([]);
  const [errorFiles, setErrorFiles] = useState([]);
  const [loadingOk, setLoadingOk] = useState(false);
  const [loadingErr, setLoadingErr] = useState(false);

  // renombrado manual
  const [renameDraft, setRenameDraft] = useState({}); // { [fullPath]: "nuevoNombre.pdf" }
  const [renameBusy, setRenameBusy] = useState({}); // { [fullPath]: true }

  const okPrefix = useMemo(() => `guias_actas/actas_servicio/ok/${dateFolder}`, [dateFolder]);
  const errPrefix = useMemo(() => `guias_actas/actas_servicio/error/${dateFolder}`, [dateFolder]);

  const refreshOkFiles = async () => {
    setLoadingOk(true);
    try {
      const folderRef = ref(storage, okPrefix);
      const res = await listAll(folderRef);
      const names = res.items
        .map((b) => ({ fullPath: b.fullPath, name: b.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setOkFiles(names);
    } catch {
      setOkFiles([]);
    } finally {
      setLoadingOk(false);
    }
  };

  const refreshErrorFiles = async () => {
    setLoadingErr(true);
    try {
      const folderRef = ref(storage, errPrefix);
      const res = await listAll(folderRef);
      const names = res.items
        .map((b) => ({ fullPath: b.fullPath, name: b.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setErrorFiles(names);

      // precarga draft por defecto con el mismo nombre actual
      setRenameDraft((prev) => {
        const next = { ...prev };
        for (const f of names) {
          if (!next[f.fullPath]) next[f.fullPath] = f.name;
        }
        return next;
      });
    } catch {
      setErrorFiles([]);
    } finally {
      setLoadingErr(false);
    }
  };

  const refreshFinalFolders = async () => {
    await Promise.all([refreshOkFiles(), refreshErrorFiles()]);
  };

  useEffect(() => {
    refreshFinalFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFolder]);

  const downloadOne = async (file) => {
    try {
      const url = await getDownloadURL(ref(storage, file.fullPath));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.rel = "noreferrer";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(`No se pudo descargar: ${String(e?.message || e)}`);
    }
  };

  const downloadZipFromList = async (files, zipName) => {
    if (!files.length) return toast("No hay archivos para descargar.");

    const zip = new JSZip();
    const toastId = "zip";

    try {
      toast.loading(`Creando ZIP (${files.length})...`, { id: toastId });

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const url = await getDownloadURL(ref(storage, f.fullPath));
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Error descargando ${f.name}`);
        const blob = await resp.blob();
        zip.file(f.name, blob);
        toast.loading(`Agregando ${i + 1}/${files.length}...`, { id: toastId });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, zipName);
      toast.success("ZIP listo ✅", { id: toastId });
    } catch (e) {
      toast.error(`No se pudo crear ZIP: ${String(e?.message || e)}`, { id: toastId });
    }
  };

  const downloadZipOk = async () => downloadZipFromList(okFiles, `ACTAS_OK_${dateFolder}.zip`);
  const downloadZipErr = async () => downloadZipFromList(errorFiles, `ACTAS_ERROR_${dateFolder}.zip`);

  /* =========================
     ✅ Mover ERROR → OK (manual)
     - La Function espera: dateFolder, fromName, newName
  ========================= */
  const moverErrorAOk = async (file) => {
    const normalizedDateFolder = normalizeDateFolder(dateFolder);
    if (!normalizedDateFolder) return toast.error("Fecha inválida. Usa YYYY-MM-DD.");

    // fromName = nombre real del archivo en /error/
    const fromName = String(file?.name || "").trim();
    if (!fromName.toLowerCase().endsWith(".pdf")) {
      return toast.error("fromName inválido (debe ser .pdf)");
    }

    // newName = lo que el usuario escribe
    const draft = String(renameDraft[file.fullPath] || "").trim();
    if (!draft) return toast.error("newName requerido");

    let newName = safeNameStrict(draft);
    if (!newName.toLowerCase().endsWith(".pdf")) newName = `${newName}.pdf`;

    setRenameBusy((p) => ({ ...p, [file.fullPath]: true }));
    const tId = `mv_${file.fullPath}`;

    try {
      toast.loading("Moviendo a OK...", { id: tId });

      const resp = await fetch(RENOMBRAR_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFolder: normalizedDateFolder,
          fromName,
          newName,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.message || `HTTP ${resp.status}`);
      }

      toast.success("Listo ✅ Movido a OK", { id: tId });
      await refreshFinalFolders();
    } catch (e) {
      toast.error(`No se pudo mover: ${String(e?.message || e)}`, { id: tId });
    } finally {
      setRenameBusy((p) => ({ ...p, [file.fullPath]: false }));
    }
  };

  /* =========================
     Subida (tu lógica)
  ========================= */
  const [items, setItems] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parallel, setParallel] = useState(2);

  const totals = useMemo(() => {
    const total = items.length;
    const ready = items.filter((x) => x.status === "LISTO").length;
    const uploading = items.filter((x) => x.status === "SUBIENDO").length;
    const done = items.filter((x) => x.status === "SUBIDO").length;
    const error = items.filter((x) => x.status === "ERROR").length; // error de subida
    const bytes = items.reduce((acc, x) => acc + (x.file?.size || 0), 0);
    return { total, ready, uploading, done, error, bytes };
  }, [items]);

  const overallProgress = useMemo(() => {
    if (!items.length) return 0;
    const sum = items.reduce((acc, x) => acc + (Number(x.progress) || 0), 0);
    return Math.round(sum / items.length);
  }, [items]);

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    const pdfs = incoming.filter(isPdf);

    if (!pdfs.length) {
      toast.error("Selecciona archivos PDF.");
      return;
    }

    const existingKeys = new Set(items.map((x) => `${x.file?.name}__${x.file?.size}`));
    const mapped = [];
    let skipped = 0;

    for (const f of pdfs) {
      const key = `${f.name}__${f.size}`;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      mapped.push({
        id: crypto.randomUUID(),
        file: f,
        progress: 0,
        status: "LISTO",
        error: "",
        task: null,
        storagePath: "",
        uploadedAt: null,
      });
    }

    if (skipped) toast(`Se omitieron ${skipped} duplicado(s).`);
    setItems((p) => [...p, ...mapped]);
  };

  const buildStoragePath = (fileName, id) => {
    let safeName = sanitizeFileName(fileName) || `acta_${id}.pdf`;
    safeName = safeName.replace(/[^a-zA-Z0-9._ -]/g, "_");
    return `guias_actas/actas_servicio/inbox/${dateFolder}/${safeName}`;
  };

  const markItem = (id, patch) => {
    setItems((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const subirOne = async (it) => {
    const storagePath = buildStoragePath(it.file.name, it.id);
    const storageRef = ref(storage, storagePath);

    markItem(it.id, { status: "SUBIENDO", error: "", progress: 0, storagePath });

    const task = uploadBytesResumable(storageRef, it.file, { contentType: "application/pdf" });
    markItem(it.id, { task });

    await new Promise((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) => {
          const pct = snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0;
          markItem(it.id, { progress: pct });
        },
        reject,
        resolve
      );
    });

    markItem(it.id, {
      status: "SUBIDO",
      progress: 100,
      task: null,
      uploadedAt: new Date().toISOString(),
    });
  };

  const subirLote = async () => {
    const queue = items.filter((x) => ["LISTO", "ERROR", "CANCELADO"].includes(x.status));
    if (!queue.length) return toast("No hay archivos por subir.");

    if (!dateFolder || !/^\d{4}-\d{2}-\d{2}$/.test(dateFolder)) {
      return toast.error("Fecha inválida. Usa formato YYYY-MM-DD.");
    }

    setIsUploading(true);
    toast.loading(`Subiendo ${queue.length} acta(s)...`, { id: "upload" });

    let idx = 0;
    const maxW = Math.max(1, Math.min(5, Number(parallel) || 2));
    const workers = Array.from({ length: maxW }, async () => {
      while (idx < queue.length) {
        const current = queue[idx++];
        try {
          await subirOne(current);
        } catch (e) {
          const msg = String(e?.message || e || "Error desconocido");
          markItem(current.id, { status: "ERROR", error: msg, task: null });
        }
      }
    });

    await Promise.all(workers);

    setIsUploading(false);

    const errs = items.filter((x) => x.status === "ERROR").length;
    if (errs) toast.error(`Listo, pero con ${errs} error(es) de subida.`, { id: "upload" });
    else toast.success("¡Subida completada!", { id: "upload" });

    setTimeout(() => refreshFinalFolders(), 800);
  };

  const retryErrors = () => {
    if (isUploading) return;
    setItems((p) =>
      p.map((x) => (x.status === "ERROR" ? { ...x, status: "LISTO", error: "", progress: 0 } : x))
    );
    setTimeout(() => subirLote(), 50);
  };

  const cancelUpload = (id) => {
    setItems((p) =>
      p.map((x) => {
        if (x.id !== id) return x;
        try {
          x.task?.cancel?.();
        } catch {}
        return { ...x, status: "CANCELADO", error: "Cancelado", task: null };
      })
    );
  };

  const removeItem = (id) => setItems((p) => p.filter((x) => x.id !== id));
  const clearAll = () => !isUploading && setItems([]);
  const pickClick = () => inputRef.current?.click?.();

  const statusTone = (st) => {
    if (st === "LISTO") return "ready";
    if (st === "SUBIENDO") return "uploading";
    if (st === "SUBIDO") return "ok";
    if (st === "ERROR") return "error";
    if (st === "CANCELADO") return "canceled";
    return "neutral";
  };

  // Drag & drop global prevent
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) addFiles(files);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="rounded-2xl border bg-card text-card-foreground shadow-sm">
        {/* ✅ STICKY */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b">
          <div className="px-6 py-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold leading-tight">Subir Actas</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Sube PDFs a <span className="font-mono">inbox/{dateFolder}</span> para que el servicio las renombre automáticamente.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge tone="info">Actas (lista): {totals.total}</Badge>
                <Badge>Listo: {totals.ready}</Badge>
                <Badge>Subiendo: {totals.uploading}</Badge>
                <Badge tone="ok">Subidas: {totals.done}</Badge>
                <Badge tone={totals.error ? "error" : "neutral"}>Error subida: {totals.error}</Badge>
                <Badge>Peso: {bytesToHuman(totals.bytes)}</Badge>
                <Badge tone="ok">OK: {okFiles.length}</Badge>
                <Badge tone={errorFiles.length ? "error" : "neutral"}>Renombrado ERROR: {errorFiles.length}</Badge>
              </div>
            </div>

            {!!items.length && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progreso general</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="mt-2">
                  <ProgressBar value={overallProgress} />
                </div>
              </div>
            )}
          </div>

          <div className="px-6 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4 space-y-1">
                <div className="text-sm font-medium">Fecha (carpeta)</div>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)} // type="date" devuelve YYYY-MM-DD
                  disabled={isUploading}
                />
                <div className="text-xs text-muted-foreground">Formato: YYYY-MM-DD</div>
              </div>

              <div className="md:col-span-3 space-y-1">
                <div className="text-sm font-medium">Paralelismo</div>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  type="number"
                  min={1}
                  max={5}
                  value={parallel}
                  onChange={(e) => setParallel(Number(e.target.value || 2))}
                  disabled={isUploading}
                />
                <div className="text-xs text-muted-foreground">Recomendado: 1–2</div>
              </div>

              <div className="md:col-span-5 flex items-end flex-wrap gap-2">
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />

                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={pickClick}
                  disabled={isUploading}
                >
                  Elegir PDFs
                </button>

                <button
                  type="button"
                  className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                  onClick={subirLote}
                  disabled={isUploading || !items.length}
                >
                  {isUploading ? "Subiendo..." : "Subir lote"}
                </button>

                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={retryErrors}
                  disabled={isUploading}
                >
                  Reintentar fallidos
                </button>

                <button
                  type="button"
                  className="rounded-md px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={clearAll}
                  disabled={isUploading || !items.length}
                >
                  Limpiar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CONTENIDO */}
        <div className="px-6 py-5 space-y-4">
          {/* Dropzone */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
            }}
            className={[
              "rounded-2xl border border-dashed p-5 transition",
              isDragOver ? "bg-muted/50 border-primary" : "bg-background",
            ].join(" ")}
          >
            <div className="font-medium">Arrastra y suelta tus PDFs aquí</div>
            <div className="text-sm text-muted-foreground mt-1 break-all">
              Se guardan en:{" "}
              <span className="font-mono">
                guias_actas/actas_servicio/inbox/{dateFolder}/
              </span>
            </div>
          </div>

          {/* Lista subida */}
          <div className="rounded-2xl border overflow-hidden">
            {items.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Aún no has agregado PDFs.</div>
            ) : (
              <div className="divide-y">
                {items.map((it, idx) => (
                  <div key={it.id} className="p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">#{idx + 1}</Badge>
                          <div className="font-medium truncate max-w-[780px]">{it.file.name}</div>
                          <Badge tone={statusTone(it.status)}>{it.status}</Badge>
                          <span className="text-xs text-muted-foreground">{bytesToHuman(it.file.size)}</span>
                        </div>

                        <div className="text-xs text-muted-foreground mt-1 break-all">
                          Destino:{" "}
                          <span className="font-mono">
                            {it.storagePath || buildStoragePath(it.file.name, it.id)}
                          </span>
                        </div>

                        {it.status === "ERROR" && it.error ? (
                          <div className="text-xs text-red-600 mt-2 break-words">{it.error}</div>
                        ) : null}

                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Progreso</span>
                            <span>{it.progress || 0}%</span>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={it.progress || 0} />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {it.status === "LISTO" && (
                          <button
                            type="button"
                            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                            disabled={isUploading}
                            onClick={() =>
                              subirOne(it).catch((e) =>
                                markItem(it.id, { status: "ERROR", error: String(e?.message || e) })
                              )
                            }
                          >
                            Subir
                          </button>
                        )}

                        {it.status === "SUBIENDO" && (
                          <button
                            type="button"
                            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => cancelUpload(it.id)}
                          >
                            Cancelar
                          </button>
                        )}

                        {(it.status === "ERROR" || it.status === "CANCELADO") && (
                          <button
                            type="button"
                            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                            disabled={isUploading}
                            onClick={() => {
                              markItem(it.id, { status: "LISTO", error: "", progress: 0 });
                              setTimeout(() => {
                                subirOne({ ...it, status: "LISTO", progress: 0 }).catch((e) =>
                                  markItem(it.id, { status: "ERROR", error: String(e?.message || e) })
                                );
                              }, 10);
                            }}
                          >
                            Reintentar
                          </button>
                        )}

                        <button
                          type="button"
                          className="rounded-md px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                          disabled={isUploading && it.status === "SUBIENDO"}
                          onClick={() => removeItem(it.id)}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resultado final (OK) */}
          <div className="rounded-2xl border bg-background overflow-hidden">
            <div className="p-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="font-semibold">Resultado final (OK)</div>
                <div className="text-xs text-muted-foreground break-all">
                  Carpeta: <span className="font-mono">{okPrefix}/</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Total OK: <b>{okFiles.length}</b>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={refreshOkFiles}
                  disabled={loadingOk}
                >
                  {loadingOk ? "Actualizando..." : "Actualizar"}
                </button>

                <button
                  type="button"
                  className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                  onClick={downloadZipOk}
                  disabled={loadingOk || okFiles.length === 0}
                >
                  Descargar ZIP
                </button>
              </div>
            </div>

            {okFiles.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                Aún no hay archivos en OK para esta fecha.
              </div>
            ) : (
              <div className="divide-y">
                {okFiles.map((f, idx) => (
                  <div key={f.fullPath} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone="ok">#{idx + 1}</Badge>
                        <div className="font-medium truncate max-w-[860px]">{f.name}</div>
                      </div>
                      <div className="text-xs text-muted-foreground break-all mt-1">
                        <span className="font-mono">{f.fullPath}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => downloadOne(f)}
                    >
                      Descargar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resultado final (ERROR) + renombrado manual */}
          <div className="rounded-2xl border bg-background overflow-hidden">
            <div className="p-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="font-semibold text-red-700">Resultado final (ERROR)</div>
                <div className="text-xs text-muted-foreground break-all">
                  Carpeta: <span className="font-mono">{errPrefix}/</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Total ERROR (renombrado): <b>{errorFiles.length}</b>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  * Estos NO son errores de subida. Aquí puedes corregir el nombre y mover a OK.
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={refreshErrorFiles}
                  disabled={loadingErr}
                >
                  {loadingErr ? "Actualizando..." : "Actualizar"}
                </button>

                <button
                  type="button"
                  className="rounded-md bg-red-600 text-white px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                  onClick={downloadZipErr}
                  disabled={loadingErr || errorFiles.length === 0}
                >
                  Descargar ZIP
                </button>
              </div>
            </div>

            {errorFiles.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No hay archivos en ERROR ✅</div>
            ) : (
              <div className="divide-y">
                {errorFiles.map((f, idx) => {
                  const busy = !!renameBusy[f.fullPath];
                  return (
                    <div
                      key={f.fullPath}
                      className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge tone="error">#{idx + 1}</Badge>
                          <div className="font-medium truncate max-w-[860px]">{f.name}</div>
                        </div>
                        <div className="text-xs text-muted-foreground break-all mt-1">
                          <span className="font-mono">{f.fullPath}</span>
                        </div>

                        <div className="mt-3 flex flex-col md:flex-row gap-2 md:items-center">
                          <input
                            className="w-full md:w-[520px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                            value={renameDraft[f.fullPath] || ""}
                            onChange={(e) =>
                              setRenameDraft((p) => ({ ...p, [f.fullPath]: e.target.value }))
                            }
                            placeholder="Ej: 2655092 - JUAN PEREZ.pdf"
                            disabled={busy}
                          />
                          <button
                            type="button"
                            className="rounded-md bg-emerald-600 text-white px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                            onClick={() => moverErrorAOk(f)}
                            disabled={busy}
                            title="Mover a OK con el nuevo nombre"
                          >
                            {busy ? "Moviendo..." : "Mover a OK"}
                          </button>
                        </div>

                        <div className="text-[11px] text-muted-foreground mt-2">
                          Se moverá a:{" "}
                          <span className="font-mono">
                            {okPrefix}/{"{newName}"}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                          onClick={() => downloadOne(f)}
                        >
                          Descargar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Tip: ya estamos “sanitizando” nombres para evitar caracteres raros (como{" "}
            <span className="font-mono">?</span>) antes de subir.
          </div>
        </div>
      </div>
    </div>
  );
}
