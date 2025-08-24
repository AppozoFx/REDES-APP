// src/app/dashboard/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import dayjs from "dayjs";
import { useAuth } from "@/context/AuthContext";            // ✅ usa el estado de auth
import {
  PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, Legend
} from "recharts";

export default function Dashboard() {
  const { user, initializing } = useAuth();                 // ✅
  const [fecha, setFecha] = useState(dayjs().format("YYYY-MM-DD"));
  const [cuadrillas, setCuadrillas] = useState([]);
  const [instalaciones, setInstalaciones] = useState([]);
  const [cargando, setCargando] = useState(false);          // ✅ feedback de carga
  const montado = useRef(true);                             // ✅ evita setState tras unmount

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  useEffect(() => {
    // ⛔ No consultar hasta que Auth esté listo y haya user
    if (initializing || !user) return;

    const fetchData = async () => {
      try {
        setCargando(true);

        const snap1 = await getDocs(collection(db, "asistencia_cuadrillas"));
        const cuadrillasData = snap1.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(c => c.fecha === fecha);

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

        if (!montado.current) return;
        setCuadrillas(cuadrillasData);
        setInstalaciones(instalacionesData);
      } catch (err) {
        // 👇 muy importante: No tirar el error sin manejarlo
        console.warn("Error al leer Firestore en dashboard:", err?.code || err?.message);
        if (!montado.current) return;
        setCuadrillas([]);
        setInstalaciones([]);
      } finally {
        if (montado.current) setCargando(false);
      }
    };

    fetchData();
  }, [initializing, user, fecha]);

  // ---- DERIVADOS (useMemo para no recalcular en cada render) ----
  const cuadrillasAsistidas = useMemo(
    () => cuadrillas.filter(c => c.estado?.toLowerCase() === "asistencia"),
    [cuadrillas]
  );
  const totalAsistidas = cuadrillasAsistidas.length;

  const zonasConCantidad = useMemo(() => (
    cuadrillasAsistidas.reduce((acc, c) => {
      const zona = c.zona || "Sin Zona";
      acc[zona] = (acc[zona] || 0) + 1;
      return acc;
    }, {})
  ), [cuadrillasAsistidas]);

  const instalacionesFiltradas = useMemo(
    () => instalaciones.filter(i => i.tipoServicio?.toLowerCase() !== "garantia"),
    [instalaciones]
  );
  const totalInstalaciones = instalacionesFiltradas.length;
  const finalizadasValidas = instalacionesFiltradas.filter(i => i.estado?.toLowerCase() === "finalizada").length;
  const efectividad = totalInstalaciones > 0 ? (finalizadasValidas / totalInstalaciones) * 100 : 0;
  const ponderado = totalAsistidas > 0 ? (finalizadasValidas / totalAsistidas) : 0;

  const cuadrillasNoAsistidas = useMemo(
    () => cuadrillas.filter(c => c.estado?.toLowerCase() !== "asistencia"),
    [cuadrillas]
  );
  const resumenNoAsistidas = useMemo(() => (
    cuadrillasNoAsistidas.reduce((acc, c) => {
      const estado = c.estado?.toLowerCase() || "otro";
      acc[estado] = (acc[estado] || 0) + 1;
      return acc;
    }, {})
  ), [cuadrillasNoAsistidas]);

  const estadoInstalaciones = useMemo(() => (
    instalaciones.reduce((acc, i) => {
      const estado = i.estado?.toLowerCase() || "otro";
      acc[estado] = (acc[estado] || 0) + 1;
      return acc;
    }, {})
  ), [instalaciones]);

  const estadoInstalacionesValidas = useMemo(() => (
    instalacionesFiltradas.reduce((acc, i) => {
      const estado = i.estado?.toLowerCase() || "otro";
      acc[estado] = (acc[estado] || 0) + 1;
      return acc;
    }, {})
  ), [instalacionesFiltradas]);

  const distribucionTipos = useMemo(() => (
    cuadrillasAsistidas.reduce((acc, c) => {
      const tipo = c.tipo || "Otro";
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {})
  ), [cuadrillasAsistidas]);

  const cuadrillasResidenciales = useMemo(
    () => cuadrillasAsistidas.filter(c => c.nombre?.toLowerCase().includes("residencial")),
    [cuadrillasAsistidas]
  );
  const cuadrillasCondominio = useMemo(
    () => cuadrillasAsistidas.filter(c => c.nombre?.toLowerCase().includes("moto")),
    [cuadrillasAsistidas]
  );

  const cuadrillasInternas = useMemo(
    () => cuadrillasAsistidas.filter(c => c.coordinador?.toLowerCase().includes("redes")),
    [cuadrillasAsistidas]
  );
  const cuadrillasExternas = useMemo(
    () => cuadrillasAsistidas.filter(c => !c.coordinador?.toLowerCase().includes("redes")),
    [cuadrillasAsistidas]
  );

  return (
    <div className="min-h-screen space-y-12 p-6 dark:bg-slate-900 dark:text-slate-200">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Dashboard Visual - {fecha}
        </h1>

        {/* Estado de carga */}
        {cargando && (
          <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
            </svg>
            Cargando datos…
          </span>
        )}
      </div>

      <div>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded border p-2 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:[color-scheme:dark]"
        />
      </div>

      {/* Tarjetas superiores */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Cuadrillas en Campo (Asistieron)">
          <p className="text-center text-5xl font-extrabold text-blue-600 dark:text-blue-400">{totalAsistidas}</p>
        </Card>

        <Card title="Efectividad">
          <p className="text-center text-5xl font-extrabold text-green-500 dark:text-green-400">
            {efectividad.toFixed(1)}%
          </p>
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            {finalizadasValidas} finalizadas válidas de {totalInstalaciones}
          </p>
        </Card>

        <Card title="Índice de Productividad">
          <p className="text-center text-5xl font-extrabold text-purple-600 dark:text-purple-400">
            {ponderado.toFixed(2)}
          </p>
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Finalizadas válidas / Cuadrillas asistidas
          </p>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Cuadrillas No Asistidas">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(resumenNoAsistidas).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {Object.entries(resumenNoAsistidas).map((entry, index) => (
                  <Cell key={`cell-na-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(50, 50, 50, 0.8)', border: 'none', borderRadius: '4px' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} />
              <Legend wrapperStyle={{ color: '#cbd5e1' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Zonas cubiertas hoy">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={Object.entries(zonasConCantidad).map(([k, v]) => ({ name: k, value: v }))}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {Object.entries(zonasConCantidad).map((entry, index) => (
                  <Cell key={`cell-z-${index}`} fill={COLORS[(index + 1) % COLORS.length]} />
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
                  <Cell key={`cell-ei-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
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
                  <Cell key={`cell-t-${index}`} fill={COLORS[index % COLORS.length]} />
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

function Card({ title, children }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-slate-800">
      <h3 className="mb-2 text-lg font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      {children}
    </div>
  );
}

const COLORS = ["#6366f1", "#10b981", "#f43f5e", "#f59e0b", "#3b82f6", "#14b8a6", "#8b5cf6", "#ec4899"];
