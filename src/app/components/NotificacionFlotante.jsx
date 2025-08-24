"use client";
import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";

export default function NotificacionFlotante() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "notificaciones"), orderBy("fecha", "desc"), limit(1));
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== "added") return;
        setToast({ id: ch.doc.id, ...ch.doc.data() });
        const t = setTimeout(() => setToast(null), 7000);
        return () => clearTimeout(t);
      });
    });
    return () => unsub();
  }, []);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.18 }}
          className="fixed right-4 top-4 z-[60] w-[92vw] max-w-sm"
        >
          <div className="relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-white/90 shadow-[0_10px_30px_var(--shadow)] backdrop-blur dark:bg-white/5">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[color:var(--brand)]" />
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-sm font-semibold">{toast.tipo || "Notificación"}</h4>
                <p className="mt-0.5 text-sm">{toast.mensaje}</p>
                {toast.link && (
                  <a href={toast.link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[color:var(--brand)] underline">
                    Ver comprobante
                  </a>
                )}
              </div>
              <button onClick={() => setToast(null)} className="rounded-md p-1 text-slate-500 hover:bg-white/60" aria-label="Cerrar">✕</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
