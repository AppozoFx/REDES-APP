// src/app/almacen/carga-equipos/page.js
"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  Timestamp,
  serverTimestamp,
  doc,
  setDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";

/* =========================
   Helpers UI
========================= */
const Stat = ({ label, value, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    orange: "bg-orange-50 text-orange-700 ring-orange-200",
  };
  return (
    <div className={`rounded-2xl p-4 ring-1 ${tones[tone]} flex flex-col gap-1`}>
      <span className="text-xs font-medium opacity-80">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </div>
  );
};

const Pill = ({ children, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

export default function CargaEquipos() {
  const { userData } = useAuth();

  /* =========================
     Estado (misma lógica de datos)
  ========================= */
  const [equiposParaCargar, setEquiposParaCargar] = useState([]); // NUEVOS
  const [snExistentesEnExcelYDB, setSnExistentesEnExcelYDB] = useState([]); // Duplicados en DB
  const [archivoNombre, setArchivoNombre] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [guardando, setGuardando] = useState(false);

  /* =========================
     Estado UI adicional
  ========================= */
  const [activeTab, setActiveTab] = useState("nuevos"); // 'nuevos' | 'duplicados'
  const [buscar, setBuscar] = useState("");
  const [compacta, setCompacta] = useState(false);

  // progreso real
  const [progPct, setProgPct] = useState(0);        // 0..100
  const [progDone, setProgDone] = useState(0);      // guardados
  const [progTotal, setProgTotal] = useState(0);    // a guardar

  /* =========================
     Bloqueo de scroll cuando guardando = true
  ========================= */
  useEffect(() => {
    if (guardando) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    return () => document.body.classList.remove("overflow-hidden");
  }, [guardando]);

  /* =========================
     Funciones de datos (misma lógica)
  ========================= */
  const detectarEquipo = (descripcion) => {
    const desc = descripcion?.toUpperCase() || "";
    if (desc.includes("ONT HUAWEI")) return "ONT";
    if (desc.includes("K562E")) return "MESH";
    if (desc.includes("TELÉFONO")) return "FONO";
    if (desc.includes("BOX")) return "BOX";
    return "";
  };

  const convertirFecha = (valor) => {
    if (!valor) return Timestamp.fromDate(new Date());
    if (!isNaN(valor)) {
      const parsed = XLSX.SSF.parse_date_code(valor);
      if (parsed) return Timestamp.fromDate(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
    const date = new Date(valor);
    return isNaN(date.getTime()) ? Timestamp.fromDate(new Date()) : Timestamp.fromDate(date);
  };

  const mostrarFecha = (timestamp) => {
    if (!timestamp?.toDate) return "";
    const f = timestamp.toDate();
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  };

  const handleArchivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setArchivoNombre("");
      setEquiposParaCargar([]);
      setSnExistentesEnExcelYDB([]);
      setMensaje(null);
      return;
    }
    setArchivoNombre(file.name);
    const reader = new FileReader();

    reader.onload = async (event) => {
      toast.loading("🔄 Procesando archivo Excel...");
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const hoja = workbook.Sheets[workbook.SheetNames[0]];
        const datosExcel = XLSX.utils.sheet_to_json(hoja);

        const cuadrillasSnap = await getDocs(collection(db, "cuadrillas"));
        const nombresCuadrillas = cuadrillasSnap.docs.map((d) =>
          (d.data().nombre || "").toLowerCase().trim()
        );

        const equiposEnDbSnap = await getDocs(collection(db, "equipos"));
        const snEnDb = new Set();
        equiposEnDbSnap.forEach((d) => {
          snEnDb.add(d.id);
          if (d.data().SN) snEnDb.add(String(d.data().SN).trim());
        });

        let _equiposParaCargar = [];
        let _snExistentesEnExcelYDB = [];
        let snProcesadosEnEsteExcel = new Set();
        let contadorDuplicadosInternosExcel = 0;
        let ubicacionesInvalidas = 0;

        for (const row of datosExcel) {
          if (!row.SN) continue;
          const snActual = String(row.SN).trim();

          if (snProcesadosEnEsteExcel.has(snActual)) {
            contadorDuplicadosInternosExcel++;
            continue;
          }
          snProcesadosEnEsteExcel.add(snActual);

          let ubicacionLimpia = (row.ubicacion || "").toLowerCase().trim();
          let ubicacionFinal = "almacen";
          let estadoFinal = "almacen";

          if (ubicacionLimpia === "instalado") {
            ubicacionFinal = "instalado";
            estadoFinal = "instalado";
          } else if (nombresCuadrillas.includes(ubicacionLimpia)) {
            ubicacionFinal =
              cuadrillasSnap.docs.find(
                (d) => (d.data().nombre || "").toLowerCase().trim() === ubicacionLimpia
              )?.data().nombre || ubicacionLimpia;
            estadoFinal = "campo";
          } else if (ubicacionLimpia !== "" && ubicacionLimpia !== "almacen") {
            ubicacionesInvalidas++;
          }

          const equipoFormateado = {
            SN: snActual,
            equipo: row.equipo || detectarEquipo(row.descripcion),
            guia_ingreso: String(row.guia_ingreso || ""),
            f_ingreso: convertirFecha(row.f_ingreso),
            usuario: `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim(),
            estado: estadoFinal,
            ubicacion: ubicacionFinal,
            descripcion: String(row.descripcion || ""),
            tecnicos: row.tecnicos ? String(row.tecnicos).split(",").map((t) => t.trim()) : [],
            f_despacho: row.f_despacho ? convertirFecha(row.f_despacho) : null,
            usuario_despacho: String(row.usuario_despacho || ""),
            cliente: String(row.cliente || ""),
            f_instalado: row.f_instalado ? convertirFecha(row.f_instalado) : null,
            proid: String(row.proid || ""),
            caso: String(row.caso || ""),
            observacion: String(row.observacion || ""),
            "pri-tec": String(row["pri-tec"] || "no").toLowerCase() === "si" ? "si" : "no",
            "tec-liq": String(row["tec-liq"] || "no").toLowerCase() === "si" ? "si" : "no",
            inv: String(row["inv"] || "no").toLowerCase() === "si" ? "si" : "no",
          };

          if (snEnDb.has(snActual)) {
            _snExistentesEnExcelYDB.push({ SN: snActual, ...equipoFormateado });
          } else {
            _equiposParaCargar.push({ _id: snActual, ...equipoFormateado });
          }
        }

        setEquiposParaCargar(_equiposParaCargar);
        setSnExistentesEnExcelYDB(_snExistentesEnExcelYDB);
        setMensaje({
          nuevos: _equiposParaCargar.length,
          existentesEnDB: _snExistentesEnExcelYDB.length,
          duplicadosInternos: contadorDuplicadosInternosExcel,
        });

        toast.dismiss();
        let infoMsg = `✅ Archivo procesado: ${_equiposParaCargar.length} equipos nuevos para cargar. `;
        if (_snExistentesEnExcelYDB.length > 0)
          infoMsg += `${_snExistentesEnExcelYDB.length} SNs ya existen en la BD y serán omitidos. `;
        if (contadorDuplicadosInternosExcel > 0)
          infoMsg += `Se omitieron ${contadorDuplicadosInternosExcel} SNs duplicados dentro del mismo Excel.`;
        toast.success(infoMsg, { duration: 5000 });

        if (ubicacionesInvalidas > 0) {
          toast(`⚠️ ${ubicacionesInvalidas} ubicaciones no válidas fueron asignadas como "almacen".`, {
            icon: "⚠️",
            duration: 4000,
          });
        }
      } catch (error) {
        console.error("Error al procesar el archivo:", error);
        toast.dismiss();
        toast.error("❌ Error al procesar el archivo. Asegúrate de que sea un archivo Excel válido.");
      }
    };

    reader.readAsArrayBuffer(file);
    e.target.value = ""; // Permitir recargar el mismo archivo
  };

  const handleDescargarPlantilla = () => {
    const data = [
      {
        SN: "123456789012345",
        guia_ingreso: "12345",
        f_ingreso: "2025-04-04",
        descripcion: "ONT HUAWEI HG8145X6-10",
        equipo: "ONT",
        proid: "PRO123",
        ubicacion: "K11 RESIDENCIAL",
        tecnicos: "TEC1,TEC2",
        f_instalado: "2025-04-10",
        f_despacho: "2025-04-05",
        usuario_despacho: "Nombre Apellido Despacho",
        cliente: "Juan Perez",
        caso: "CASO001",
        observacion: "Observacion de ejemplo",
        "pri-tec": "si",
        "tec-liq": "no",
        inv: "si",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const cell_address = { c: 0, r: R };
      const cell_ref = XLSX.utils.encode_cell(cell_address);
      if (ws[cell_ref]) {
        ws[cell_ref].t = "s";
        if (typeof ws[cell_ref].v === "number") ws[cell_ref].v = String(ws[cell_ref].v);
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "plantilla_equipos.xlsx");
  };

  const handleGuardar = async () => {
    if (equiposParaCargar.length === 0) {
      toast.error("No hay equipos nuevos para guardar.");
      return;
    }
    const ok = window.confirm(
      `Se guardarán ${equiposParaCargar.length} equipos nuevos con su SN como ID de documento. ¿Deseas continuar?`
    );
    if (!ok) return;

    // inicializar progreso
    setProgTotal(equiposParaCargar.length);
    setProgDone(0);
    setProgPct(0);

    setGuardando(true);
    let equiposGuardadosExitosamente = 0;

    try {
      const total = equiposParaCargar.length;
      let done = 0;

      for (const equipoData of equiposParaCargar) {
        const { _id: sn, ...dataToSave } = equipoData;
        const equipoRef = doc(db, "equipos", sn);
        await setDoc(equipoRef, {
          SN: sn,
          ...dataToSave,
          createdAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        });
        equiposGuardadosExitosamente++;
        // actualizar progreso real
        done += 1;
        const pct = Math.round((done / total) * 100);
        setProgDone(done);
        setProgPct(pct);
      }

      const conteo = {
        ONT: equiposParaCargar.filter((e) => e.equipo === "ONT").length,
        MESH: equiposParaCargar.filter((e) => e.equipo === "MESH").length,
        FONO: equiposParaCargar.filter((e) => e.equipo === "FONO").length,
        BOX: equiposParaCargar.filter((e) => e.equipo === "BOX").length,
      };
      setResumen({
        ...conteo,
        TOTAL: equiposGuardadosExitosamente,
      });

      let successMessage = `✅ ${equiposGuardadosExitosamente} equipos nuevos cargados exitosamente.`;
      if (snExistentesEnExcelYDB.length > 0) {
        successMessage += ` ${snExistentesEnExcelYDB.length} SNs del Excel ya existían en la BD y fueron omitidos.`;
      }
      toast.success(successMessage, { duration: 5000 });

      setEquiposParaCargar([]);
      setMensaje((prev) => ({ ...(prev || {}), nuevos: 0 }));
    } catch (err) {
      toast.error(`❌ Error al guardar los equipos: ${err.message}`);
      console.error(err);
    } finally {
      setGuardando(false);
      // al cerrar overlay, mantenemos el último valor de progreso por si quieres mostrarlo
      setProgPct(100);
    }
  };

  const exportarSnExistentes = () => {
    if (snExistentesEnExcelYDB.length === 0) {
      toast.error("No hay SNs duplicados/existentes para exportar.");
      return;
    }
    const dataParaExportar = snExistentesEnExcelYDB.map((eq) => ({
      SN: eq.SN,
      Descripcion_Excel: eq.descripcion,
      Equipo_Excel: eq.equipo,
      GuiaIngreso_Excel: eq.guia_ingreso,
      FechaIngreso_Excel: mostrarFecha(eq.f_ingreso),
      Ubicacion_Excel: eq.ubicacion,
      Estado_Excel: eq.estado,
    }));

    const ws = XLSX.utils.json_to_sheet(dataParaExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SNs Existentes");
    XLSX.writeFile(wb, "SNs_Existentes_En_BD.xlsx");
    toast.success("📄 SNs que ya existían en la BD exportados a Excel.");
  };

  /* =========================
     UI helpers
  ========================= */
  const limpiarTodo = () => {
    setArchivoNombre("");
    setEquiposParaCargar([]);
    setSnExistentesEnExcelYDB([]);
    setMensaje(null);
    setResumen(null);
    setBuscar("");
    setActiveTab("nuevos");
    toast("Formulario limpio.");
  };

  const eliminarFilaNuevos = (sn) => {
    setEquiposParaCargar((prev) => prev.filter((e) => e._id !== sn));
  };

  const equiposFiltrados = equiposParaCargar.filter((e) => {
    if (!buscar.trim()) return true;
    const q = buscar.toLowerCase();
    return (
      (e._id || "").toLowerCase().includes(q) ||
      (e.equipo || "").toLowerCase().includes(q) ||
      (e.descripcion || "").toLowerCase().includes(q) ||
      (e.ubicacion || "").toLowerCase().includes(q) ||
      (e.proid || "").toLowerCase().includes(q)
    );
  });

  /* =========================
     Render
  ========================= */
  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#30518c]">
            📥 Carga Masiva de Equipos
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Usa la plantilla oficial para evitar errores. Los SN existentes se omiten automáticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDescargarPlantilla}
            className="rounded-xl bg-[#30518c] px-4 py-2 text-white shadow hover:bg-[#203960]"
          >
            📄 Descargar Plantilla
          </button>
          <button
            onClick={limpiarTodo}
            className="rounded-xl bg-slate-100 px-4 py-2 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
          >
            🧹 Limpiar
          </button>
        </div>
      </div>

      {/* Dropzone */}
      <div
        className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center hover:bg-slate-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) {
            const input = document.getElementById("archivoExcel");
            if (input) {
              // @ts-ignore
              input.files = e.dataTransfer.files;
              const evt = new Event("change", { bubbles: true });
              input.dispatchEvent(evt);
            }
          }
        }}
      >
        <input
          id="archivoExcel"
          type="file"
          accept=".xlsx"
          onChange={handleArchivo}
          className="hidden"
        />
        <label
          htmlFor="archivoExcel"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-[#30518c] ring-1 ring-[#30518c]/30 hover:bg-[#30518c]/5"
        >
          ⬆️ Seleccionar archivo .xlsx
        </label>
        <p className="mt-2 text-xs text-slate-500">
          O arrastra y suelta aquí tu archivo Excel.
        </p>
        {archivoNombre && (
          <p className="mt-3 text-sm">
            📄 <span className="font-semibold">Archivo:</span> {archivoNombre}
          </p>
        )}
      </div>

      {/* Resumen procesado */}
      {mensaje && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="SN nuevos para cargar" value={mensaje.nuevos ?? 0} tone="green" />
          <Stat label="SN ya existen en BD" value={mensaje.existentesEnDB ?? 0} tone="amber" />
          <Stat label="Duplicados en el Excel" value={mensaje.duplicadosInternos ?? 0} tone="orange" />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setActiveTab("nuevos")}
          className={`rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition ${
            activeTab === "nuevos"
              ? "bg-[#30518c] text-white ring-[#30518c]"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          Nuevos{" "}
          <span className="ml-1 rounded-full bg-white/20 px-2 py-[2px] text-xs">
            {equiposParaCargar.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("duplicados")}
          className={`rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition ${
            activeTab === "duplicados"
              ? "bg-[#30518c] text-white ring-[#30518c]"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          Duplicados en BD{" "}
          <span className="ml-1 rounded-full bg-white/20 px-2 py-[2px] text-xs">
            {snExistentesEnExcelYDB.length}
          </span>
        </button>

        {/* Acciones de la pestaña NUEVOS */}
        {activeTab === "nuevos" && (
          <div className="ml-auto flex items-center gap-2">
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar SN, equipo, PROID, ubicación…"
              className="w-64 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-[#30518c]/30"
            />
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={compacta}
                onChange={(e) => setCompacta(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Vista compacta
            </label>
            <button
              onClick={handleGuardar}
              disabled={guardando || equiposParaCargar.length === 0}
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow ${
                guardando || equiposParaCargar.length === 0
                  ? "cursor-not-allowed bg-slate-200 text-slate-500"
                  : "bg-green-600 text-white hover:bg-green-700"
              }`}
            >
              {guardando ? "⏳ Guardando..." : "✅ Guardar nuevos"}
            </button>
          </div>
        )}

        {/* Acciones de la pestaña DUPLICADOS */}
        {activeTab === "duplicados" && (
          <div className="ml-auto">
            <button
              onClick={exportarSnExistentes}
              disabled={snExistentesEnExcelYDB.length === 0}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              📄 Exportar duplicados
            </button>
          </div>
        )}
      </div>

      {/* Paneles */}
      {activeTab === "nuevos" && (
        <>
          {equiposParaCargar.length > 0 ? (
            <div
              className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${
                compacta ? "p-2" : "p-4"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#30518c]">
                  📋 Previsualización de equipos NUEVOS ({equiposFiltrados.length}/{equiposParaCargar.length})
                </h3>
                <Pill tone="blue">Encabezado fijo</Pill>
              </div>

              <div className="mt-2 max-h-[420px] overflow-auto rounded-xl ring-1 ring-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-[#30518c] text-white z-10">
                    <tr>
                      <th className="px-3 py-2 text-left">SN (ID Doc)</th>
                      <th className="px-3 py-2 text-left">Equipo</th>
                      <th className="px-3 py-2 text-left">Guía</th>
                      <th className="px-3 py-2 text-left">F. Ingreso</th>
                      {!compacta && <th className="px-3 py-2 text-left">Descripción</th>}
                      <th className="px-3 py-2 text-left">PROID</th>
                      <th className="px-3 py-2 text-left">Ubicación</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equiposFiltrados.map((e, i) => (
                      <tr
                        key={e._id || i}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 font-medium">{e._id}</td>
                        <td className="px-3 py-2">{e.equipo}</td>
                        <td className="px-3 py-2">{e.guia_ingreso}</td>
                        <td className="px-3 py-2">{mostrarFecha(e.f_ingreso)}</td>
                        {!compacta && <td className="px-3 py-2">{e.descripcion}</td>}
                        <td className="px-3 py-2">{e.proid}</td>
                        <td className="px-3 py-2">{e.ubicacion}</td>
                        <td className="px-3 py-2">{e.estado}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => eliminarFilaNuevos(e._id)}
                            className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-50"
                            title="Quitar de la carga"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {equiposFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                          No hay coincidencias con <span className="font-semibold">“{buscar}”</span>.
                          Limpia la búsqueda para ver todos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Mostrando{" "}
                  <span className="font-semibold">{equiposFiltrados.length}</span> de{" "}
                  <span className="font-semibold">{equiposParaCargar.length}</span> registros.
                </span>
                <span>Los SN serán usados como ID de documento.</span>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleGuardar}
                  disabled={guardando || equiposParaCargar.length === 0}
                  className={`rounded-xl px-5 py-2 text-sm font-semibold shadow ${
                    guardando || equiposParaCargar.length === 0
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "bg-green-600 text-white hover:bg-green-700"
                  }`}
                >
                  {guardando ? "⏳ Guardando..." : "✅ Guardar equipos nuevos en Firebase"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
              Aún no hay previsualización. Carga un Excel para comenzar.
            </div>
          )}
        </>
      )}

      {activeTab === "duplicados" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {snExistentesEnExcelYDB.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-[#30518c]">
                ⚠️ SN encontrados que ya existen en la BD ({snExistentesEnExcelYDB.length})
              </h3>
              <div className="mt-2 max-h-[420px] overflow-auto rounded-xl ring-1 ring-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">SN</th>
                      <th className="px-3 py-2 text-left">Equipo</th>
                      <th className="px-3 py-2 text-left">Guía</th>
                      <th className="px-3 py-2 text-left">F. Ingreso</th>
                      <th className="px-3 py-2 text-left">Ubicación</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snExistentesEnExcelYDB.map((e, i) => (
                      <tr key={e.SN || i} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium">{e.SN}</td>
                        <td className="px-3 py-2">{e.equipo}</td>
                        <td className="px-3 py-2">{e.guia_ingreso}</td>
                        <td className="px-3 py-2">{mostrarFecha(e.f_ingreso)}</td>
                        <td className="px-3 py-2">{e.ubicacion}</td>
                        <td className="px-3 py-2">{e.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-600">
                  Estos registros no se crearán nuevamente.
                </p>
                <button
                  onClick={exportarSnExistentes}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-600"
                >
                  📄 Exportar lista
                </button>
              </div>
            </>
          ) : (
            <div className="text-center text-sm text-slate-600">
              No se detectaron duplicados en BD.
            </div>
          )}
        </div>
      )}

      {/* Resumen final (mejorado) */}
      {resumen && !guardando && (
        <div className="mt-6 rounded-2xl border border-[#30518c]/20 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-[#30518c]/10 grid place-items-center">
                <span className="text-lg">📊</span>
              </div>
              <div>
                <h4 className="text-base font-semibold text-slate-900">Resumen de carga completada</h4>
                <p className="text-xs text-slate-600">Los equipos fueron guardados correctamente en Firestore.</p>
              </div>
            </div>
            <Pill tone="green">Total: {resumen.TOTAL}</Pill>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">ONT</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{resumen.ONT}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">MESH</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{resumen.MESH}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">FONO</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{resumen.FONO}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500">BOX</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{resumen.BOX}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            Consejo: Puedes descargar la lista de duplicados desde la pestaña <span className="font-semibold">Duplicados</span>.
          </div>
        </div>
      )}

      {/* Overlay de guardado con progreso real */}
      {guardando && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Guardando equipos"
          className="fixed inset-0 z-[9999] grid place-items-center bg-slate-900/60 backdrop-blur-sm"
          style={{ pointerEvents: "auto" }}
        >
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl ring-1 ring-slate-200">
            {/* Spinner + porcentaje */}
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-[#30518c]" />
            <h3 className="text-base font-semibold text-slate-900">
              Guardando equipos…
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {progDone} de {progTotal} registros • <span className="font-semibold">{progPct}%</span>
            </p>

            {/* Barra de progreso real */}
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div
                className="h-full rounded-full bg-[#30518c] transition-[width] duration-200 ease-out"
                style={{ width: `${progPct}%` }}
              />
            </div>

            {/* Texto de ayuda */}
            <div className="mt-3 text-xs text-slate-500">
              No cierres la ventana. Este proceso puede tardar según el tamaño del archivo.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
