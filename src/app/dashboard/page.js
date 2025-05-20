// Este archivo contiene el dashboard visual con métricas + gráficos
// Librería: Recharts (debes instalar con: npm install recharts)

"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import dayjs from "dayjs";
import {
  PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, Legend
} from "recharts";

export default function Dashboard() {
  const [fecha, setFecha] = useState(dayjs().format("YYYY-MM-DD"));
  const [cuadrillas, setCuadrillas] = useState([]);
  const [instalaciones, setInstalaciones] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const snap1 = await getDocs(collection(db, "asistencia_cuadrillas"));
      const cuadrillasData = snap1.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(c => c.fecha === fecha);
      setCuadrillas(cuadrillasData);

      const snap2 = await getDocs(collection(db, "instalaciones"));
      const instalacionesData = snap2.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(i => {
          const fechaInstalacion = (() => {
            if (typeof i.fechaInstalacion === "string") {
              return dayjs(i.fechaInstalacion).format("YYYY-MM-DD");
            } else if (i.fechaInstalacion?.toDate) {
              return dayjs(i.fechaInstalacion.toDate()).format("YYYY-MM-DD");
            }
            return "";
          })();
          return fechaInstalacion === fecha;
        });
      setInstalaciones(instalacionesData);
    };

    fetchData();
  }, [fecha]);

  const cuadrillasAsistidas = cuadrillas.filter(c => c.estado?.toLowerCase() === "asistencia");
  const totalAsistidas = cuadrillasAsistidas.length;

  const zonasConCantidad = cuadrillasAsistidas.reduce((acc, c) => {
    const zona = c.zona || "Sin Zona";
    acc[zona] = (acc[zona] || 0) + 1;
    return acc;
  }, {});

  const instalacionesFiltradas = instalaciones.filter(i => i.tipoServicio?.toLowerCase() !== "garantia");
  const totalInstalaciones = instalacionesFiltradas.length;
  const finalizadasValidas = instalacionesFiltradas.filter(i => i.estado?.toLowerCase() === "finalizada").length;
  const efectividad = totalInstalaciones > 0 ? (finalizadasValidas / totalInstalaciones) * 100 : 0;

  const ponderado = totalAsistidas > 0 ? (finalizadasValidas / totalAsistidas) : 0;

  const cuadrillasNoAsistidas = cuadrillas.filter(c => c.estado?.toLowerCase() !== "asistencia");
  const resumenNoAsistidas = cuadrillasNoAsistidas.reduce((acc, c) => {
    const estado = c.estado?.toLowerCase() || "otro";
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, {});

  const estadoInstalaciones = instalaciones.reduce((acc, i) => {
    const estado = i.estado?.toLowerCase() || "otro";
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, {});

  const estadoInstalacionesValidas = instalacionesFiltradas.reduce((acc, i) => {
    const estado = i.estado?.toLowerCase() || "otro";
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, {});
  

  const distribucionTipos = cuadrillasAsistidas.reduce((acc, c) => {
    const tipo = c.tipo || "Otro";
    acc[tipo] = (acc[tipo] || 0) + 1;
    return acc;
  }, {});

  const cuadrillasResidenciales = cuadrillasAsistidas.filter(c =>
    c.nombre?.toLowerCase().includes("residencial")
  );
  const cuadrillasCondominio = cuadrillasAsistidas.filter(c =>
    c.nombre?.toLowerCase().includes("moto")
  );

  const cuadrillasInternas = cuadrillasAsistidas.filter(c =>
    c.coordinador?.toLowerCase().includes("redes")
  );
  const cuadrillasExternas = cuadrillasAsistidas.filter(c =>
    !c.coordinador?.toLowerCase().includes("redes")
  );

  return (
    <div className="p-6 space-y-12 dark:bg-slate-900 dark:text-slate-200 min-h-screen"> {/* MODIFICACIÓN: Fondo y texto base para dark mode */}
      <div>
        <h1 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">Dashboard Visual - {fecha}</h1> {/* MODIFICACIÓN: Color de título */}
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="border p-2 rounded dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:[color-scheme:dark]" // MODIFICACIONES CLAVE AQUÍ
        />
      </div>

      {/* Tarjetas superiores */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <Card title="Cuadrillas en Campo (Asistieron)">
          <p className="text-5xl font-extrabold text-center text-blue-600 dark:text-blue-400">{totalAsistidas}</p> {/* MODIFICACIÓN */}
        </Card>

        <Card title="Efectividad">
          <p className="text-5xl font-extrabold text-center text-green-500 dark:text-green-400">{efectividad.toFixed(1)}%</p> {/* MODIFICACIÓN */}
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center"> {/* MODIFICACIÓN */}
            {finalizadasValidas} finalizadas válidas de {totalInstalaciones}
          </p>
        </Card>

        <Card title="Índice de Productividad">
          <p className="text-5xl font-extrabold text-center text-purple-600 dark:text-purple-400">{ponderado.toFixed(2)}</p> {/* MODIFICACIÓN */}
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">Finalizadas válidas / Cuadrillas asistidas</p> {/* MODIFICACIÓN */}
        </Card>
      </div>

      {/* Sección de gráficos inferiores */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Ejemplo de un Card de gráfico */}
        <Card title="Cuadrillas No Asistidas">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(resumenNoAsistidas).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
                // Para el texto del label dentro del Pie, Recharts puede no respetar el color del tema directamente
                // A veces necesitas pasar props como `labelLine={false}` y un `label` personalizado con estilos.
              >
                {Object.entries(resumenNoAsistidas).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(50, 50, 50, 0.8)', border: 'none', borderRadius: '4px' }} // Estilo dark para Tooltip
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend wrapperStyle={{ color: '#cbd5e1' }} /> {/* Ajustar color del texto de la leyenda */}
            </PieChart>
          </ResponsiveContainer>
        </Card>
        {/* ... Repetir patrón similar para otros gráficos, ajustando Tooltip y Legend ... */}
        <Card title="Zonas cubiertas hoy">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(zonasConCantidad).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {Object.entries(zonasConCantidad).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index + 1) % COLORS.length]} /> // Offset de color
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(50, 50, 50, 0.8)', border: 'none', borderRadius: '4px' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} />
              <Legend wrapperStyle={{ color: '#cbd5e1' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Estado de Instalaciones (sin Garantía)">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(estadoInstalacionesValidas).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {Object.entries(estadoInstalacionesValidas).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} /> // Offset de color
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(50, 50, 50, 0.8)', border: 'none', borderRadius: '4px' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} />
              <Legend wrapperStyle={{ color: '#cbd5e1' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>


        <Card title="Distribución de Tipos de Cuadrillas Asistidas">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(distribucionTipos).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {Object.entries(distribucionTipos).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Residenciales vs Condominio">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={[
                  { name: "Residenciales", value: cuadrillasResidenciales.length },
                  { name: "Condominio", value: cuadrillasCondominio.length }
                ]}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                <Cell fill="#60a5fa" />
                <Cell fill="#f43f5e" />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Internas vs Externas">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={[
                  { name: "Internas", value: cuadrillasInternas.length },
                  { name: "Externas", value: cuadrillasExternas.length }
                ]}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                <Cell fill="#10b981" />
                <Cell fill="#f59e0b" />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// Componente Card (Asegúrate que este componente también sea compatible con dark mode)
function Card({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow"> {/* MODIFICACIÓN: Fondo para dark mode */}
      <h3 className="text-lg font-semibold mb-2 text-slate-700 dark:text-slate-200">{title}</h3> {/* MODIFICACIÓN: Color de título */}
      {children}
    </div>
  );
}

const COLORS = ["#6366f1", "#10b981", "#f43f5e", "#f59e0b", "#3b82f6", "#14b8a6", "#8b5cf6", "#ec4899"];