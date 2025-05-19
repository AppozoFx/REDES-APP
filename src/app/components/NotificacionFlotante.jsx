"use client";

import { useState, useEffect } from "react";
import { db } from "@/firebaseConfig";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";

export default function NotificacionFlotante() {
  const [nuevaNotificacion, setNuevaNotificacion] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, "notificaciones"),
      orderBy("fecha", "desc"),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const data = change.doc.data();
          setNuevaNotificacion({
            id: change.doc.id,
            ...data
          });

          // Ocultar automáticamente después de 5 segundos
          setTimeout(() => {
            setNuevaNotificacion(null);
          }, 5000);
        }
      });
    });

    return () => unsubscribe();
  }, []);

  return (
    <AnimatePresence>
      {nuevaNotificacion && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 right-4 bg-white shadow-lg border-l-4 border-blue-500 p-4 rounded w-80 z-50"
        >
          <h4 className="font-bold text-blue-600 mb-1">{nuevaNotificacion.tipo}</h4>
          <p className="text-sm">{nuevaNotificacion.mensaje}</p>
          {nuevaNotificacion.link && (
            <a 
              href={nuevaNotificacion.link} 
              target="_blank" 
              className="text-blue-500 text-xs underline mt-2 inline-block"
            >
              Ver Comprobante
            </a>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
