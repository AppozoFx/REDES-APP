"use client";

import { useState, useEffect } from "react";
import { db } from "@/firebaseConfig";
import { 
    doc, 
    updateDoc, 
    collection, 
    query, 
    orderBy, 
    where, 
    onSnapshot 
  } from "firebase/firestore";
  
import { Bell } from "lucide-react";
import dayjs from "dayjs";

export default function Notificaciones() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    const inicioDia = dayjs().startOf('day').toDate();

    const q = query(
      collection(db, "notificaciones"),
      where("fecha", ">=", inicioDia),
      orderBy("fecha", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const datos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setNotificaciones(datos);
    });

    return () => unsubscribe();
  }, []);

  const handleMostrar = async () => {
    setMostrar(!mostrar);

    // Marcar como leídas al abrir
    if (!mostrar) {
      const noLeidas = notificaciones.filter(n => !n.leida);
      noLeidas.forEach(async (notif) => {
        await updateDoc(doc(db, "notificaciones", notif.id), { leida: true });
      });
    }
  };

  const colorPorTipo = (tipo) => {
    switch (tipo) {
      case "Liquidación": return "border-blue-500";
      case "Despacho": return "border-green-500";
      case "Devolución": return "border-yellow-500";
      default: return "border-gray-400";
    }
  };

  

  return (
    <div className="relative">
      <button onClick={handleMostrar} className="relative">
        <Bell className="w-6 h-6 text-gray-700 dark:text-gray-300 hover:text-[#ff6413]" />
        {notificaciones.some(n => !n.leida) && (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-2">
            {notificaciones.filter(n => !n.leida).length}
          </span>
        )}
      </button>

      {mostrar && (
        <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-[#1c1c1e] shadow-lg rounded border z-50 max-h-96 overflow-auto">
          <div className="p-3 font-bold border-b text-gray-700 dark:text-gray-200">Notificaciones de Hoy</div>
          {notificaciones.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No hay notificaciones recientes.</p>
          ) : (
            notificaciones.map(notif => (
              <div key={notif.id} className={`p-3 border-l-4 ${colorPorTipo(notif.tipo)} mb-1`}>
                <p className="text-sm">{notif.mensaje}</p>
                {notif.link && (
                  <a href={notif.link} target="_blank" className="text-blue-600 text-xs">📄 Ver Comprobante</a>
                )}
                <div className="text-gray-400 text-xs mt-1">
                  {dayjs(notif.fecha?.toDate()).format("DD/MM/YYYY HH:mm")}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
