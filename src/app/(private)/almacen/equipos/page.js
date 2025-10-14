// src/app/almacen/equipos/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/context/AuthContext";
import {
  addDoc,
  collection,
  getDocs,
  updateDoc,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
  deleteDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { format } from "date-fns";
import toast, { Toaster } from "react-hot-toast";
import { differenceInDays, startOfDay } from "date-fns";
import * as XLSX from "xlsx";

/* --- UI Loading Overlay simple --- */
function LoadingOverlay({ text = "Cargando equipos…" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-3 shadow-lg ring-1 ring-black/5">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
        <span className="text-gray-700">{text}</span>
      </div>
    </div>
  );
}

export default function EquiposEditable() {
  const [equipos, setEquipos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [editing, setEditing] = useState({});
  const [editandoId, setEditandoId] = useState(null);

  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroPriTec, setFiltroPriTec] = useState("");
  const [filtroTecLiq, setFiltroTecLiq] = useState("");
  const [filtroInv, setFiltroInv] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState(false);

  const [cargando, setCargando] = useState(false);

  const { userData } = useAuth();

  const opcionesExtra = ["garantía", "avería", "robo", "pérdida"];

  // Debounce de búsqueda para no filtrar en cada tecla
  useEffect(() => {
    const id = setTimeout(() => setFiltro(busqueda), 250);
    return () => clearTimeout(id);
  }, [busqueda]);

  // Estados de paginación
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Resetear página al cambiar filtros
  useEffect(() => {
    setPage(1);
  }, [
    filtro,
    filtroEstado,
    filtroUbicacion,
    filtroPriTec,
    filtroTecLiq,
    filtroInv,
    filtroAlerta,
  ]);

  // Mapas memoizados para accesos O(1)
  const mapCuadrillasPorNombre = useMemo(() => {
    const m = new Map();
    (cuadrillas || []).forEach((c) => {
      if (c?.nombre) m.set(c.nombre, c);
    });
    return m;
  }, [cuadrillas]);

  const mapUsuarioPorUid = useMemo(() => {
    const m = new Map();
    (usuarios || []).forEach((u) => {
      if (u?.uid) m.set(u.uid, u);
    });
    return m;
  }, [usuarios]);

  // Valores únicos precalculados
  const estadosDisponibles = useMemo(() => {
    return [...new Set((equipos || []).map((e) => e.estado).filter(Boolean))];
  }, [equipos]);

  const opcionesUbicacionBase = useMemo(() => {
    const nombresCuadrillas = (cuadrillas || [])
      .map((c) => c.nombre)
      .filter(Boolean);
    const base = [...nombresCuadrillas, ...opcionesExtra];
    return [...new Set(base)].sort((a, b) => a.localeCompare(b));
  }, [cuadrillas]);

  // 🚀 Cargar equipos (todo, igual que tu versión)
  const cargarEquipos = async () => {
    setCargando(true);
    try {
      const snap = await getDocs(collection(db, "equipos"));
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEquipos(todos);
    } catch (error) {
      console.error("Error cargando equipos:", error);
      toast.error("Error al cargar equipos");
    } finally {
      setCargando(false);
    }
  };

  const esEquipoEnAlerta = (equipo) => {
    if (!equipo.f_ingreso) return false;
    const hoy = startOfDay(new Date());
    const fechaIngreso = startOfDay(
      equipo.f_ingreso?.toDate?.() || new Date(equipo.f_ingreso)
    );
    const diasEnSistema = differenceInDays(hoy, fechaIngreso);
    return equipo.estado === "campo" && diasEnSistema > 15;
  };

  // 📊 Filtro simple por SN o tipo de equipo
  const filtrarEquipos = useMemo(() => {
    const q = (filtro || "").toLowerCase();
    return equipos.filter(
      (e) =>
        (e.SN?.toLowerCase().includes(q) ||
          e.equipo?.toLowerCase().includes(q)) &&
        (filtroEstado ? e.estado === filtroEstado : true) &&
        (filtroUbicacion ? e.ubicacion === filtroUbicacion : true) &&
        (filtroPriTec ? e["pri-tec"] === filtroPriTec : true) &&
        (filtroTecLiq ? e["tec-liq"] === filtroTecLiq : true) &&
        (filtroInv ? e["inv"] === filtroInv : true) &&
        (filtroAlerta ? esEquipoEnAlerta(e) : true)
    );
  }, [
    equipos,
    filtro,
    filtroEstado,
    filtroUbicacion,
    filtroPriTec,
    filtroTecLiq,
    filtroInv,
    filtroAlerta,
  ]);

  // 1️⃣ Únicos (por id) con regla para ubicaciones excluidas cuando solo filtras Estado
  const filtrarEquiposUnicos = useMemo(() => {
    const ubicacionesExcluidas = ["avería", "pérdida", "garantía", "robo"];
    const lista = filtrarEquipos.filter((e) => {
      if (
        filtroEstado &&
        !filtroUbicacion &&
        ubicacionesExcluidas.includes((e.ubicacion || "").toLowerCase())
      ) {
        return false;
      }
      return true;
    });
    return Array.from(new Map(lista.map((e) => [e.id, e])).values());
  }, [filtrarEquipos, filtroEstado, filtroUbicacion]);

  // 2️⃣ Lo que se muestra por defecto (oculta instalados/avería/pérdida/garantía/robo si no hay filtros)
  const equiposParaTabla = useMemo(() => {
    if (!filtro && !filtroEstado && !filtroUbicacion) {
      return filtrarEquiposUnicos.filter(
        (e) =>
          e.estado !== "instalado" &&
          !["instalado", "avería", "pérdida", "garantía", "robo"].includes(
            e.ubicacion?.toLowerCase()
          )
      );
    }
    return filtrarEquiposUnicos;
  }, [filtrarEquiposUnicos, filtro, filtroEstado, filtroUbicacion]);

  // Paginación derivada
  const totalFiltrados = equiposParaTabla.length;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrados / pageSize));
  const equiposPaginados = useMemo(() => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return equiposParaTabla.slice(start, end);
  }, [equiposParaTabla, page, pageSize]);

  // 🧮 Stock por cuadrilla (agregado). Usa increment y marca kind:"counter"
  const actualizarStockCuadrilla = async (nombreCuadrilla, cantidad, tipoEquipo) => {
    const cuadrillaDoc = cuadrillas.find((c) => c.nombre === nombreCuadrilla);
    if (!cuadrillaDoc) {
      console.warn(`⚠️ No se encontró la cuadrilla: ${nombreCuadrilla}`);
      return;
    }
    const stockRef = doc(
      db,
      `cuadrillas/${cuadrillaDoc.id}/stock_equipos/${tipoEquipo}`
    );
    await setDoc(
      stockRef,
      {
        cantidad: increment(cantidad),
        tipo: tipoEquipo,
        kind: "counter",
        actualizadoEn: serverTimestamp(),
      },
      { merge: true }
    );
  };

  useEffect(() => {
    const fetchData = async () => {
      const cuadrillaSnap = await getDocs(
        query(collection(db, "cuadrillas"), where("estado", "==", "activo"))
      );
      setCuadrillas(
        cuadrillaSnap.docs.map((d) => ({
          id: d.id,
          nombre: d.data().nombre?.trim(),
          tecnicos: d.data().tecnicos,
        }))
      );

      const usuariosSnap = await getDocs(collection(db, "usuarios"));
      setUsuarios(
        usuariosSnap.docs.map((d) => ({
          uid: d.id,
          ...d.data(),
        }))
      );
    };

    fetchData();
    cargarEquipos();
  }, []);

  // 🗓️ Formatear fechas
  const parseFecha = (val) => {
    if (!val) return "";
    if (val.toDate) return format(val.toDate(), "d/M/yyyy");
    const fecha = new Date(val);
    return isNaN(fecha.getTime()) ? "" : format(fecha, "d/M/yyyy");
  };

  // 👥 Técnicos
  const mostrarTecnicos = (equipo) => {
    if (equipo.tecnicos && equipo.tecnicos.length > 0) {
      return Array.isArray(equipo.tecnicos)
        ? equipo.tecnicos.join(", ")
        : equipo.tecnicos;
    }

    const cuadrilla = mapCuadrillasPorNombre.get(equipo.ubicacion);
    if (!cuadrilla || !cuadrilla.tecnicos) return "-";

    const nombres = cuadrilla.tecnicos
      .map((uid) => {
        const usuario = mapUsuarioPorUid.get(uid);
        return usuario ? `${usuario.nombres} ${usuario.apellidos}` : null;
      })
      .filter(Boolean);

    return nombres.length ? nombres.join(", ") : "-";
  };

  // 📍 Opciones de ubicación
  const generarOpcionesUbicacion = (ubicacionActual) => {
    if (ubicacionActual === "almacen") {
      return opcionesUbicacionBase.includes("almacen")
        ? opcionesUbicacionBase
        : [...opcionesUbicacionBase, "almacen"];
    }
    return opcionesUbicacionBase;
  };

  // 📝 Edición
  const handleChange = (id, field, value) => {
    setEditing((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
        ...(field === "ubicacion"
          ? {
              estado: cuadrillas.map((c) => c.nombre).includes(value)
                ? "campo"
                : "almacen",
            }
          : {}),
      },
    }));
  };

  // ✅ Confirmar y guardar
  const confirmarGuardado = (id) => {
    toast(
      (t) => (
        <div>
          <p>
            💾 ¿Estás seguro de <strong>guardar</strong> los cambios?
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                guardarCambios(id);
                setEditandoId(null);
                toast.dismiss(t.id);
              }}
              className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
            >
              Sí, guardar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="rounded bg-gray-300 px-3 py-1 hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };

  // 🔹 Guardar (incluye movimiento entre cuadrillas)
  const guardarCambios = async (id) => {
    if (!editing[id]) return;
    const equipoOriginal = equipos.find((e) => e.id === id);
    const cambios = editing[id];

    try {
      await updateDoc(doc(db, "equipos", id), cambios);

      // ⚡️ Detectar cambio de ubicación
      if (cambios.ubicacion && cambios.ubicacion !== equipoOriginal.ubicacion) {
        const nombresCuadrillas = cuadrillas.map((c) => c.nombre);

        const origenEsCuadrilla = nombresCuadrillas.includes(
          equipoOriginal.ubicacion
        );
        const destinoEsCuadrilla = nombresCuadrillas.includes(
          cambios.ubicacion
        );

        // ➖ Restar stock si sale de una cuadrilla válida
        if (origenEsCuadrilla) {
          await actualizarStockCuadrilla(
            equipoOriginal.ubicacion,
            -1,
            equipoOriginal.equipo
          );
        }

        // ➕ Sumar stock si llega a una cuadrilla válida
        if (destinoEsCuadrilla) {
          await actualizarStockCuadrilla(
            cambios.ubicacion,
            1,
            equipoOriginal.equipo
          );
        }

        // 🚚 Mover documento SN entre cuadrillas en stock_equipos (sin dejarlo "pegado")
        if (origenEsCuadrilla || destinoEsCuadrilla) {
          await moverEquipoEntreCuadrillas(
            equipoOriginal.SN,
            equipoOriginal,
            equipoOriginal.ubicacion,
            cambios.ubicacion
          );
        }

        // 🔔 Notificación
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Movimiento de Equipo",
          mensaje: `🚚 ${userData?.nombres ?? ""} ${userData?.apellidos ?? ""} movió ${equipoOriginal.equipo} (SN: ${equipoOriginal.SN}) de "${equipoOriginal.ubicacion}" a "${cambios.ubicacion}"`,
          usuario: `${userData?.nombres ?? ""} ${userData?.apellidos ?? ""}`.trim(),
          fecha: serverTimestamp(),
          detalles: {
            sn: equipoOriginal.SN,
            equipo: equipoOriginal.equipo,
            de: equipoOriginal.ubicacion,
            a: cambios.ubicacion,
          },
          visto: false,
        });
      }

      toast.success("✅ Cambios guardados y stock actualizado");
      setEquipos((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...cambios } : e))
      );
      setEditing((prev) => {
        const nuevo = { ...prev };
        delete nuevo[id];
        return nuevo;
      });
    } catch (error) {
      toast.error("Error al guardar");
      console.error(error);
    }
  };

  // 📤 Export general (como antes: usa base filtrada/única)
  const exportarEquipos = () => {
    const fecha = new Date();
    const fechaTexto = `${fecha.getDate()}-${fecha.getMonth() + 1}-${fecha.getFullYear()}`;
    const nombreArchivo = `EQUIPOS-REDES-${fechaTexto}.xlsx`;

    if (filtrarEquiposUnicos.length === 0) {
      toast.error("No hay equipos para exportar.");
      return;
    }

    const dataExcel = filtrarEquiposUnicos.map((e) => ({
      SN: e.SN,
      Estado: e.estado,
      Tecnicos: mostrarTecnicos(e),
      Ubicación: e.ubicacion,
      Equipo: e.equipo,
      "F. Ingreso": parseFecha(e.f_ingreso),
      "F. Despacho": parseFecha(e.f_despacho),
      Cliente: e.cliente,
      "Pri-Tec": e["pri-tec"],
      "Tec-Liq": e["tec-liq"],
      Inv: e["inv"],
      ProID: e.proid,
    }));

    const ws = XLSX.utils.json_to_sheet(dataExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipos");
    XLSX.writeFile(wb, nombreArchivo);
    toast.success("📤 Equipos exportados correctamente");
  };

  // ⚡ Exportar PRI-TEC → aplica SOLO a lo visible (equiposParaTabla)
  const exportarPriTec = async () => {
    if (equiposParaTabla.length === 0) {
      toast.error("No hay equipos visibles para exportar.");
      return;
    }

    toast(
      (t) => (
        <div>
          <p>
            ⚠️ Vas a exportar y actualizar <strong>PRI-TEC</strong> a{" "}
            <strong>si</strong> para <strong>{equiposParaTabla.length}</strong>{" "}
            equipos visibles.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                segundaConfirmacionPriTec();
              }}
              className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
            >
              Confirmar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="rounded bg-gray-300 px-3 py-1 hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };

  const segundaConfirmacionPriTec = async () => {
    const fechaTexto = new Date().toLocaleDateString("es-PE").replaceAll("/", "-");
    const nombreArchivo = `PRI-TEC-${filtroPriTec || "Vista"}-${fechaTexto}.xlsx`;

    const dataExcel = equiposParaTabla.map((e) => ({
      SN: e.SN,
      "F. Despacho": parseFecha(e.f_despacho),
      Técnicos: mostrarTecnicos(e),
      Ubicación: e.ubicacion,
    }));

    const ws = XLSX.utils.json_to_sheet(dataExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PRI-TEC");
    XLSX.writeFile(wb, nombreArchivo);

    await Promise.all(
      equiposParaTabla.map((e) =>
        updateDoc(doc(db, "equipos", e.id), { "pri-tec": "si" })
      )
    );

    // reflejar en estado
    const ids = new Set(equiposParaTabla.map((e) => e.id));
    setEquipos((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, ["pri-tec"]: "si" } : e)));

    toast.success("⚡ PRI-TEC exportado y actualizado");
  };

  // 📦 Exportar TEC-LIQ → SOLO visibles
  const exportarTecLiq = async () => {
    if (equiposParaTabla.length === 0) {
      toast.error("No hay equipos visibles para exportar.");
      return;
    }

    toast(
      (t) => (
        <div>
          <p>
            ⚠️ Vas a exportar y actualizar <strong>TEC-LIQ</strong> a{" "}
            <strong>si</strong> para{" "}
            <strong>{equiposParaTabla.length}</strong> equipos visibles.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                segundaConfirmacionTecLiq();
              }}
              className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
            >
              Confirmar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="rounded bg-gray-300 px-3 py-1 hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };

  const segundaConfirmacionTecLiq = async () => {
    const fechaTexto = new Date().toLocaleDateString("es-PE").replaceAll("/", "-");
    const nombreArchivo = `TEC-LIQ-${filtroTecLiq || "Vista"}-${fechaTexto}.xlsx`;

    const dataExcel = equiposParaTabla.map((e) => ({
      SN: e.SN,
      "F. Despacho": parseFecha(e.f_despacho),
      Técnicos: mostrarTecnicos(e),
      Ubicación: e.ubicacion,
      "F. Instalación": parseFecha(e.f_instalado),
      Cliente: e.cliente,
    }));

    const ws = XLSX.utils.json_to_sheet(dataExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TEC-LIQ");
    XLSX.writeFile(wb, nombreArchivo);

    await Promise.all(
      equiposParaTabla.map((e) =>
        updateDoc(doc(db, "equipos", e.id), { "tec-liq": "si" })
      )
    );

    const ids = new Set(equiposParaTabla.map((e) => e.id));
    setEquipos((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, ["tec-liq"]: "si" } : e)));

    toast.success("📦 TEC-LIQ exportado y actualizado");
  };

  // 🔹 Mover equipo entre cuadrillas en stock_equipos (borra en origen, crea en destino)
  const moverEquipoEntreCuadrillas = async (sn, equipoData, origen, destino) => {
    const origenDoc = cuadrillas.find((c) => c.nombre === origen);
    const destinoDoc = cuadrillas.find((c) => c.nombre === destino);

    if (origenDoc) {
      // ❌ eliminar el doc del SN en la cuadrilla origen (para que no quede "pegado")
      await deleteDoc(doc(db, `cuadrillas/${origenDoc.id}/stock_equipos/${sn}`)).catch(
        () => {}
      );
    }

    if (destinoDoc) {
      // ✅ crear el doc del SN en la cuadrilla destino
      await setDoc(
        doc(db, `cuadrillas/${destinoDoc.id}/stock_equipos/${sn}`),
        {
          SN: equipoData.SN,
          descripcion: equipoData.descripcion || "",
          equipo: equipoData.equipo,
          estado: "campo",
          f_ingreso: equipoData.f_ingreso || serverTimestamp(),
          kind: "sn",
        },
        { merge: false }
      );
    }
  };

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      {cargando && <LoadingOverlay />}

      <h2 className="mb-4 text-2xl font-semibold">📋 Equipos (Optimizado)</h2>

      <div className="mb-4 flex flex-wrap gap-4">
        {/* Buscar por SN o Tipo */}
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar SN o tipo de equipo"
          className="w-full max-w-xs"
        />

        {/* Estado */}
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Estado</option>
          {estadosDisponibles.map((estado, idx) => (
            <option key={idx} value={estado}>
              {estado}
            </option>
          ))}
        </select>

        {/* Ubicación */}
        <select
          value={filtroUbicacion}
          onChange={(e) => setFiltroUbicacion(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Ubicación</option>
          {generarOpcionesUbicacion().map((ubic, idx) => (
            <option key={idx} value={ubic}>
              {ubic}
            </option>
          ))}
        </select>

        {/* Pri-Tec */}
        <select
          value={filtroPriTec}
          onChange={(e) => setFiltroPriTec(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Pri-Tec</option>
          <option value="si">si</option>
          <option value="no">no</option>
        </select>

        {/* Tec-Liq */}
        <select
          value={filtroTecLiq}
          onChange={(e) => setFiltroTecLiq(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Tec-Liq</option>
          <option value="si">si</option>
          <option value="no">no</option>
        </select>

        {/* Inv */}
        <select
          value={filtroInv}
          onChange={(e) => setFiltroInv(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Inv</option>
          <option value="si">si</option>
          <option value="no">no</option>
        </select>

        {/* ✅ Filtro de Alerta */}
        <div className="flex items-center gap-2 rounded bg-yellow-100 px-3 py-1">
          <input
            type="checkbox"
            checked={filtroAlerta}
            onChange={(e) => setFiltroAlerta(e.target.checked)}
            className="accent-yellow-500"
          />
          <label className="text-sm font-medium text-yellow-700">
            Equipos con Antigüedad ⚠️
          </label>
        </div>

        <Button
          size="sm"
          className="flex items-center gap-2 rounded-full bg-[#30518c] px-4 py-2 font-semibold text-white shadow transition hover:bg-[#27406f]"
          onClick={() => {
            setFiltro("");
            setBusqueda("");
            setFiltroEstado("");
            setFiltroUbicacion("");
            setFiltroPriTec("");
            setFiltroTecLiq("");
            setFiltroInv("");
            setFiltroAlerta(false);
            setPage(1);
          }}
        >
          🧹 Limpiar filtros
        </Button>

        <div className="mb-6 flex flex-wrap gap-4">
          <Button
            onClick={exportarEquipos}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 px-5 py-2 font-semibold text-white shadow-md transition hover:from-blue-600 hover:to-blue-800"
          >
            📁 Exportar Equipos
          </Button>

          <Button
            onClick={exportarPriTec}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 px-5 py-2 font-semibold text-white shadow-md transition hover:from-purple-600 hover:to-purple-800"
          >
            ⚡ Exportar PRI-TEC
          </Button>

          <Button
            onClick={exportarTecLiq}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-green-700 px-5 py-2 font-semibold text-white shadow-md transition hover:from-green-600 hover:to-green-800"
          >
            📦 Exportar TEC-LIQ
          </Button>
        </div>
      </div>

      {(filtro ||
        filtroEstado ||
        filtroUbicacion ||
        filtroPriTec ||
        filtroTecLiq ||
        filtroInv) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm text-gray-600">
          <span>
            🔎 <strong>Filtros aplicados:</strong>
          </span>
          {filtro && (
            <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
              Buscar: {filtro}
            </span>
          )}
          {filtroEstado && (
            <span className="rounded bg-green-100 px-2 py-1 text-green-800">
              Estado: {filtroEstado}
            </span>
          )}
          {filtroUbicacion && (
            <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
              Ubicación: {filtroUbicacion}
            </span>
          )}
          {filtroPriTec && (
            <span className="rounded bg-purple-100 px-2 py-1 text-purple-800">
              Pri-Tec: {filtroPriTec}
            </span>
          )}
          {filtroTecLiq && (
            <span className="rounded bg-pink-100 px-2 py-1 text-pink-800">
              Tec-Liq: {filtroTecLiq}
            </span>
          )}
          {filtroInv && (
            <span className="rounded bg-red-100 px-2 py-1 text-red-800">
              Inv: {filtroInv}
            </span>
          )}
        </div>
      )}

      {/* Paginación y tamaño de página */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
        <div>
          Mostrando {Math.min(totalFiltrados, (page - 1) * pageSize + 1)}-
          {Math.min(totalFiltrados, page * pageSize)} de {totalFiltrados}
        </div>
        <div className="flex items-center gap-2">
          <label>Tamaño página</label>
          <select
            className="rounded border px-2 py-1"
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value) || 50)}
          >
            {[25, 50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            className="rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ‹ Anterior
          </button>
          <span>
            Página {page} / {totalPaginas}
          </span>
          <button
            className="rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
            disabled={page >= totalPaginas}
          >
            Siguiente ›
          </button>
        </div>
      </div>

      <div className="max-h-[80vh] overflow-auto rounded border">
        <table className="min-w-[1500px] text-sm">
          <thead className="sticky top-0 bg-gray-100">
            <tr>
              <th className="p-2">SN</th>
              <th className="p-2">F. Despacho</th>
              <th className="p-2">Técnicos</th>
              <th className="p-2">F. Instalación</th>
              <th className="p-2">Cliente</th>
              <th className="p-2">F. Ingreso</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Ubicación</th>
              <th className="p-2">Equipo</th>
              <th className="p-2">Caso</th>
              <th className="p-2">Observación</th>
              <th className="p-2">Pri-Tec</th>
              <th className="p-2">Tec-Liq</th>
              <th className="p-2">Inv</th>
              <th className="p-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {equiposPaginados.map((e) => (
              <tr key={`row-${e.id}-${e.SN || ""}`} className="border-t">
                <td className="p-2 font-mono">{e.SN}</td>
                <td className="p-2">{parseFecha(e.f_despacho)}</td>
                <td className="p-2">{mostrarTecnicos(e)}</td>
                <td className="p-2">{parseFecha(e.f_instalado)}</td>
                <td className="p-2">{e.cliente}</td>

                <td
                  className={`p-2 font-semibold ${
                    esEquipoEnAlerta(e) ? "rounded bg-red-100 text-red-700" : ""
                  }`}
                >
                  {parseFecha(e.f_ingreso)}
                  {esEquipoEnAlerta(e) && <span className="ml-2">⚠️</span>}
                </td>

                <td
                  className={`p-2 font-semibold ${
                    esEquipoEnAlerta(e) ? "rounded bg-red-100 text-red-700" : ""
                  }`}
                >
                  {e.estado}
                </td>

                <td
                  className={`p-2 font-semibold ${
                    ["avería", "pérdida", "garantía", "robo"].includes(
                      (e.ubicacion ?? "").toLowerCase()
                    )
                      ? "bg-red-100 text-red-700"
                      : ""
                  }`}
                >
                  <select
                    value={editing[e.id]?.ubicacion ?? e.ubicacion ?? ""}
                    onChange={(ev) => handleChange(e.id, "ubicacion", ev.target.value)}
                    disabled={editandoId !== e.id}
                    className="rounded border px-2 py-1"
                  >
                    <option value="">Selecciona ubicación</option>
                    {generarOpcionesUbicacion(
                      editing[e.id]?.ubicacion ?? e.ubicacion
                    ).map((op, idx) => (
                      <option key={`${op}-${idx}`} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>

                  {["avería", "pérdida", "garantía", "robo"].includes(
                    (e.ubicacion ?? "").toLowerCase()
                  ) && <span className="ml-1">⚠️</span>}
                </td>

                <td className="p-2">{e.equipo}</td>

                <td className="p-2">
                  <Input
                    value={editing[e.id]?.caso ?? e.caso ?? ""}
                    onChange={(ev) => handleChange(e.id, "caso", ev.target.value)}
                    disabled={editandoId !== e.id}
                  />
                </td>

                <td className="p-2">
                  <Input
                    value={editing[e.id]?.observacion ?? e.observacion ?? ""}
                    onChange={(ev) => handleChange(e.id, "observacion", ev.target.value)}
                    disabled={editandoId !== e.id}
                  />
                </td>

                {["pri-tec", "tec-liq", "inv"].map((key) => (
                  <td className="p-2" key={key}>
                    <select
                      value={
                        (editing[e.id]?.[key] ?? e[key] ?? "no") === "si"
                          ? "si"
                          : "no"
                      }
                      onChange={(ev) => handleChange(e.id, key, ev.target.value)}
                      disabled={editandoId !== e.id}
                      className="rounded border px-2 py-1"
                    >
                      <option value="no">no</option>
                      <option value="si">si</option>
                    </select>
                  </td>
                ))}

                <td className="p-2">
                  {editandoId === e.id ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-white transition hover:bg-emerald-600"
                        onClick={() => confirmarGuardado(e.id)}
                      >
                        <span>💾</span> Guardar
                      </Button>
                      <Button
                        size="sm"
                        className="flex items-center gap-2 rounded-lg bg-gray-300 px-4 py-2 text-gray-800 transition hover:bg-gray-400"
                        onClick={() => setEditandoId(null)}
                      >
                        <span>✖</span> Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white transition hover:bg-blue-600"
                      onClick={() => setEditandoId(e.id)}
                    >
                      <span>✏️</span> Editar
                    </Button>
                  )}
                </td>
              </tr>
            ))}

            {!cargando && filtrarEquiposUnicos.length === 0 && (
              <tr>
                <td className="py-4 text-center text-gray-500" colSpan={15}>
                  No hay equipos disponibles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
