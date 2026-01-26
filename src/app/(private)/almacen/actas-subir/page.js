"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { storage } from "@/firebaseConfig";
import { ref, uploadBytesResumable, getDownloadURL, listAll } from "firebase/storage";
import toast from "react-hot-toast";

import JSZip from "jszip";
import { saveAs } from "file-saver";

/* =========================
   Utils
========================= */
const pad2 = (n) => String(n).padStart(2, "0");
const toDateFolder = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const sanitizeFileName = (s) =>
  (s || "")
    .replace(/[\/\\:\*\?"<>\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border";
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
   Page
========================= */
export default function SubirActasPage() {
  const inputRef = useRef(null);

  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    return toDateFolder(d);
  });

  const [items, setItems] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parallel, setParallel] = useState(2);

  const dateFolder = useMemo(() => dateStr || toDateFolder(new Date()), [dateStr]);

  /* =========================
     Resultado final (OK)
  ========================= */
  const [okFiles, setOkFiles] = useState([]);
  const [loadingOk, setLoadingOk] = useState(false);

  // Auto-refresh OK (polling)
  const [autoOk, setAutoOk] = useState(false);
  const [autoOkMsg, setAutoOkMsg] = useState("");
  const autoOkTimerRef = useRef(null);
  const autoOkTriesRef = useRef(0);

  // Importante para evitar “stale state” en el polling
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const okPrefix = useMemo(
    () => `guias_actas/actas_servicio/ok/${dateFolder}`,
    [dateFolder]
  );

  const refreshOkFiles = async () => {
    setLoadingOk(true);
    try {
      const folderRef = ref(storage, okPrefix);
      const res = await listAll(folderRef);

      const names = res.items
        .map((b) => ({ fullPath: b.fullPath, name: b.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setOkFiles(names);
      return names.length;
    } catch (e) {
      toast.error(`No se pudo leer OK: ${String(e?.message || e)}`);
      return null;
    } finally {
      setLoadingOk(false);
    }
  };

  const stopAutoOk = () => {
    setAutoOk(false);
    setAutoOkMsg("");
    autoOkTriesRef.current = 0;
    if (autoOkTimerRef.current) {
      clearInterval(autoOkTimerRef.current);
      autoOkTimerRef.current = null;
    }
  };

  /**
   * Inicia polling:
   * - Cada 3s refresca la carpeta OK
   * - Se detiene cuando:
   *   a) okFiles >= cantidad de SUBIDOS en el lote actual
   *   b) o se llega a max intentos
   */
  const startAutoOk = async () => {
    // evita duplicar intervalos
    stopAutoOk();

    // primer refresh inmediato
    const first = await refreshOkFiles();
    setAutoOk(true);

    autoOkTriesRef.current = 0;
    setAutoOkMsg("Esperando archivos renombrados...");

    const intervalMs = 3000;
    const maxTries = 30; // 30 * 3s = 90s máximo (ajústalo si quieres)

    autoOkTimerRef.current = setInterval(async () => {
      autoOkTriesRef.current += 1;

      const subidos = itemsRef.current.filter((x) => x.status === "SUBIDO").length;

      const currentCount = await refreshOkFiles();
      if (currentCount === null) {
        // si falló la lectura, igual dejamos que reintente
        setAutoOkMsg(`Reintentando lectura... (${autoOkTriesRef.current}/${maxTries})`);
        return;
      }

      // Criterio “OK”: ya veo al menos la cantidad de subidos del lote
      if (subidos > 0 && currentCount >= subidos) {
        setAutoOkMsg("Listo ✅ Archivos renombrados detectados.");
        stopAutoOk();
        return;
      }

      if (autoOkTriesRef.current >= maxTries) {
        setAutoOkMsg("Tiempo máximo alcanzado. Puedes presionar “Actualizar”.");
        stopAutoOk();
        return;
      }

      setAutoOkMsg(`Esperando renombrado... (${autoOkTriesRef.current}/${maxTries})`);
    }, intervalMs);
  };

  // Si cambias la fecha, detenemos auto-refresh (para evitar que quede mirando otra carpeta)
  useEffect(() => {
    stopAutoOk();
    // opcional: cargar OK al cambiar fecha
    // refreshOkFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFolder]);

  const downloadOneOk = async (file) => {
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

  const downloadZipOk = async () => {
    if (!okFiles.length) return toast("No hay archivos en OK para descargar.");

    const zip = new JSZip();
    const toastId = "zip";

    try {
      toast.loading(`Creando ZIP (${okFiles.length})...`, { id: toastId });

      for (let i = 0; i < okFiles.length; i++) {
        const f = okFiles[i];
        const url = await getDownloadURL(ref(storage, f.fullPath));

        // OJO: si tu Storage CORS no permite fetch, esto fallará.
        // Con tu CORS ya configurado debería funcionar.
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) throw new Error(`Error descargando ${f.name}`);

        const blob = await resp.blob();
        zip.file(f.name, blob);

        toast.loading(`Agregando ${i + 1}/${okFiles.length}...`, { id: toastId });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `ACTAS_OK_${dateFolder}.zip`);

      toast.success("ZIP listo ✅", { id: toastId });
    } catch (e) {
      toast.error(`No se pudo crear ZIP: ${String(e?.message || e)}`, { id: toastId });
    }
  };

  /* =========================
     Subida (tu lógica)
  ========================= */
  const totals = useMemo(() => {
    const total = items.length;
    const ready = items.filter((x) => x.status === "LISTO").length;
    const uploading = items.filter((x) => x.status === "SUBIENDO").length;
    const done = items.filter((x) => x.status === "SUBIDO").length;
    const error = items.filter((x) => x.status === "ERROR").length;
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
          const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
          markItem(it.id, { progress: pct });
        },
        reject,
        resolve
      );
    });

    markItem(it.id, { status: "SUBIDO", progress: 100, task: null, uploadedAt: new Date().toISOString() });
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

    const errs = itemsRef.current.filter((x) => x.status === "ERROR").length;
    if (errs) toast.error(`Listo, pero con ${errs} error(es).`, { id: "upload" });
    else toast.success("¡Subida completada!", { id: "upload" });

    // ✅ NUEVO: al terminar la subida, iniciamos auto-refresh del OK
    startAutoOk();
  };

  const retryErrors = () => {
    if (isUploading) return;
    setItems((p) => p.map((x) => (x.status === "ERROR" ? { ...x, status: "LISTO", error: "", progress: 0 } : x)));
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
      {/* Header */}
      <div className="rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div className="px-6 py-5 border-b">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold leading-tight">Subir Actas</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Sube PDFs a <span className="font-mono">inbox/{dateFolder}</span> para que el servicio las renombre automáticamente.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge>Total: {totals.total}</Badge>
              <Badge>Listo: {totals.ready}</Badge>
              <Badge>Subiendo: {totals.uploading}</Badge>
              <Badge>OK: {totals.done}</Badge>
              <Badge>Error: {totals.error}</Badge>
              <Badge>Peso: {bytesToHuman(totals.bytes)}</Badge>
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

        {/* Controls */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4 space-y-1">
              <div className="text-sm font-medium">Fecha (carpeta)</div>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
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
              <div className="text-xs text-muted-foreground">
                Recomendado: 1–2. Más alto puede fallar si la red es lenta.
              </div>
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
              <span className="font-mono">guias_actas/actas_servicio/inbox/{dateFolder}/</span>
            </div>
          </div>

          {/* List */}
          <div className="rounded-2xl border overflow-hidden">
            {items.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Aún no has agregado PDFs.</div>
            ) : (
              <div className="divide-y">
                {items.map((it) => (
                  <div key={it.id} className="p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium truncate max-w-[780px]">{it.file.name}</div>
                          <Badge tone={statusTone(it.status)}>{it.status}</Badge>
                          <span className="text-xs text-muted-foreground">{bytesToHuman(it.file.size)}</span>
                        </div>

                        <div className="text-xs text-muted-foreground mt-1 break-all">
                          Destino:{" "}
                          <span className="font-mono">{it.storagePath || buildStoragePath(it.file.name, it.id)}</span>
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
                              subirOne(it)
                                .then(() => startAutoOk()) // ✅ también inicia auto OK si subes 1x1
                                .catch((e) =>
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
                                subirOne({ ...it, status: "LISTO", progress: 0 })
                                  .then(() => startAutoOk())
                                  .catch((e) =>
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

          <div className="text-xs text-muted-foreground">
            Tip: ya estamos “sanitizando” nombres para evitar caracteres raros (como <span className="font-mono">?</span>)
            antes de subir.
          </div>

          {/* =========================
              Resultado final (OK)
          ========================= */}
          <div className="rounded-2xl border bg-card text-card-foreground shadow-sm mt-6">
            <div className="px-6 py-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Resultado final (OK)</div>
                <div className="text-sm text-muted-foreground break-all">
                  Carpeta: <span className="font-mono">{okPrefix}/</span>
                </div>
                {autoOkMsg ? (
                  <div className="mt-2">
                    <Badge tone="info">{autoOkMsg}</Badge>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
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
                  disabled={!okFiles.length}
                >
                  Descargar ZIP
                </button>

                {autoOk ? (
                  <button
                    type="button"
                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    onClick={stopAutoOk}
                  >
                    Detener
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    onClick={startAutoOk}
                  >
                    Auto-actualizar
                  </button>
                )}
              </div>
            </div>

            <div className="px-6 py-4">
              {okFiles.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No hay archivos en OK todavía. (Si acabas de subir, espera unos segundos: se renombra y aparece aquí.)
                </div>
              ) : (
                <div className="divide-y rounded-xl border overflow-hidden">
                  {okFiles.map((f) => (
                    <div key={f.fullPath} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate max-w-[880px]">{f.name}</div>
                        <div className="text-xs text-muted-foreground break-all mt-1">{f.fullPath}</div>
                      </div>
                      <button
                        type="button"
                        className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => downloadOneOk(f)}
                      >
                        Descargar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
