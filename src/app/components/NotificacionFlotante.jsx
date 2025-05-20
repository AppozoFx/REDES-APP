"use client";

import { useState, useEffect } from "react";
import { db } from "@/firebaseConfig"; // Asegúrate que la ruta sea correcta si está en /src
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
          // Sugerencias para Modo Oscuro:
          className="fixed top-4 right-4 bg-white dark:bg-gray-800 shadow-lg dark:shadow-2xl border-l-4 border-blue-500 dark:border-blue-400 p-4 rounded w-80 z-50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
        >
            <div className="flex items-start gap-2">
                <span>🔔</span>
                    <div className="flex-1">
          <h4 className="font-bold text-blue-600 dark:text-blue-300 mb-1">{nuevaNotificacion.tipo}</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">{nuevaNotificacion.mensaje}</p>
          {nuevaNotificacion.link && (
            <a
              href={nuevaNotificacion.link}
            
              target="_blank"
              // Sugerencias para Modo Oscuro:
              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs underline mt-2 inline-block"
            >
              Ver Comprobante
            </a>
          )}
          </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
