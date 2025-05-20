// NotificacionListener.jsx
"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, orderBy, serverTimestamp, updateDoc, doc } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import NotificacionFlotante from "./NotificacionFlotante";
import { useAuth } from "@/app/context/AuthContext";

export default function NotificacionListener() {
  const { userData } = useAuth();
  const [notificacion, setNotificacion] = useState({ visible: false, mensaje: "", tipo: "info" });

  useEffect(() => {
    if (!userData) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, "notificaciones"),
      where("fecha", ">=", serverTimestamp()),
      orderBy("fecha", "desc")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();

        // Mostrar solo si no fue leída
        if (change.type === "added" && !data.leida) {
          setNotificacion({
            visible: true,
            mensaje: data.mensaje || "Nueva notificación",
            tipo: data.tipo === "Liquidación" ? "exito" : "info"
          });

          // Marcar como leída
          updateDoc(doc(db, "notificaciones", change.doc.id), {
            leida: true
          });
        }
      });
    });

    return () => unsub();
  }, [userData]);

  return (
    <NotificacionFlotante
      visible={notificacion.visible}
      mensaje={notificacion.mensaje}
      tipo={notificacion.tipo}
      onClose={() => setNotificacion({ ...notificacion, visible: false })}
    />
  );
}
