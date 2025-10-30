"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/context/AuthContext";
import { db } from "@/firebaseConfig";
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import dayjs from "dayjs";

const storage = getStorage();

/* ---------- UI helpers ---------- */
const PowerButton = ({ active, onClick }) => (
  <button
    onClick={onClick}
    className={`group relative inline-flex items-center gap-3 rounded-2xl px-5 py-3 text-white font-bold shadow-lg transition
      ${active
        ? "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
        : "bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700"}`}
    title={active ? "Desactivar comunicados" : "Activar comunicados"}
  >
    <span className={`h-3 w-3 rounded-full shadow ${active ? "bg-white" : "bg-white"} animate-pulse`} />
    {active ? "Comunicados ACTIVO" : "Comunicados INACTIVO"}
    <span
      className={`absolute -inset-1 -z-10 blur-xl opacity-40 rounded-2xl ${
        active ? "bg-emerald-400" : "bg-rose-400"
      }`}
    />
  </button>
);

const IconBtn = ({ children, onClick, tone = "default", title }) => {
  const tones = {
    default:
      "bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    primary: "bg-blue-600 text-white hover:bg-blue-700",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-9 px-3 rounded-md text-sm font-medium transition ${tones[tone]}`}
    >
      {children}
    </button>
  );
};

/* ---------- List row ---------- */
const BroadcastSlideRow = ({ slide, idx, onEdit, onDelete, onMoveUp, onMoveDown }) => (
  <div className="flex items-center gap-3 p-3 rounded-xl border bg-white dark:bg-slate-900 dark:border-slate-700 shadow-sm">
    <div className="w-16 h-16 rounded-lg overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800">
      {slide.imageUrl ? (
        <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center text-[10px] text-slate-400">
          Sin imagen
        </div>
      )}
    </div>

    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold truncate">
        #{idx + 1} · {slide.headline || "Sin título"}
      </div>
      <div className="text-xs text-slate-500 line-clamp-2 break-words">
        {slide.text || "—"}
      </div>
    </div>

    <div className="hidden sm:flex flex-col gap-1">
      <IconBtn title="Subir" onClick={onMoveUp}>↑</IconBtn>
      <IconBtn title="Bajar" onClick={onMoveDown}>↓</IconBtn>
    </div>

    <div className="flex gap-2">
      <IconBtn tone="primary" onClick={onEdit} title="Editar">
        Editar
      </IconBtn>
      <IconBtn tone="danger" onClick={onDelete} title="Eliminar">
        Eliminar
      </IconBtn>
    </div>
  </div>
);

/* ---------- Dropzone ---------- */
const ImageDropzone = ({ value, onFile, uploading, pct }) => {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`group relative w-full aspect-[16/10] rounded-xl border-2 border-dashed overflow-hidden
        ${
          dragOver
            ? "border-blue-500 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/20"
            : "border-slate-300 dark:border-slate-700"
        }`}
      role="region"
      aria-label="Cargar imagen por arrastre o selección"
    >
      {value ? (
        <img src={value} alt="Vista previa" className="w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-center px-4">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Arrastra tu imagen aquí</div>
            <div className="text-xs text-slate-500">o usa el botón para seleccionar</div>
          </div>
        </div>
      )}

      {/* overlay inferior */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent flex justify-between items-end">
        <div className="text-white text-xs opacity-90">{value ? "Vista previa" : "Sin imagen"}</div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-white text-slate-800 px-3 py-1.5 text-sm font-semibold shadow-md hover:shadow-lg"
        >
          Seleccionar imagen
          <svg width="16" height="16" viewBox="0 0 24 24" className="opacity-80">
            <path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l2 2l2-2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-3 12l-2.5-3.15L11 14l-2-2.5L6 15h10Z"/>
          </svg>
        </button>
      </div>

      {uploading && (
        <div className="absolute inset-x-3 bottom-3 h-2 bg-white/50 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
};

/* ---------- MOBILE PREVIEW ---------- */
const PhonePreview = ({ slides, active }) => {
  const [idx, setIdx] = useState(0);
  const current = slides[idx] || {};

  useEffect(() => {
    if (idx > slides.length - 1) setIdx(0);
  }, [slides, idx]);

  return (
    <div className="w-full">
      <div className="mx-auto rounded-[2.2rem] border bg-slate-900 border-slate-700 shadow-2xl"
           style={{ width: 390, height: 760 }}>
        {/* barra de estado */}
        <div className="h-10 flex items-center justify-between px-5 text-[11px] text-slate-200">
          <span>2:00</span>
          <div className="flex items-center gap-1">
            <span>5G</span>
            <span>▮▮▮</span>
            <span>🔋</span>
          </div>
        </div>
        {/* contenido app */}
        <div className="px-5">
          <h3 className="text-[22px] font-extrabold text-slate-100 text-center">
            Comunicado interno
          </h3>

          {/* imagen */}
          <div className="mt-4 w-full aspect-square rounded-xl overflow-hidden bg-slate-800">
            {current.imageUrl ? (
              <img src={current.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-slate-400 text-sm">
                Sin imagen
              </div>
            )}
          </div>

          {/* título / texto */}
          <div className="mt-5 text-center">
            <div className="text-slate-100 font-semibold text-[16px]">
              {current.headline || "Título del comunicado"}
            </div>
            <div className="text-slate-300 text-[13px] mt-2 leading-snug">
              {current.text || "Texto del comunicado"}
            </div>
          </div>

          {/* dots */}
          <div className="flex items-center justify-center gap-2 mt-6">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-2.5 h-2.5 rounded-full ${i === idx ? "bg-blue-400" : "bg-slate-600"}`}
              />
            ))}
          </div>

          {/* botón continuar */}
          <div className="mt-6">
            <button
              className="w-full rounded-xl py-3 text-[15px] font-bold text-slate-900 bg-blue-300/90 hover:bg-blue-300 transition"
              disabled={!active}
              title={active ? "Continuar" : "Comunicados inactivos"}
            >
              Continuar
            </button>
            {!active && (
              <div className="text-center text-[11px] text-slate-400 mt-2">
                (Vista previa: comunicados inactivos)
              </div>
            )}
          </div>

          {/* footer */}
          <div className="text-center text-[11px] text-slate-400 mt-5">
            Información interna de Redes M&D
          </div>
        </div>
      </div>

      {/* controles de pase rápido */}
      {slides.length > 1 && (
        <div className="mt-2 flex justify-center gap-2">
          <IconBtn onClick={() => setIdx((p) => (p - 1 + slides.length) % slides.length)}>Anterior</IconBtn>
          <IconBtn onClick={() => setIdx((p) => (p + 1) % slides.length)}>Siguiente</IconBtn>
        </div>
      )}
    </div>
  );
};

/* ---------- PAGE ---------- */
export default function PageComunicados() {
  const router = useRouter();
  const { userData } = useAuth();

  // remoto
  const [active, setActive] = useState(false);
  const [slides, setSlides] = useState([]);
  const slidesCount = slides?.length || 0;

  // validUntil (global)
  const [validUntilInput, setValidUntilInput] = useState(""); // "YYYY-MM-DDTHH:mm"
  const [validUntilTs, setValidUntilTs] = useState(null);     // Timestamp | null

  // editor
  const [editIdx, setEditIdx] = useState(-1);
  const [form, setForm] = useState({ headline: "", text: "", imageUrl: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // gate
  useEffect(() => {
    if (!userData) return;
    const ok = ["TI", "Gerencia", "Gestor"].some((r) => userData.rol?.includes?.(r));
    if (!ok) router.push("/no-autorizado");
  }, [userData, router]);

  // subscribe
  useEffect(() => {
    const ref = doc(db, "app_broadcasts", "current");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setDoc(ref, { active: false, slides: [] });
        return;
      }
      const data = snap.data() || {};
      setActive(Boolean(data.active));
      setSlides(Array.isArray(data.slides) ? data.slides : []);

      // validUntil: soporta Timestamp, número ms, ISO string
      let v = data.validUntil ?? null;
      let date = null;
      if (v?.toDate) date = v.toDate();
      else if (typeof v === "number") date = new Date(v);
      else if (typeof v === "string") date = new Date(v);

      setValidUntilTs(date ? Timestamp.fromDate(date) : null);
      setValidUntilInput(date ? dayjs(date).format("YYYY-MM-DDTHH:mm") : "");

      setLoaded(true);
    });
    return () => unsub();
  }, []);

  // activar/desactivar (botón grande)
  const toggleActive = async () => {
    try {
      await updateDoc(doc(db, "app_broadcasts", "current"), { active: !active });
    } catch (e) {
      console.error(e);
      alert("No se pudo actualizar el estado.");
    }
  };

  // editor
  const startNew = () => {
    setEditIdx(-1);
    setForm({ headline: "", text: "", imageUrl: "" });
  };
  const startEdit = (idx) => {
    const s = slides[idx];
    setEditIdx(idx);
    setForm({ headline: s.headline || "", text: s.text || "", imageUrl: s.imageUrl || "" });
  };

  const handleFile = (file) => {
    if (!file) return;
    const safeName = file.name.replace(/\s+/g, "_");
    const path = `comunicados/${dayjs().format("YYYYMMDD_HHmmss")}_${safeName}`;
    const ref = sRef(storage, path);
    const task = uploadBytesResumable(ref, file);
    setUploading(true);
    setUploadPct(0);

    task.on(
      "state_changed",
      (snap) => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => {
        console.error(err);
        setUploading(false);
        alert("Error subiendo la imagen.");
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        setForm((f) => ({ ...f, imageUrl: url }));
        setUploading(false);
      }
    );
  };

  const saveSlide = async () => {
    if (!form.headline?.trim()) {
      alert("Coloca un título (headline).");
      return;
    }
    setSaving(true);
    try {
      const next = [...slides];
      const payload = {
        headline: form.headline.trim(),
        text: form.text?.trim() || "",
        imageUrl: form.imageUrl || "",
      };
      if (editIdx === -1) next.push(payload);
      else next[editIdx] = payload;

      await updateDoc(doc(db, "app_broadcasts", "current"), { slides: next });
      setSlides(next);
      startNew();
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el comunicado.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSlide = async (idx) => {
    if (!confirm("¿Eliminar este comunicado?")) return;
    try {
      const next = slides.filter((_, i) => i !== idx);
      await updateDoc(doc(db, "app_broadcasts", "current"), { slides: next });
      setSlides(next);
      if (editIdx === idx) startNew();
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar.");
    }
  };

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= slides.length) return;
    const next = [...slides];
    [next[idx], next[j]] = [next[j], next[idx]];
    try {
      await updateDoc(doc(db, "app_broadcasts", "current"), { slides: next });
      setSlides(next);
    } catch (e) {
      console.error(e);
      alert("No se pudo reordenar.");
    }
  };

  // guardar validUntil
  const saveValidUntil = async () => {
    try {
      let payload = { validUntil: null };
      if (validUntilInput) {
        const d = new Date(validUntilInput);
        if (!isNaN(d.getTime())) payload.validUntil = Timestamp.fromDate(d);
      }
      await updateDoc(doc(db, "app_broadcasts", "current"), payload);
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar la caducidad.");
    }
  };

  // tiempo restante
  const now = dayjs();
  const remainingText = useMemo(() => {
    if (!validUntilTs) return "Sin caducidad";
    const end = dayjs(validUntilTs.toDate());
    if (end.isBefore(now)) return "CADUCADO";
    const h = end.diff(now, "hour");
    const m = end.diff(now.add(h, "hour"), "minute");
    return `Faltan ${h}h ${m}m`;
  }, [validUntilTs, now]);

  if (!loaded) {
    return (
      <div className="p-4 space-y-4">
        <div className="animate-pulse h-7 w-56 bg-slate-200 rounded" />
        <div className="animate-pulse h-28 w-full bg-slate-100 rounded" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 text-slate-900 dark:text-slate-100">
      {/* Header con botón grande */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Comunicados (Broadcasts)</h1>
          <p className="text-xs text-slate-500">
            Colección: <code>app_broadcasts/current</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            Slides: <b>{slidesCount}</b>
          </span>
          <PowerButton active={active} onClick={toggleActive} />
        </div>
      </div>

      {/* ValidUntil (caducidad) */}
      <section className="p-4 rounded-2xl border bg-white dark:bg-slate-900 dark:border-slate-700 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Caducidad del comunicado</h2>
            <p className="text-xs text-slate-500">
              Al llegar a esta fecha y hora, el comunicado dejará de mostrarse en la app.
            </p>
          </div>
          <div className="text-sm">
            <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
              {remainingText}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <input
            type="datetime-local"
            value={validUntilInput}
            onChange={(e) => setValidUntilInput(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:border-slate-600"
          />
          <IconBtn tone="primary" onClick={saveValidUntil} title="Guardar caducidad">
            Guardar caducidad
          </IconBtn>
          <IconBtn
            onClick={async () => {
              setValidUntilInput("");
              await updateDoc(doc(db, "app_broadcasts", "current"), { validUntil: null });
            }}
            title="Quitar caducidad"
          >
            Quitar
          </IconBtn>
        </div>
      </section>

      {/* Lista de slides */}
      <section className="space-y-2">
        {slides.length === 0 ? (
          <div className="p-4 rounded-xl border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm">
            No hay comunicados. Crea el primero 👇
          </div>
        ) : (
          slides.map((s, i) => (
            <BroadcastSlideRow
              key={i}
              slide={s}
              idx={i}
              onEdit={() => startEdit(i)}
              onDelete={() => deleteSlide(i)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))
        )}
      </section>

      {/* Editor + Vista previa móvil lado a lado */}
      <section className="grid xl:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="p-4 rounded-2xl border bg-white dark:bg-slate-900 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {editIdx === -1 ? "Nuevo comunicado" : `Editar #${editIdx + 1}`}
            </h2>
            <IconBtn onClick={startNew} title="Nuevo">
              Nuevo
            </IconBtn>
          </div>

          <div className="grid md:grid-cols-5 gap-5">
            {/* Form textual */}
            <div className="md:col-span-3 space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Título (headline)</label>
                <input
                  value={form.headline}
                  onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:border-slate-600"
                  placeholder="Mantenimiento programado"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Texto</label>
                <textarea
                  value={form.text}
                  onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                  rows={5}
                  className="w-full border rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:border-slate-600"
                  placeholder="El servidor estará en mantenimiento el domingo de 2 a 4 AM."
                />
              </div>
              <div className="flex justify-end">
                <IconBtn tone="primary" onClick={saveSlide} title="Guardar">
                  {saving ? "Guardando..." : "Guardar comunicado"}
                </IconBtn>
              </div>
            </div>

            {/* Uploader */}
            <div className="md:col-span-2 space-y-2">
              <label className="block text-xs font-semibold">Imagen (opcional)</label>
              <ImageDropzone
                value={form.imageUrl}
                onFile={handleFile}
                uploading={uploading}
                pct={uploadPct}
              />
              <p className="text-[11px] text-slate-500">
                Recomendado: cuadrado (1:1) o 4:5 para móvil. &lt; 500KB.
              </p>
            </div>
          </div>
        </div>

        {/* Vista previa móvil */}
        <div className="p-4 rounded-2xl border bg-white dark:bg-slate-900 dark:border-slate-700 shadow-sm">
          <h3 className="font-semibold mb-3">Vista previa como en el celular</h3>
          <PhonePreview slides={slides.length ? slides : [form]} active={active} />
        </div>
      </section>
    </div>
  );
}
