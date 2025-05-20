"use client";
import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

export default function DashboardStock() {
  const [equipos, setEquipos] = useState([]);
  const [cuadrillaFiltro, setCuadrillaFiltro] = useState("");
  const [cuadrillas, setCuadrillas] = useState([]);

  useEffect(() => {
    const fetchEquipos = async () => {
      const snap = await getDocs(collection(db, "equipos"));
      setEquipos(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    const fetchCuadrillas = async () => {
      const snap = await getDocs(collection(db, "cuadrillas"));
      setCuadrillas(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchEquipos();
    fetchCuadrillas();
  }, []);

  const tipos = ["ONT", "MESH", "FONO", "BOX"];

  // Resumen del almacén
  const resumenAlmacen = tipos.map(tipo => ({
    tipo,
    cantidad: equipos.filter(eq => eq.estado === "almacen" && eq.equipo === tipo).length
  }));

  // Equipos filtrados por cuadrilla y estado "campo"
  const equiposCampo = equipos.filter(eq => 
    eq.estado === "campo" && eq.ubicacion === cuadrillaFiltro
  );

  const resumenCampo = tipos.map(tipo => ({
    tipo,
    cantidad: equiposCampo.filter(eq => eq.equipo === tipo).length
  }));

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
        📊 Dashboard de Stock
      </h1>

      {/* === RESUMEN ALMACÉN === */}
      <div className="bg-gray-100 p-4 rounded-lg mb-8 flex justify-around text-center">
        {resumenAlmacen.map(r => (
          <div key={r.tipo}>
            <p className="font-bold">{r.tipo}</p>
            <p className="text-2xl">{r.cantidad}</p>
          </div>
        ))}
      </div>

      {/* === FILTRO DE CUADRILLA === */}
      <div className="mb-6">
        <label className="mr-2 font-semibold">Cuadrilla (Campo):</label>
        <select
          value={cuadrillaFiltro}
          onChange={(e) => setCuadrillaFiltro(e.target.value)}
          className="border p-2"
        >
          <option value="">Selecciona una cuadrilla</option>
          {cuadrillas.map(c => (
            <option key={c.id} value={c.nombre}>{c.nombre}</option>
          ))}
        </select>
      </div>

      {/* === GRÁFICOS DE COLUMNAS EN UNA FILA === */}
      {cuadrillaFiltro && (
        <div className="grid grid-cols-4 gap-4 mb-10">
          {resumenCampo.map(data => (
            <BarChart key={data.tipo} width={150} height={200} data={[data]}>
              <XAxis dataKey="tipo" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="cantidad" fill="#3182CE" />
            </BarChart>
          ))}
        </div>
      )}

      {/* === TABLAS DETALLADAS === */}
      {cuadrillaFiltro && tipos.map(tipo => (
        <div key={tipo} className="mb-10">
          <h2 className="text-xl font-bold mb-2">{tipo}</h2>
          <table className="w-full border mb-4">
            <thead>
              <tr className="bg-gray-200">
                <th className="p-2">Equipo</th>
                <th className="p-2">Cuadrilla</th>
                <th className="p-2">SN</th>
                <th className="p-2">F. Entrega</th>
              </tr>
            </thead>
            <tbody>
              {equiposCampo.filter(eq => eq.equipo === tipo).map(eq => (
                <tr key={eq.id} className="text-center">
                  <td className="p-2">{eq.equipo}</td>
                  <td className="p-2">{eq.ubicacion}</td>
                  <td className="p-2">{eq.SN}</td>
                  <td className="p-2">
                    {eq.f_despacho
                      ? new Date(eq.f_despacho.seconds * 1000).toLocaleDateString()
                      : "Sin fecha"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
