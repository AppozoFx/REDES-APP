"use client";

import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, query, where, orderBy, updateDoc, doc } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { useAuth } from "@/app/context/AuthContext";
import NotificacionFlotante from "./NotificacionFlotante";

export default function NotificacionListener() {
  const { userData } = useAuth();
  const [toast, setToast] = useState({ visible: false, mensaje: "", tipo: "info", link: null, titulo: "" });
  const latestIdRef = useRef(null);

  useEffect(() => {
    if (!userData) return;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, "notificaciones"),
      where("fecha", ">=", hoy),
      orderBy("fecha", "desc")
    );

    const unsub = onSnapshot(q, async (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        const data = change.doc.data();

        // Evita duplicados rápidos
        if (latestIdRef.current === change.doc.id) return;
        latestIdRef.current = change.doc.id;

        if (!data.leida) {
          setToast({
            visible: true,
            mensaje: data.mensaje || "Nueva notificación",
            tipo: data.tipo === "Liquidación" ? "exito" : data.tipo === "Devolución" ? "alerta" : "info",
            link: data.link || null,
            titulo: data.tipo || "Notificación",
          });

          try {
            await updateDoc(doc(db, "notificaciones", change.doc.id), { leida: true });
          } catch (e) {
            console.error("No se pudo marcar como leída:", e);
          }
        }
      });
    });

    return () => unsub();
  }, [userData]);

  return (
    <NotificacionFlotante
      visible={toast.visible}
      titulo={toast.titulo}
      mensaje={toast.mensaje}
      tipo={toast.tipo}
      link={toast.link}
      onClose={() => setToast((t) => ({ ...t, visible: false }))}
      duration={5000}
    />
  );
}
