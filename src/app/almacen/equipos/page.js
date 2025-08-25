//src/app/almacen/equipos/page.js
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAuth } from "@/app/context/AuthContext";
import {
  addDoc,
  collection,
  getDocs,
  updateDoc,
  doc,
  setDoc,
  query,
  where,
  orderBy,
  limit as fbLimit,
  startAfter,
  serverTimestamp,
  deleteDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";
import { format, differenceInDays, startOfDay } from "date-fns";
import * as XLSX from "xlsx";

/* UI helpers */
function LoadingOverlay({ text = "Cargando datos…" }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70 dark:bg-black/60 backdrop-blur-sm">
      <div className="flex items-center gap-4 rounded-2xl bg-white/90 px-6 py-4 shadow-2xl ring-1 ring-black/5">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
        <span className="font-medium text-gray-700">{text}</span>
      </div>
    </div>
  );
}
function SkeletonRow() {
  return (
    <tr className="border-t animate-pulse">
      {Array.from({ length: 15 }).map((_, i) => (
        <td key={i} className="p-2">
          <div className="h-4 w-full rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

/* Config */
const PAGE_SIZE = 500;
const UBIC_EXCLUIDAS = ["avería", "pérdida", "garantía", "robo"];

/* Página */
export default function EquiposEditable() {
  const { userData } = useAuth();

  // data
  const [equipos, setEquipos] = useState([]);
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  // edición
  const [editing, setEditing] = useState({});
  const [editandoId, setEditandoId] = useState(null);

  // filtros
  const [filtroInput, setFiltroInput] = useState("");
  const [filtro, setFiltro] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroPriTec, setFiltroPriTec] = useState("");
  const [filtroTecLiq, setFiltroTecLiq] = useState("");
  const [filtroInv, setFiltroInv] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState(false);
  const [ocultarInstaladosBajas, setOcultarInstaladosBajas] = useState(true);

  // carga
  const [primeraCarga, setPrimeraCarga] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);
  const contenedorRef = useRef(null);

  // modo búsqueda SN
  const [modoBusquedaSN, setModoBusquedaSN] = useState(false);

  /* Debounce buscador */
  useEffect(() => {
    const t = setTimeout(() => setFiltro(filtroInput.trim()), 320);
    return () => clearTimeout(t);
  }, [filtroInput]);

  /* Cargar cuadrillas/usuarios */
  useEffect(() => {
    (async () => {
      try {
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
      } catch {
        toast.error("Error cargando cuadrillas/usuarios");
      }
    })();
  }, []);

  /* Helper: fusionar sin duplicar por id */
  const fusionarPorId = useCallback((prev, nuevos) => {
    const m = new Map(prev.map((e) => [e.id, e]));
    for (const n of nuevos) m.set(n.id, { ...m.get(n.id), ...n });
    return Array.from(m.values());
  }, []);

  /* Carga paginada */
  const cargarPagina = useCallback(async () => {
    if (cargando || !hasMore || modoBusquedaSN) return;
    setCargando(true);
    try {
      const base = lastDocRef.current
        ? query(
            collection(db, "equipos"),
            orderBy("SN"),
            startAfter(lastDocRef.current),
            fbLimit(PAGE_SIZE)
          )
        : query(collection(db, "equipos"), orderBy("SN"), fbLimit(PAGE_SIZE));

      const snap = await getDocs(base);
      if (snap.empty) {
        setHasMore(false);
      } else {
        lastDocRef.current = snap.docs[snap.docs.length - 1];
        const nuevos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEquipos((prev) => fusionarPorId(prev, nuevos));
      }
    } catch {
      toast.error("Error al cargar equipos");
    } finally {
      setCargando(false);
      setPrimeraCarga(false);
    }
  }, [cargando, hasMore, modoBusquedaSN, fusionarPorId]);

  useEffect(() => {
    cargarPagina();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Infinite scroll */
  const onScroll = useCallback(() => {
    const el = contenedorRef.current;
    if (!el || cargando || !hasMore || modoBusquedaSN) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
    if (nearBottom) cargarPagina();
  }, [cargando, hasMore, modoBusquedaSN, cargarPagina]);

  useEffect(() => {
    const el = contenedorRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  /* Búsqueda por SN (servidor) */
  const buscarSNServidor = useCallback(async () => {
    const term = filtro.trim();
    if (term.length < 3) {
      toast("Escribe al menos 3 caracteres de SN", { icon: "🔎" });
      return;
    }
    setModoBusquedaSN(true);
    setCargando(true);
    try {
      const qServer = query(
        collection(db, "equipos"),
        orderBy("SN"),
        where("SN", ">=", term),
        where("SN", "<=", term + "\uf8ff"),
        fbLimit(PAGE_SIZE)
      );
      const snap = await getDocs(qServer);
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEquipos(lista);
      setHasMore(false);
      lastDocRef.current = null;
      toast.success(`🔎 Resultados por SN: ${snap.size}`);
    } catch {
      toast.error("Error buscando por SN");
    } finally {
      setCargando(false);
      setPrimeraCarga(false);
    }
  }, [filtro]);

  const limpiarBusqueda = useCallback(() => {
    setModoBusquedaSN(false);
    setEquipos([]);
    setHasMore(true);
    lastDocRef.current = null;
    setPrimeraCarga(true);
    cargarPagina();
  }, [cargarPagina]);

  /* Utils */
  const esEquipoEnAlerta = (equipo) => {
    if (!equipo.f_ingreso) return false;
    const hoy = startOfDay(new Date());
    const fechaIngreso = startOfDay(
      equipo.f_ingreso?.toDate?.() || new Date(equipo.f_ingreso)
    );
    const dias = differenceInDays(hoy, fechaIngreso);
    return equipo.estado === "campo" && dias > 15;
  };

  const parseFecha = (val) => {
    if (!val) return "";
    if (val.toDate) return format(val.toDate(), "d/M/yyyy");
    const d = new Date(val);
    return isNaN(d.getTime()) ? "" : format(d, "d/M/yyyy");
  };

  const mostrarTecnicos = (equipo) => {
    if (equipo.tecnicos && equipo.tecnicos.length > 0) {
      return Array.isArray(equipo.tecnicos) ? equipo.tecnicos.join(", ") : equipo.tecnicos;
    }
    const cuadrilla = cuadrillas.find((c) => c.nombre === equipo.ubicacion);
    if (!cuadrilla || !cuadrilla.tecnicos) return "-";
    const nombres = cuadrilla.tecnicos
      .map((uid) => {
        const u = usuarios.find((x) => x.uid === uid);
        return u ? `${u.nombres} ${u.apellidos}` : null;
      })
      .filter(Boolean);
    return nombres.length ? nombres.join(", ") : "-";
  };

  const generarOpcionesUbicacion = (ubicActual) => {
    const nombresCuadrillas = (cuadrillas ?? []).map((c) => c?.nombre).filter(Boolean);
    const base = [...nombresCuadrillas, ...UBIC_EXCLUIDAS];
    if (ubicActual === "almacen") base.push("almacen");
    return [...new Set(base)].sort((a, b) => a.localeCompare(b));
  };

  /* Filtros en cliente */
  const filtrarEquipos = useMemo(() => {
    const f = (s) => (s ?? "").toString().toLowerCase();
    const qtxt = f(filtro);

    return equipos.filter((e) => {
      const coincideTxt =
        f(e.SN).includes(qtxt) || f(e.equipo).includes(qtxt) || f(e.cliente).includes(qtxt);

      const okEstado = filtroEstado ? e.estado === filtroEstado : true;
      const okUbic = filtroUbicacion ? e.ubicacion === filtroUbicacion : true;
      const okPri = filtroPriTec ? e["pri-tec"] === filtroPriTec : true;
      const okLiq = filtroTecLiq ? e["tec-liq"] === filtroTecLiq : true;
      const okInv = filtroInv ? e["inv"] === filtroInv : true;
      const okAlerta = filtroAlerta ? esEquipoEnAlerta(e) : true;

      return coincideTxt && okEstado && okUbic && okPri && okLiq && okInv && okAlerta;
    });
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

  const equiposParaTabla = useMemo(() => {
    let base = filtrarEquipos;
    if (ocultarInstaladosBajas) {
      base = base.filter(
        (e) =>
          e.estado !== "instalado" &&
          !UBIC_EXCLUIDAS.includes((e.ubicacion ?? "").toLowerCase()) &&
          (e.ubicacion ?? "").toLowerCase() !== "instalado"
      );
    }
    return base;
  }, [filtrarEquipos, ocultarInstaladosBajas]);

  // de-dup para render y keys estables
  const equiposParaRender = useMemo(() => {
    const m = new Map();
    for (const e of equiposParaTabla) {
      const k = `${e.id}|${e.SN || ""}`;
      if (!m.has(k)) m.set(k, e);
    }
    return Array.from(m.values());
  }, [equiposParaTabla]);

  /* Edición */
  const handleChange = (id, field, value) => {
    setEditing((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
        ...(field === "ubicacion"
          ? {
              estado: cuadrillas.map((c) => c.nombre).includes(value) ? "campo" : "almacen",
            }
          : {}),
      },
    }));
  };

  const confirmarGuardado = (id) => {
    toast(
      (t) => (
        <div>
          <p>💾 ¿Guardar cambios?</p>
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
      { duration: 9000 }
    );
  };

  const actualizarStockCuadrilla = async (nombreCuadrilla, cantidad, tipoEquipo) => {
    const c = cuadrillas.find((x) => x.nombre === nombreCuadrilla);
    if (!c) return;
    const stockRef = doc(db, `cuadrillas/${c.id}/stock_equipos/${tipoEquipo}`);
    await setDoc(
      stockRef,
      { cantidad: increment(cantidad), tipo: tipoEquipo, actualizadoEn: serverTimestamp() },
      { merge: true }
    );
  };

  const moverEquipoEntreCuadrillas = async (sn, equipoData, origen, destino) => {
    const o = cuadrillas.find((x) => x.nombre === origen);
    const d = cuadrillas.find((x) => x.nombre === destino);
    if (o) {
      await Promise.all([
        deleteDoc(doc(db, `cuadrillas/${o.id}/stock_equipos/${sn}`)).catch(() => {}),
        deleteDoc(doc(db, `cuadrillas/${o.id}/equipos_asignados/${sn}`)).catch(() => {}),
      ]);
    }
    if (d) {
      await setDoc(
        doc(db, `cuadrillas/${d.id}/equipos_asignados/${sn}`),
        {
          SN: equipoData.SN,
          descripcion: equipoData.descripcion || "",
          equipo: equipoData.equipo,
          estado: "campo",
          f_ingreso: equipoData.f_ingreso || serverTimestamp(),
        },
        { merge: false }
      );
    }
  };

  const guardarCambios = async (id) => {
    if (!editing[id]) return;
    const original = equipos.find((e) => e.id === id);
    const cambios = editing[id];
    try {
      await updateDoc(doc(db, "equipos", id), cambios);

      if (cambios.ubicacion && cambios.ubicacion !== original.ubicacion) {
        const nombresCuad = cuadrillas.map((c) => c.nombre);
        const origenEsCuad = nombresCuad.includes(original.ubicacion);
        const destinoEsCuad = nombresCuad.includes(cambios.ubicacion);

        if (origenEsCuad) await actualizarStockCuadrilla(original.ubicacion, -1, original.equipo);
        if (destinoEsCuad) await actualizarStockCuadrilla(cambios.ubicacion, 1, original.equipo);

        if (origenEsCuad || destinoEsCuad) {
          await moverEquipoEntreCuadrillas(
            original.SN,
            original,
            original.ubicacion,
            cambios.ubicacion
          );
        }

        await addDoc(collection(db, "notificaciones"), {
          tipo: "Movimiento de Equipo",
          mensaje: `🚚 ${userData?.nombres ?? ""} ${userData?.apellidos ?? ""} movió ${original.equipo} (SN: ${original.SN}) de "${original.ubicacion}" a "${cambios.ubicacion}"`,
          usuario: `${userData?.nombres ?? ""} ${userData?.apellidos ?? ""}`.trim(),
          fecha: serverTimestamp(),
          detalles: { sn: original.SN, equipo: original.equipo, de: original.ubicacion, a: cambios.ubicacion },
          visto: false,
        });
      }

      toast.success("✅ Cambios guardados");
      setEquipos((prev) => prev.map((e) => (e.id === id ? { ...e, ...cambios } : e)));
      setEditing((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    } catch {
      toast.error("Error al guardar");
    }
  };

  /* Exportar vista (sin actualizar campos) */
  const exportarEquipos = () => {
    if (equiposParaRender.length === 0) return toast.error("No hay equipos para exportar.");
    const data = equiposParaRender.map((e) => ({
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
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Equipos");
    const f = new Date();
    const nombre = `EQUIPOS-VISTA-${f.getDate()}-${f.getMonth() + 1}-${f.getFullYear()}.xlsx`;
    XLSX.writeFile(wb, nombre);
    toast.success(`📤 Exportados ${data.length}`);
  };

  /* Exportar TODO (servidor) */
  const traerTodosEquipos = async () => {
    const PAGE = 2000;
    let last = null;
    const out = [];
    while (true) {
      const qy = last
        ? query(collection(db, "equipos"), orderBy("SN"), startAfter(last), fbLimit(PAGE))
        : query(collection(db, "equipos"), orderBy("SN"), fbLimit(PAGE));
      const snap = await getDocs(qy);
      if (snap.empty) break;
      out.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) break;
    }
    const m = new Map(out.map((e) => [e.id, e]));
    return Array.from(m.values());
  };

  const exportarEquiposTodo = async () => {
    try {
      toast.loading("Exportando todos los equipos…", { id: "expall" });
      const todos = await traerTodosEquipos();
      if (todos.length === 0) {
        toast.dismiss("expall");
        return toast.error("No hay equipos para exportar.");
      }
      const data = todos.map((e) => ({
        SN: e.SN,
        Estado: e.estado,
        Tecnicos: Array.isArray(e.tecnicos) ? e.tecnicos.join(", ") : e.tecnicos || "",
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
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Equipos");
      const f = new Date();
      const nombre = `EQUIPOS-REDES-TODO-${f.getDate()}-${f.getMonth() + 1}-${f.getFullYear()}.xlsx`;
      XLSX.writeFile(wb, nombre);
      toast.success(`📦 Exportados ${data.length} equipos`, { id: "expall" });
    } catch {
      toast.error("Error al exportar", { id: "expall" });
    }
  };

  /* === NUEVO: Exportar PRI-TEC (marca "pri-tec"=si) === */
  const confirmarExportPriTec = async () => {
    const ids = new Set(equiposParaRender.map((e) => e.id));
    const fechaTexto = new Date().toLocaleDateString("es-PE").replaceAll("/", "-");
    const nombreArchivo = `PRI-TEC-${filtroPriTec || "Vista"}-${fechaTexto}.xlsx`;

    const dataExcel = equiposParaRender.map((e) => ({
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
      equiposParaRender.map((e) => updateDoc(doc(db, "equipos", e.id), { ["pri-tec"]: "si" }))
    );

    // Reflejar en estado local
    setEquipos((prev) =>
      prev.map((e) => (ids.has(e.id) ? { ...e, ["pri-tec"]: "si" } : e))
    );

    toast.success("⚡ PRI-TEC exportado y actualizado");
  };

  const exportarPriTec = () => {
    if (equiposParaRender.length === 0) return toast.error("No hay equipos para exportar.");
    toast(
      (t) => (
        <div>
          <p>
            ⚠️ Vas a exportar y actualizar <strong>PRI-TEC</strong> a <strong>“si”</strong> para
            los equipos visibles.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                await confirmarExportPriTec();
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

  /* === NUEVO: Exportar TEC-LIQ (marca "tec-liq"=si) === */
  const confirmarExportTecLiq = async () => {
    const ids = new Set(equiposParaRender.map((e) => e.id));
    const fechaTexto = new Date().toLocaleDateString("es-PE").replaceAll("/", "-");
    const nombreArchivo = `TEC-LIQ-${filtroTecLiq || "Vista"}-${fechaTexto}.xlsx`;

    const dataExcel = equiposParaRender.map((e) => ({
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
      equiposParaRender.map((e) => updateDoc(doc(db, "equipos", e.id), { ["tec-liq"]: "si" }))
    );

    setEquipos((prev) =>
      prev.map((e) => (ids.has(e.id) ? { ...e, ["tec-liq"]: "si" } : e))
    );

    toast.success("📦 TEC-LIQ exportado y actualizado");
  };

  const exportarTecLiq = () => {
    if (equiposParaRender.length === 0) return toast.error("No hay equipos para exportar.");
    toast(
      (t) => (
        <div>
          <p>
            ⚠️ Vas a exportar y actualizar <strong>TEC-LIQ</strong> a <strong>“si”</strong> para
            los equipos visibles.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                await confirmarExportTecLiq();
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

  /* Render */
  return (
    <div className="p-6">
      <Toaster position="top-right" />
      {primeraCarga && <LoadingOverlay text="Preparando la vista de equipos…" />}

      <h2 className="mb-3 flex items-center gap-2 text-2xl font-semibold">
        <span>📋</span> Equipos
      </h2>

      {/* Panel filtros */}
      <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-4 md:grid-cols-2">
          {/* Buscar */}
          <div className="col-span-1">
            <div className="relative">
              <Input
                value={filtroInput}
                onChange={(e) => setFiltroInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") buscarSNServidor();
                }}
                placeholder="🔎 Buscar SN (3+), tipo o cliente"
                className="w-full pl-3"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={buscarSNServidor}
                  className="rounded-full bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
                >
                  Buscar SN
                </Button>
                {modoBusquedaSN && (
                  <Button
                    size="sm"
                    onClick={limpiarBusqueda}
                    className="rounded-full bg-gray-200 px-3 py-1 text-gray-800 hover:bg-gray-300"
                  >
                    Salir de búsqueda
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Estado */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Estado</label>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Todos</option>
              {[...new Set(equipos.map((e) => e.estado).filter(Boolean))].map((estado, idx) => (
                <option key={idx} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          </div>

          {/* Ubicación */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Ubicación</label>
            <select
              value={filtroUbicacion}
              onChange={(e) => setFiltroUbicacion(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Todas</option>
              {generarOpcionesUbicacion().map((u, i) => (
                <option key={i} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Toggles */}
          <div className="flex flex-col justify-between">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ocultarInstaladosBajas}
                onChange={(e) => setOcultarInstaladosBajas(e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="text-sm">Ocultar instalados y bajas (por defecto)</span>
            </label>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={filtroAlerta}
                onChange={(e) => setFiltroAlerta(e.target.checked)}
                className="accent-yellow-500"
              />
              <span className="text-sm text-yellow-700">Antigüedad &gt; 15 días ⚠️</span>
            </label>
          </div>

          {/* Pri-Tec */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Pri-Tec</label>
            <select
              value={filtroPriTec}
              onChange={(e) => setFiltroPriTec(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="si">si</option>
              <option value="no">no</option>
            </select>
          </div>

          {/* Tec-Liq */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Tec-Liq</label>
            <select
              value={filtroTecLiq}
              onChange={(e) => setFiltroTecLiq(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="si">si</option>
              <option value="no">no</option>
            </select>
          </div>

          {/* Inv */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Inv</label>
            <select
              value={filtroInv}
              onChange={(e) => setFiltroInv(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Todos</option>
              <option value="si">si</option>
              <option value="no">no</option>
            </select>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              className="rounded-full bg-[#30518c] px-4 py-2 font-semibold text-white shadow hover:bg-[#27406f]"
              onClick={() => {
                setFiltroInput("");
                setFiltro("");
                setFiltroEstado("");
                setFiltroUbicacion("");
                setFiltroPriTec("");
                setFiltroTecLiq("");
                setFiltroInv("");
                setFiltroAlerta(false);
                setOcultarInstaladosBajas(true);
                if (modoBusquedaSN) limpiarBusqueda();
              }}
            >
              🧹 Limpiar
            </Button>

            <Button
              onClick={exportarEquipos}
              className="rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 px-4 py-2 font-semibold text-white shadow-md hover:from-blue-600 hover:to-blue-800"
            >
              📁 Exportar (vista)
            </Button>

            <Button
              onClick={exportarPriTec}
              className="rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 px-4 py-2 font-semibold text-white shadow-md hover:from-purple-600 hover:to-purple-800"
            >
              ⚡ Exportar PRI-TEC
            </Button>

            <Button
              onClick={exportarTecLiq}
              className="rounded-xl bg-gradient-to-r from-green-500 to-green-700 px-4 py-2 font-semibold text-white shadow-md hover:from-green-600 hover:to-green-800"
            >
              📦 Exportar TEC-LIQ
            </Button>

            <Button
              onClick={exportarEquiposTodo}
              className="rounded-xl bg-gradient-to-r from-slate-500 to-slate-700 px-4 py-2 font-semibold text-white shadow-md hover:from-slate-600 hover:to-slate-800"
            >
              📦 Exportar TODO
            </Button>
          </div>
        </div>
      </div>

      {/* Contadores */}
      <div className="mb-3 text-sm text-gray-600">
        <div>
          Equipos cargados: <b>{equipos.length}</b>{" "}
          {modoBusquedaSN && <em>(búsqueda por SN)</em>}
        </div>
        <div>Tras filtros: <b>{filtrarEquipos.length}</b></div>
        <div>Mostrando: <b>{equiposParaRender.length}</b></div>
      </div>

      {/* Tabla */}
      <div ref={contenedorRef} className="max-h-[75vh] overflow-auto rounded border">
        <table className="min-w-[1500px] text-sm">
          <thead className="sticky top-0 z-20 bg-gray-50 ring-1 ring-gray-100">
            <tr className="text-left">
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
            {cargando && equipos.length === 0 &&
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={`sk-${i}`} />)}

            {equiposParaRender.map((e) => (
              <tr key={`row-${e.id}|${e.SN || ""}`} className="border-t">
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
                    UBIC_EXCLUIDAS.includes((e.ubicacion ?? "").toLowerCase())
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
                    {generarOpcionesUbicacion(editing[e.id]?.ubicacion ?? e.ubicacion).map(
                      (op, idx) => (
                        <option key={`${op}-${idx}`} value={op}>
                          {op}
                        </option>
                      )
                    )}
                  </select>
                  {UBIC_EXCLUIDAS.includes((e.ubicacion ?? "").toLowerCase()) && (
                    <span className="ml-1">⚠️</span>
                  )}
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
                      value={(editing[e.id]?.[key] ?? e[key] ?? "no") === "si" ? "si" : "no"}
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
                        className="rounded-lg bg-emerald-500 px-4 py-2 text-white hover:bg-emerald-600"
                        onClick={() => confirmarGuardado(e.id)}
                      >
                        💾 Guardar
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-lg bg-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-400"
                        onClick={() => setEditandoId(null)}
                      >
                        ✖ Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
                      onClick={() => setEditandoId(e.id)}
                    >
                      ✏️ Editar
                    </Button>
                  )}
                </td>
              </tr>
            ))}

            {!cargando && equiposParaRender.length === 0 && (
              <tr>
                <td colSpan={15} className="py-10 text-center text-gray-600">
                  No hay equipos que coincidan. Ajusta filtros o desactiva “Ocultar instalados y
                  bajas”.
                </td>
              </tr>
            )}

            {cargando && equipos.length > 0 && (
              <tr>
                <td colSpan={15} className="p-4 text-center text-gray-500">
                  Cargando más…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!modoBusquedaSN && hasMore && (
        <div className="mt-3 text-center">
          <Button
            onClick={cargarPagina}
            disabled={cargando}
            className="rounded-full bg-gray-100 px-4 py-2 hover:bg-gray-200"
          >
            {cargando ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
    </div>
  );
}
