"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { db } from "@/firebaseConfig";
import {
  doc,
  updateDoc,
  collection,
  query,
  orderBy,
  where,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { Bell, HandCoins, Package, PackageOpen, ExternalLink } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.locale("es");

const tipoMeta = (tipo) => {
  switch (tipo) {
    case "Liquidación":
      return { icon: <HandCoins size={16} strokeWidth={1.75} />, ring: "ring-blue-500/20", dot: "bg-blue-500", pill: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200" };
    case "Despacho":
      return { icon: <Package size={16} strokeWidth={1.75} />, ring: "ring-emerald-500/20", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200" };
    case "Devolución":
      return { icon: <PackageOpen size={16} strokeWidth={1.75} />, ring: "ring-amber-500/20", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200" };
    default:
      return { icon: <Bell size={16} strokeWidth={1.75} />, ring: "ring-slate-400/20", dot: "bg-slate-400", pill: "bg-slate-50 text-slate-700 dark:bg-white/10 dark:text-slate-200" };
  }
};

export default function Notificaciones() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const inicioDia = dayjs().startOf("day").toDate();

    const q = query(
      collection(db, "notificaciones"),
      where("fecha", ">=", inicioDia),
      orderBy("fecha", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNotificaciones(datos);
    });

    return () => unsubscribe();
  }, []);

  const noLeidas = useMemo(() => notificaciones.filter((n) => !n.leida), [notificaciones]);

  const marcarTodasComoLeidas = useCallback(async () => {
    if (noLeidas.length === 0) return;
    const batch = writeBatch(db);
    noLeidas.forEach((n) => batch.update(doc(db, "notificaciones", n.id), { leida: true }));
    try {
      await batch.commit();
    } catch (e) {
      console.error("Error marcando como leídas:", e);
    }
  }, [noLeidas]);

  const toggle = useCallback(async () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo) await marcarTodasComoLeidas();
  }, [abierto, marcarTodasComoLeidas]);

  return (
    <div className="relative">
      {/* Botón campana */}
      <button
        onClick={toggle}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className="relative rounded-lg p-1.5 hover:bg-white/70 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/35"
        title="Notificaciones"
      >
        <Bell className="h-6 w-6 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
        {noLeidas.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white shadow">
            {noLeidas.length}
          </span>
        )}
      </button>

      {/* Panel */}
      {abierto && (
        <div
          role="dialog"
          aria-label="Notificaciones"
          className="absolute right-0 mt-2 w-[420px] max-w-[90vw] z-50"
        >
          <div className="card card--gradient overflow-hidden">
            <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-white/60 px-3 py-2.5 dark:bg-white/5">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">Notificaciones de hoy</p>
              <button
                onClick={marcarTodasComoLeidas}
                className="text-xs font-semibold text-[color:var(--brand)] hover:underline"
              >
                Marcar como leídas
              </button>
            </div>

            {notificaciones.length === 0 ? (
              <p className="p-4 text-sm text-slate-500 dark:text-slate-300">No hay notificaciones recientes.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-[color:var(--line)] overflow-auto soft-scrollbar">
                {notificaciones.map((n) => {
                  const meta = tipoMeta(n.tipo);
                  const fecha = n.fecha?.toDate ? n.fecha.toDate() : n.fecha;
                  return (
                    <li key={n.id} className="flex gap-3 px-3 py-3 hover:bg-white/60 dark:hover:bg-white/5">
                      {/* dot tipo */}
                      <span className={`mt-1.5 inline-block h-2.5 w-2.5 flex-none rounded-full ${meta.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.pill}`}>
                            {meta.icon}
                            {n.tipo || "Info"}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {fecha ? dayjs(fecha).fromNow() : ""}
                          </span>
                        </div>

                        <p className="text-sm text-slate-700 dark:text-slate-200">{n.mensaje}</p>

                        {n.link && (
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand)] hover:underline"
                          >
                            Ver comprobante <ExternalLink size={12} />
                          </a>
                        )}
                      </div>

                      {/* estado leída */}
                      <span
                        className={`
                          mt-0.5 h-3 w-3 flex-none rounded-full ring-4 ${meta.ring}
                          ${n.leida ? "bg-slate-300" : meta.dot}
                        `}
                        title={n.leida ? "Leída" : "No leída"}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
