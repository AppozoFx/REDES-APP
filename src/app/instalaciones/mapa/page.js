"use client";

import { useEffect, useState, useRef } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/context/AuthContext";
import dynamic from "next/dynamic";
import L from "leaflet";
import dayjs from "dayjs"; // 👈 aseguramos formato de fecha

import "leaflet/dist/leaflet.css";

// Carga dinámica de componentes Leaflet
const MapContainer = dynamic(() => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then(m => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then(m => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then(m => m.Popup), { ssr: false });

// Colores por estado
const colorByEstado = {
  Finalizada: "#3498db",
  Cancelada: "#e74c3c",
  "En camino": "#9b59b6",
  Iniciada: "#2ecc71",
  default: "#34495e",
};

// Icono circular por color
const createCircleIcon = (color) =>
  new L.DivIcon({
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });

export default function MapaInstalaciones() {
  const router = useRouter();
  const { userData } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const mapRef = useRef(null);
  const [instalaciones, setInstalaciones] = useState([]);
  const [filtroCuadrilla, setFiltroCuadrilla] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [fechaFiltro, setFechaFiltro] = useState(() =>
    dayjs().format("YYYY-MM-DD")
  );

  useEffect(() => setIsClient(true), []);

  useEffect(() => {
    if (!userData || !["Gestor", "Gerencia", "Almacén"].some(r => userData.rol?.includes(r))) {
      router.push("/no-autorizado");
    }
  }, [userData]);

  useEffect(() => {
    const fetchInstalaciones = async () => {
      const snap = await getDocs(collection(db, "instalaciones"));
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInstalaciones(data);
    };
    fetchInstalaciones();
  }, []);

  // Filtro por cuadrilla, estado y fecha
  const instalacionesFiltradas = instalaciones.filter(i => {
    const cuadrillaCoincide = i.cuadrillaNombre?.toLowerCase().includes(filtroCuadrilla.toLowerCase());
    const estadoCoincide = filtroEstado ? i.estado === filtroEstado : true;

    let fechaInstalacion = "";

    if (i.fechaInstalacion) {
      // ✅ Aquí normalizamos la fecha con dayjs para que sea "YYYY-MM-DD"
      if (typeof i.fechaInstalacion === "string") {
        fechaInstalacion = dayjs(i.fechaInstalacion).format("YYYY-MM-DD");
      } else if (typeof i.fechaInstalacion.toDate === "function") {
        fechaInstalacion = dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
      }
    }

    const fechaCoincide = fechaInstalacion === fechaFiltro;
    const tipoServicioValido = i.tipoServicio !== "GARANTIA";


    return cuadrillaCoincide && estadoCoincide && fechaCoincide && tipoServicioValido;

    
  });

  // Zoom automático a los marcadores visibles
  useEffect(() => {
    if (!mapRef.current) return;

    const bounds = new L.LatLngBounds([]);
    instalacionesFiltradas.forEach(i => {
      if (i.coordenadas?.lat && i.coordenadas?.lng) {
        bounds.extend([i.coordenadas.lat, i.coordenadas.lng]);
      }
    });

    if (bounds.isValid() && instalacionesFiltradas.length > 0) {
      setTimeout(() => {
        mapRef.current.fitBounds(bounds, { padding: [60, 60] });
      }, 200);
    }
  }, [instalacionesFiltradas]);

  const limpiarFiltros = () => {
    setFiltroCuadrilla("");
    setFiltroEstado("");
    setFechaFiltro(dayjs().format("YYYY-MM-DD"));
  };

  const conteoPorEstado = instalacionesFiltradas.reduce((acc, curr) => {
    const estado = curr.estado || "Sin Estado";
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, {});
  

  return (
    <div className="p-4 h-full flex flex-col pb-4">
      <h1 className="text-2xl font-bold mb-4">Mapa de Instalaciones</h1>

      {/* Filtros */}
      <div className="flex flex-wrap gap-4 items-center mb-4">

      
        <input
          type="date"
          value={fechaFiltro}
          onChange={(e) => setFechaFiltro(e.target.value)}
          className="border px-3 py-2 rounded"
        />


      <input
  list="lista-cuadrillas"
  type="text"
  placeholder="Buscar cuadrilla..."
  value={filtroCuadrilla}
  onChange={(e) => setFiltroCuadrilla(e.target.value)}
  className="border px-3 py-2 rounded w-64"
/>

<datalist id="lista-cuadrillas">
  {[...new Set(instalaciones.map(i => i.cuadrillaNombre).filter(Boolean))].map((nombre, idx) => (
    <option key={idx} value={nombre} />
  ))}
</datalist>


        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="border px-3 py-2 rounded w-48"
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
          className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded"
        >
          Limpiar Filtros
        </button>
      </div>

      {/* Leyenda de colores */}
      <div className="flex gap-4 mb-2 text-sm">
      {Object.entries(colorByEstado).map(([estado, color]) =>
  estado !== "default" ? (
    <div key={estado} className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }}></div>
      <span>
        {estado} ({conteoPorEstado[estado] || 0})
      </span>
    </div>
  ) : null
)}

      </div>

      {/* Mapa */}
      <div className="flex-1 w-full min-h-0 rounded border overflow-hidden pb-4">
        {isClient && (
          <MapContainer
            center={[-12.05, -77.04]}
            zoom={11}
            scrollWheelZoom={true}
            className="w-full h-full"
            whenCreated={(mapInstance) => (mapRef.current = mapInstance)}
          >
            <TileLayer
              attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {instalacionesFiltradas.map((i) =>
              i.coordenadas?.lat && i.coordenadas?.lng ? (
                <Marker
                  key={i.id}
                  position={[i.coordenadas.lat, i.coordenadas.lng]}
                  icon={createCircleIcon(colorByEstado[i.estado] || colorByEstado["default"])}
                >
                  <Popup maxWidth={300}>
                  <div className="text-xs space-y-1">
  <p><strong>Cuadrilla:</strong> {i.cuadrillaNombre || i.cuadrilla || "No definido"}</p>
  <p><strong>Estado:</strong> {i.estado || "No definido"}</p>
  <p><strong>Tramo:</strong> {i.tramo || "No definido"}</p>
  <p><strong>Codigo:</strong> {i.codigoCliente || "No definido"}</p>
  <p><strong>Cliente:</strong> {i.cliente || "No definido"}</p>
  <p><strong>Plan:</strong> {i.plan || "No definido"}</p>
  <p><strong>Dirección:</strong> {i.direccion || "No definida"}</p>
                </div>

  <div className="w-full flex justify-center mt-2">
  <a
  href={`https://www.google.com/maps/search/?api=1&query=${i.coordenadas.lat},${i.coordenadas.lng}`}
  target="_blank"
  rel="noopener noreferrer"
  className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700 text-sm text-center"
  style={{ color: "white", fontWeight: "600", textDecoration: "none" }}
>
  Abrir en Google Maps
</a>

</div>

</Popup>



                </Marker>
              ) : null
            )}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
