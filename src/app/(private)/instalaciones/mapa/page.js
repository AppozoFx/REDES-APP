// src/app/instalaciones/mapa/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/context/AuthContext";
import dynamic from "next/dynamic";
import L from "leaflet";
import dayjs from "dayjs";
import "dayjs/locale/es";
dayjs.locale("es");

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

/* React-Leaflet (SSR off) */
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => ({ default: m.MapContainer })),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => ({ default: m.TileLayer })),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => ({ default: m.Marker })),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => ({ default: m.Popup })),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import("react-leaflet").then((m) => ({ default: m.Tooltip })),
  { ssr: false }
);

// Cluster group (SSR off)
const MarkerClusterGroup = dynamic(
  () => import("react-leaflet-markercluster").then((m) => ({ default: m.default || m })),
  { ssr: false }
);

/* Paleta: Agendada = negro */
const colorByEstado = {
  Finalizada: "#1d4ed8",
  Cancelada: "#dc2626",
  "En camino": "#7c3aed",
  Iniciada: "#10b981",
  Agendada: "#000000",
  default: "#34495e",
};

const createCircleIcon = (color) =>
  new L.DivIcon({
    html: `
      <div style="
        background:${color};
        width:18px;height:18px;border-radius:50%;
        border:2px solid #ffffff;
        box-shadow:0 0 3px rgba(0,0,0,0.4);
      "></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });

const createClusterIcon = (cluster) => {
  const count = cluster.getChildCount();
  const size = count < 10 ? 26 : count < 50 ? 34 : count < 200 ? 42 : 50;
  const bg =
    count < 10 ? "#1d4ed8" : count < 50 ? "#7c3aed" : count < 200 ? "#dc2626" : "#111827";
  return L.divIcon({
    html: `<div style="
      background:${bg};color:#fff;width:${size}px;height:${size}px;
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      box-shadow:0 6px 16px rgba(0,0,0,.25);font-weight:700">${count}</div>`,
    className: "cluster-marker",
    iconSize: [size, size],
  });
};

// Iconos para cuadrillas en tiempo real
const iconCondominio = new L.Icon({
  iconUrl: "/image/condominio.png",
  iconSize: [36, 36],
  iconAnchor: [18, 34],
  popupAnchor: [0, -28],
});

const iconResidencial = new L.Icon({
  iconUrl: "/image/residencial.png",
  iconSize: [36, 36],
  iconAnchor: [18, 34],
  popupAnchor: [0, -28],
});

// Icono con pulso para destacar cuadrillas en tiempo real
const createCuadrillaIcon = (esCondominio) =>
  new L.DivIcon({
    html: `
      <div class="cuad-marker">
        <span class="pulse"></span>
        <span class="pulse pulse2"></span>
        <img src="/image/${esCondominio ? "condominio" : "residencial"}.png" alt="cuadrilla" />
      </div>
    `,
    className: "",
    iconSize: [52, 52],
    iconAnchor: [26, 42],
    popupAnchor: [0, -34],
  });

const EstadoPill = ({ estado }) => {
  const bg = colorByEstado[estado] || colorByEstado.default;
  return (
    <span
      style={{
        background: bg,
        color: "#fff",
        borderRadius: 9999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        display: "inline-block",
      }}
    >
      {estado || "Sin estado"}
    </span>
  );
};

// helpers: fecha string ISO -> comparables por prefijo YYYY-MM-DD
const toDayKeyFromISO = (s) => {
  if (!s) return "";
  // "2025-04-11T08:00:00.000Z" => "2025-04-11"
  if (typeof s === "string") return s.slice(0, 10);
  return "";
};

export default function MapaInstalaciones() {
  const router = useRouter();
  const { userData } = useAuth();

  const [isClient, setIsClient] = useState(false);
  const mapRef = useRef(null);

  const [instalaciones, setInstalaciones] = useState([]);
  // Info de cuadrillas (nombre, categoria, etc.)
  const [cuadrillasInfo, setCuadrillasInfo] = useState({});
  // Ubicaciones en tiempo real por cuadrilla { [id]: { lat, lng, tipo, updatedAt } }
  const [ubicacionesCuadrillas, setUbicacionesCuadrillas] = useState({});
  const [filtroCuadrilla, setFiltroCuadrilla] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [fechaFiltro, setFechaFiltro] = useState(() => dayjs().format("YYYY-MM-DD"));

  // basemap
  const [base, setBase] = useState("osm");
  const baseLayers = {
    osm: {
      name: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: "&copy; OpenStreetMap contributors",
    },
    voyager: {
      name: "Carto · Voyager",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attr: "&copy; OSM, &copy; CARTO",
    },
    dark: {
      name: "Carto · Dark Matter",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attr: "&copy; OSM, &copy; CARTO",
    },
  };

  // altura dinámica (evita scroll de página)
  const outerRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(600);
  const recalcHeight = () => {
    if (!outerRef.current) return;
    const top = outerRef.current.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const h = Math.max(260, Math.floor(vh - top - 48));
    setMapHeight(h);
  };

  useEffect(() => setIsClient(true), []);
  useEffect(() => {
    if (!userData || !["Gestor", "Gerencia", "Almacén"].some((r) => userData.rol?.includes(r))) {
      router.push("/no-autorizado");
    }
  }, [userData, router]);

  /**
   * ✅ CAMBIO CLAVE (sin cambiar tu lógica):
   * Antes: getDocs(collection("instalaciones")) => trae TODO (explota cuotas)
   * Ahora: trae SOLO el día seleccionado usando rango de strings ISO por prefijo.
   * Mantiene tu filtrado por cuadrilla/estado en el cliente (misma UX).
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const ref = collection(db, "instalaciones");

      // Como fechaInstalacion es string tipo ISO "YYYY-MM-DDTHH:mm:ss.sssZ",
      // usamos rango por strings basados en "YYYY-MM-DD"
      const startStr = dayjs(fechaFiltro).format("YYYY-MM-DD");
      const endStr = dayjs(fechaFiltro).add(1, "day").format("YYYY-MM-DD");

      // Rangos por prefijo: >= "2025-04-11" y < "2025-04-12"
      // Esto funciona porque el ISO empieza con "YYYY-MM-DD..."
      const qA = query(
        ref,
        where("fechaInstalacion", ">=", startStr),
        where("fechaInstalacion", "<", endStr),
        orderBy("fechaInstalacion", "asc"),
        limit(5000)
      );

      const snap = await getDocs(qA);
      if (cancelled) return;

      // misma estructura de datos
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // mismo filtro de servicio (tu lógica actual)
      rows = rows.filter((i) => i.tipoServicio !== "GARANTIA");

      setInstalaciones(rows);
    })();

    return () => {
      cancelled = true;
    };
  }, [fechaFiltro]);

  // Suscripción en tiempo real: datos base de cuadrillas y su última ubicación (campos lat/lng/lastLocationAt en el doc)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "cuadrillas"), (snap) => {
      const info = {};
      const ubic = {};
      snap.forEach((d) => {
        const data = d.data() || {};
        info[d.id] = { id: d.id, ...data };

        const lat = typeof data.lat === "number" ? data.lat : Number(data.lat);
        const lng = typeof data.lng === "number" ? data.lng : Number(data.lng);
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          const updatedAt = data.lastLocationAt || data.updatedAt || null;
          const tipoUbicacion = data.categoria || data.tipo || "";
          ubic[d.id] = { lat, lng, tipo: tipoUbicacion, updatedAt };
        }
      });
      setCuadrillasInfo(info);
      setUbicacionesCuadrillas(ubic);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    recalcHeight();
    window.addEventListener("resize", recalcHeight);
    return () => window.removeEventListener("resize", recalcHeight);
  }, []);

  // ✅ Texto de fecha en el encabezado basado en el filtro
  const fechaCabecera = useMemo(() => {
    const d = dayjs(fechaFiltro);
    return d.isValid() ? d.format("dddd, DD MMM YYYY") : dayjs().format("dddd, DD MMM YYYY");
  }, [fechaFiltro]);

  // ✅ Filtro por cuadrilla soportando cuadrillaNombre y cuadrilla
  const instalacionesFiltradas = useMemo(() => {
    const q = (filtroCuadrilla || "").toLowerCase().trim();

    return (instalaciones || []).filter((i) => {
      const coincideCuadrilla =
        q === "" ||
        i.cuadrillaNombre?.toLowerCase().includes(q) ||
        i.cuadrilla?.toLowerCase().includes(q);

      const coincideEstado = !filtroEstado || i.estado === filtroEstado;

      // Mantengo tu lógica: comparar por día (YYYY-MM-DD)
      // Optimizado para string ISO: slice(0,10) evita dayjs() por cada fila
      let f = "";
      if (i.fechaInstalacion) {
        if (typeof i.fechaInstalacion === "string") {
          f = toDayKeyFromISO(i.fechaInstalacion);
        } else if (typeof i.fechaInstalacion?.toDate === "function") {
          f = dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
        }
      }
      const coincideFecha = f === fechaFiltro;

      const servicioOK = i.tipoServicio !== "GARANTIA";

      return coincideCuadrilla && coincideEstado && coincideFecha && servicioOK;
    });
  }, [instalaciones, filtroCuadrilla, filtroEstado, fechaFiltro]);

  // Forzar remount del cluster al cambiar filtros
  const clusterKey = `${filtroCuadrilla}|${filtroEstado}|${fechaFiltro}`;

  // Ajuste de bounds (instalaciones + cuadrillas en tiempo real)
  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = new L.LatLngBounds([]);

    // Instalaciones filtradas
    instalacionesFiltradas.forEach((i) => {
      const { lat, lng } = i.coordenadas || {};
      if (lat && lng) bounds.extend([lat, lng]);
    });

    // Ubicaciones de cuadrillas en tiempo real
    Object.values(ubicacionesCuadrillas || {}).forEach((p) => {
      if (p?.lat && p?.lng) bounds.extend([p.lat, p.lng]);
    });

    if (bounds.isValid()) {
      setTimeout(() => {
        mapRef.current.fitBounds(bounds, { padding: [60, 60] });
      }, 120);
    }
  }, [instalacionesFiltradas, ubicacionesCuadrillas]);

  const limpiarFiltros = () => {
    setFiltroCuadrilla("");
    setFiltroEstado("");
    setFechaFiltro(dayjs().format("YYYY-MM-DD"));
  };

  const conteoPorEstado = useMemo(() => {
    return instalacionesFiltradas.reduce((acc, curr) => {
      const estado = curr.estado || "Sin Estado";
      acc[estado] = (acc[estado] || 0) + 1;
      return acc;
    }, {});
  }, [instalacionesFiltradas]);

  return (
    <div className="p-4 overflow-hidden flex flex-col gap-3 min-h-0 bg-white text-gray-900 dark:bg-[#0f172a] dark:text-gray-100">
      <style>{`
        .cuad-marker { position: relative; width: 52px; height: 52px; }
        .cuad-marker img { width: 48px; height: 48px; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.4)); }
        .cuad-marker .pulse {
          position: absolute; top: 50%; left: 50%; width: 16px; height: 16px;
          margin-left: -8px; margin-top: -8px; border-radius: 9999px;
          background: rgba(16,185,129,0.7); box-shadow: 0 0 0 0 rgba(16,185,129,0.45);
          animation: pulse-cq 1.8s ease-out infinite;
        }
        .cuad-marker .pulse2 { animation-delay: .75s; opacity: .9; }
        @keyframes pulse-cq {
          0% { transform: scale(1); opacity: 0.95; }
          70% { transform: scale(4.5); opacity: 0; }
          100% { opacity: 0; }
        }
        /* Tooltip transparente y redondeado para cuadrillas */
        .leaflet-tooltip.cuad-tooltip {
          background: transparent; border: 0; box-shadow: none; pointer-events: none;
          border-radius: 12px; padding: 4px 8px; font-weight: 700; letter-spacing: .3px;
          color: #111; text-shadow: 0 1px 2px rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.25);
        }
        .dark .leaflet-tooltip.cuad-tooltip { color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
      `}</style>

      {/* Encabezado */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Mapa de Instalaciones</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {fechaCabecera} — {instalacionesFiltradas.length} resultados
          </p>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fechaFiltro}
            onChange={(e) => setFechaFiltro(e.target.value)}
            className="border px-3 py-2 rounded bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600"
          />
          <input
            type="text"
            placeholder="Buscar cuadrilla..."
            value={filtroCuadrilla}
            onChange={(e) => setFiltroCuadrilla(e.target.value)}
            className="border px-3 py-2 rounded bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600"
          />
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="border px-3 py-2 rounded bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600"
          >
            <option value="">Todos los estados</option>
            <option value="Finalizada">Finalizada</option>
            <option value="Cancelada">Cancelada</option>
            <option value="En camino">En camino</option>
            <option value="Iniciada">Iniciada</option>
            <option value="Agendada">Agendada</option>
          </select>
          <button
            onClick={limpiarFiltros}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
          >
            Limpiar
          </button>
        </div>
      </header>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {["Finalizada", "Cancelada", "En camino", "Iniciada", "Agendada"].map((estado) => (
          <div key={estado} className="flex items-center gap-2">
            <span
              className="inline-block w-3.5 h-3.5 rounded-full ring-2 ring-white"
              style={{ backgroundColor: colorByEstado[estado] }}
            />
            <span className="text-gray-700 dark:text-gray-300">
              {estado} ({conteoPorEstado[estado] || 0})
            </span>
          </div>
        ))}
      </div>

      {/* Mapa */}
      <div
        ref={outerRef}
        className="relative w-full border rounded overflow-hidden min-h-0"
        style={{ height: mapHeight }}
      >
        {/* Selector de base */}
        <div className="absolute right-3 top-3 z-[1000] flex items-center gap-2 bg-white/90 dark:bg-black/50 backdrop-blur px-2 py-1 rounded border text-[12px]">
          <span>Mapa:</span>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="bg-transparent outline-none"
          >
            <option value="osm">OpenStreetMap</option>
            <option value="voyager">Carto · Voyager</option>
            <option value="dark">Carto · Dark</option>
          </select>
        </div>

        {isClient && (
          <MapContainer
            center={[-12.05, -77.04]}
            zoom={11}
            scrollWheelZoom
            className="w-full h-full"
            whenCreated={(map) => (mapRef.current = map)}
          >
            <TileLayer key={base} attribution={baseLayers[base].attr} url={baseLayers[base].url} />

            {/* ORDERS / INSTALACIONES agrupadas */}
            <MarkerClusterGroup
              key={`inst-${clusterKey}`}
              chunkedLoading
              showCoverageOnHover={false}
              spiderfyOnEveryZoom
              spiderfyOnMaxZoom
              spiderLegPolylineOptions={{ weight: 3, color: "#2563eb", opacity: 0.85 }}
              spiderfyDistanceMultiplier={1.6}
              iconCreateFunction={createClusterIcon}
            >
              {instalacionesFiltradas.map((i) => {
                const { lat, lng } = i.coordenadas || {};
                if (!lat || !lng) return null;
                const color = colorByEstado[i.estado] || colorByEstado.default;

                const fecha = (() => {
                  if (typeof i.fechaInstalacion === "string") return toDayKeyFromISO(i.fechaInstalacion);
                  if (typeof i.fechaInstalacion?.toDate === "function")
                    return dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
                  return "—";
                })();

                return (
                  <Marker key={i.id} position={[lat, lng]} icon={createCircleIcon(color)}>
                    <Tooltip
                      permanent
                      direction="top"
                      offset={[0, -14]}
                      opacity={1}
                      className="cloud-tooltip"
                    >
                      {(i.cuadrillaNombre || i.cuadrilla || "—").toUpperCase()}
                    </Tooltip>

                    <Popup maxWidth={380}>
                      <div className="text-xs text-gray-900 dark:text-gray-100">
                        <div className="rounded-xl border p-3 bg-white dark:bg-gray-800 shadow-sm">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="font-semibold text-sm md:text-[15px] leading-tight">
                              {i.cuadrillaNombre || i.cuadrilla || "—"}
                              <div className="text-[11px] text-gray-500">{fecha}</div>
                            </div>
                            <EstadoPill estado={i.estado} />
                          </div>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <div>
                              <span className="text-gray-500">Cliente:</span>
                              <div className="font-medium break-words">{i.cliente || "—"}</div>
                            </div>
                            <div>
                              <span className="text-gray-500">Código:</span>{" "}
                              <span className="font-medium">{i.codigoCliente || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Tramo:</span>{" "}
                              <span className="font-medium">{i.tramo || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">En camino:</span>{" "}
                              <span className="font-medium">{i.horaEnCamino || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Inicio:</span>{" "}
                              <span className="font-medium">{i.horaInicio || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Fin:</span>{" "}
                              <span className="font-medium">{i.horaFin || "—"}</span>
                            </div>
                          </div>

                          {(i.plan || i.direccion) && (
                            <div className="mt-2 space-y-1">
                              {i.plan && (
                                <div>
                                  <span className="text-gray-500">Plan:</span>
                                  <div className="font-medium break-words">{i.plan}</div>
                                </div>
                              )}
                              {i.direccion && (
                                <div>
                                  <span className="text-gray-500">Dirección:</span>
                                  <div
                                    className="font-medium whitespace-pre-wrap break-words"
                                    style={{ lineHeight: 1.2 }}
                                  >
                                    {i.direccion}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-center gap-2 pt-3">
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 rounded-md font-semibold shadow-md hover:shadow-lg transition"
                            style={{ background: "#2563eb", color: "#ffffff" }}
                          >
                            Abrir en Google Maps
                          </a>
                          <a
                            href={`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 rounded-md font-semibold shadow-md hover:shadow-lg transition"
                            style={{ background: "#7c3aed", color: "#ffffff" }}
                          >
                            Abrir en Waze
                          </a>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MarkerClusterGroup>

            {/* CUADRILLAS EN TIEMPO REAL */}
            <MarkerClusterGroup
              chunkedLoading
              showCoverageOnHover={false}
              spiderfyOnEveryZoom
              spiderfyOnMaxZoom
              spiderLegPolylineOptions={{ weight: 3, color: "#10b981", opacity: 0.85 }}
              spiderfyDistanceMultiplier={2}
              iconCreateFunction={createClusterIcon}
            >
              {Object.entries(ubicacionesCuadrillas).map(([id, p]) => {
                if (!p?.lat || !p?.lng) return null;
                const info = cuadrillasInfo[id] || {};
                const categoria = String(info.categoria || p.tipo || "").toLowerCase();
                const esCondominio = categoria.includes("condominio");
                const nombre = info.nombre || info.id || id;
                const fechaTxt = (() => {
                  try {
                    if (!p.updatedAt) return "";
                    if (typeof p.updatedAt?.toDate === "function") {
                      return dayjs(p.updatedAt.toDate()).format("DD/MM HH:mm");
                    }
                    if (typeof p.updatedAt === "number") {
                      return dayjs(p.updatedAt).format("DD/MM HH:mm");
                    }
                    if (typeof p.updatedAt === "string") {
                      return String(p.updatedAt);
                    }
                  } catch (_) {}
                  return "";
                })();

                return (
                  <Marker
                    key={`c-${id}`}
                    position={[p.lat, p.lng]}
                    icon={createCuadrillaIcon(esCondominio)}
                    zIndexOffset={1000}
                  >
                    <Tooltip
                      permanent
                      direction="top"
                      offset={[0, -16]}
                      opacity={1}
                      className="cuad-tooltip"
                    >
                      {nombre?.toUpperCase?.() || String(nombre)}
                    </Tooltip>

                    <Popup maxWidth={320}>
                      <div className="text-xs text-gray-900 dark:text-gray-100">
                        <div className="font-semibold mb-1">{nombre}</div>
                        <div className="mb-2">Categoría: {info.categoria || p.tipo || "-"}</div>
                        {fechaTxt && <div className="text-gray-500">Actualizado: {fechaTxt}</div>}

                        <div className="flex items-center justify-center gap-2 pt-2">
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-md font-semibold shadow-md hover:shadow-lg transition"
                            style={{ background: "#2563eb", color: "#ffffff" }}
                          >
                            Google Maps
                          </a>
                          <a
                            href={`https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-md font-semibold shadow-md hover:shadow-lg transition"
                            style={{ background: "#7c3aed", color: "#ffffff" }}
                          >
                            Waze
                          </a>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MarkerClusterGroup>
          </MapContainer>
        )}
      </div>
    </div>
  );
}
