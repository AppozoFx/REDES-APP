// src/app/instalaciones/importar/page.js
"use client";

import { useAuth } from "@/app/context/AuthContext";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { db } from "@/firebaseConfig";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";

/* ===========================
   CONFIG / CONSTANTES
=========================== */
const rolesPermitidos = ["TI", "Gerencia", "Almacén", "Gestor"];
const MAX_FILE_MB = 10;
const PREVIEW_PAGE_SIZE = 50;

/* ===========================
   UTILIDADES (fuera del comp.)
=========================== */
const REGEX_HORA_EN_CAMINO =
  /Fecha:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+Estado:\s*En camino/g;
const REGEX_CUADRILLA = /^K\s*(\d+)/i;
const REGEX_CANT_MESH = /Cantidad de Mesh:\s*(\d+)/;
const REGEX_BOX_COMODATO = /(\d+)\s*WIN BOX \(EN COMODATO\)/gi;
const REGEX_BOX_ADICIONAL = /\+\s*(\d+)\s*WIN BOX/gi;

const extraerHora = (valor) => {
  try {
    if (typeof valor === "string" && valor.includes(":")) {
      const partes = valor.trim().split(" ");
      return partes[1] || "";
    }
    if (typeof valor === "number") {
      const totalSegundos = Math.round((valor % 1) * 86400);
      const horas = Math.floor(totalSegundos / 3600).toString().padStart(2, "0");
      const minutos = Math.floor((totalSegundos % 3600) / 60)
        .toString()
        .padStart(2, "0");
      return `${horas}:${minutos}`;
    }
    return "";
  } catch {
    return "";
  }
};

const extraerHoraEnCaminoDesdeTexto = (texto) => {
  if (!texto || typeof texto !== "string") return "";
  let match;
  let ultimaHora = "";
  while ((match = REGEX_HORA_EN_CAMINO.exec(texto)) !== null) {
    ultimaHora = match[2]; // hh:mm:ss
  }
  return ultimaHora ? ultimaHora.slice(0, 5) : "";
};

const extraerDatosIdenServi = (texto) => {
  const datosExtra = {
    cantMESHwin: "0",
    cantFONOwin: "0",
    cantBOXwin: "0",
  };

  if (!texto) return datosExtra;

  if (texto.includes("INTERNETGAMER")) {
    datosExtra.planGamer = "GAMER";
    datosExtra.cat6 = "1";
  }
  if (texto.includes("KIT WIFI PRO (EN VENTA)")) {
    datosExtra.kitWifiPro = "KIT WIFI PRO (AL CONTADO)";
  }
  if (texto.includes("SERVICIO CABLEADO DE MESH")) {
    datosExtra.servicioCableadoMesh = "SERVICIO CABLEADO DE MESH";
  }

  // Cantidad de Mesh
  const matchMesh = texto.match(/Cantidad de Mesh:\s*(\d+)/i);
  if (matchMesh) datosExtra.cantMESHwin = matchMesh[1];

  // FONO WIN
  if (texto.includes("FONO WIN 100")) datosExtra.cantFONOwin = "1";

  // Cantidad total de BOX
  let totalBox = 0;

  // Comodato
  for (const m of texto.matchAll(REGEX_BOX_COMODATO)) {
    totalBox += parseInt(m[1], 10) || 0;
  }

  // Adicionales con "+ n WIN BOX"
  for (const m of texto.matchAll(REGEX_BOX_ADICIONAL)) {
    totalBox += parseInt(m[1], 10) || 0;
  }

  datosExtra.cantBOXwin = String(totalBox);

  return datosExtra;
};


const parseFecha = (excelDate) => {
  if (typeof excelDate === "number") {
    const utcDays = Math.floor(excelDate - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return new Date(dateInfo.getTime() + (excelDate % 1) * 86400 * 1000).toISOString();
  }
  const d = new Date(excelDate);
  if (!isNaN(d)) return d.toISOString();
  return "";
};

const obtenerDiaSemana = (fecha) => {
  try {
    const dias = [
      "Domingo",
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
    ];
    const dia = new Date(fecha).getDay();
    return dias[dia];
  } catch {
    return "";
  }
};

const obtenerCodigoCuadrilla = (nombreCompleto) => {
  const match = nombreCompleto?.match(REGEX_CUADRILLA);
  if (!match) return null;
  const numero = match[1];
  const esMoto = nombreCompleto.toUpperCase().includes("MOTO");
  return `c_K${numero}${esMoto ? "_MOTO" : ""}`;
};

/* ===========================
   COMPONENTE
=========================== */
export default function ImportarInstalaciones() {
  const { userData, cargando } = useAuth();

  const [excelData, setExcelData] = useState([]);
  const [archivoNombre, setArchivoNombre] = useState("");
  const [archivoPesoMB, setArchivoPesoMB] = useState(0);

  // Landing breve
  const [landing, setLanding] = useState(true);

  // Overlay con barra indeterminada (sin precálculo)
  const [enviando, setEnviando] = useState(false);
  const [progress, setProgress] = useState(0); // barra visual

  const [resumen, setResumen] = useState(null);
  const [cuadrillasMap, setCuadrillasMap] = useState(new Map());
  const [page, setPage] = useState(1);

  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  // Bloquea scroll del body cuando enviando = true
  useEffect(() => {
    if (enviando) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [enviando]);

  // Permisos
  useEffect(() => {
    if (!cargando && userData && !userData.rol?.some((r) => rolesPermitidos.includes(r))) {
      toast.error("No tienes permiso para acceder a esta página.");
    }
  }, [userData, cargando]);

  // Cargar cuadrillas y mapear por ID
  useEffect(() => {
    const cargarCuadrillas = async () => {
      try {
        const snap = await getDocs(collection(db, "cuadrillas"));
        const map = new Map();
        snap.docs.forEach((doc) => map.set(doc.id, { id: doc.id, ...doc.data() }));
        setCuadrillasMap(map);
      } finally {
        setTimeout(() => setLanding(false), 400);
      }
    };
    cargarCuadrillas();
  }, []);

  // Barra indeterminada: avanza sola hasta 95% mientras {enviando}
  useEffect(() => {
    if (!enviando) {
      setProgress(0);
      return;
    }
    let mounted = true;
    let id = setInterval(() => {
      if (!mounted) return;
      setProgress((p) => (p < 95 ? p + 1 : 95));
    }, 80); // rápido y suave
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [enviando]);

  // Drag & drop básico
  useEffect(() => {
    const node = dropRef.current;
    if (!node) return;

    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = (e) => {
      prevent(e);
      if (!e.dataTransfer?.files?.length) return;
      const file = e.dataTransfer.files[0];
      handleFile(file);
    };

    node.addEventListener("dragenter", prevent);
    node.addEventListener("dragover", prevent);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", prevent);
      node.removeEventListener("dragover", prevent);
      node.removeEventListener("drop", onDrop);
    };
  }, []);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;

      const sizeMB = file.size / (1024 * 1024);
      setArchivoPesoMB(sizeMB.toFixed(2));
      setArchivoNombre(file.name);

      if (sizeMB > MAX_FILE_MB) {
        toast.error(`El archivo supera ${MAX_FILE_MB} MB. Divide el Excel o limpia columnas no usadas.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target.result;
          const wb = XLSX.read(bstr, { type: "binary" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: "",
            range: 8,
          });

          const procesado = jsonData.map((row) => {
            const geo = row[20]?.toString().split(",") || [];
            const tramo = extraerHora(row[3]);
            const horaEnCamino = extraerHoraEnCaminoDesdeTexto(row[21])?.slice(0, 5);
            const nombreOriginal = row[7]?.toString();

            const codigoCuadrilla = obtenerCodigoCuadrilla(nombreOriginal);
            const cuadrillaInfo = codigoCuadrilla ? cuadrillasMap.get(codigoCuadrilla) : null;

            const tipo = cuadrillaInfo?.tipo || "";
            const zona = cuadrillaInfo?.zona || "";
            const gestor = cuadrillaInfo?.gestor || "";
            const coordinador = cuadrillaInfo?.coordinador || "";

            const idenServiTexto = row[11];
            const datosExtra = extraerDatosIdenServi(idenServiTexto);

            return {
              id: row[0]?.toString(),
              tipoServicio: row[2],
              fechaInstalacion: parseFecha(row[3]),
              dia: obtenerDiaSemana(row[3]),
              tramo,
              cliente: row[4],
              tipoInstalacion: row[5],
              residencialCondominio: row[5]?.includes("Condominio") ? "CONDOMINIO" : "RESIDENCIAL",
              cuadrilla: row[7],
              estado: row[8],
              direccion: row[9],
              plan: row[11],
              region: row[12],
              zona: row[13],
              codigoCliente: row[14]?.toString(),
              documento: row[15]?.toString(),
              telefono: row[16]?.toString(),
              horaFin: extraerHora(row[17]),
              horaInicio: extraerHora(row[18]),
              motivoCancelacion: row[19],
              coordenadas: {
                lat: parseFloat(geo[0]) || null,
                lng: parseFloat(geo[1]) || null,
              },
              fSoliOriginal: row[3],
              horaEnCamino,
              cuadrillaNombre: cuadrillaInfo?.nombre || nombreOriginal,
              cuadrillaId: codigoCuadrilla || null,
              tipoCuadrilla: tipo,
              zonaCuadrilla: zona,
              gestorCuadrilla: gestor,
              coordinadorCuadrilla: coordinador,
              ...datosExtra,
            };
          });

          const filtrado = procesado.filter((r) => r.id);
          setExcelData(filtrado);
          setPage(1);
          toast.success("Archivo cargado correctamente");
        } catch (err) {
          console.error(err);
          toast.error("No se pudo leer el archivo. Verifica el formato.");
        }
      };
      reader.readAsBinaryString(file);
    },
    [cuadrillasMap]
  );

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
  };

  const limpiarTodo = () => {
    setExcelData([]);
    setArchivoNombre("");
    setArchivoPesoMB(0);
    setResumen(null);
    setPage(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const enviarAlServidor = async () => {
    setEnviando(true); // 🔒 overlay + barra
    const res = await fetch(
      "https://importarinstalaciones-p7c2u2btmq-uc.a.run.app",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instalaciones: excelData,
          usuario: `${userData?.nombres} ${userData?.apellidos}`,
        }),
      }
    );

    // Empujar la barra a 100% al terminar
    setProgress(100);

    const data = await res.json();

    if (data.success) {
      setResumen(data); // ⬅️ Resumen exactamente como lo entrega tu backend
      toast.success("✅ Importación completada");
      setExcelData([]);

      try {
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Importación",
          mensaje: `📥 ${data.usuario} importó instalaciones. Nuevos: ${data.nuevos}, Actualizados: ${data.actualizados}, Sin cambios: ${data.duplicadosSinCambios}`,
          usuario: data.usuario,
          fecha: serverTimestamp(),
          detalles: {
            nuevos: data.nuevos,
            actualizados: data.actualizados,
            duplicadosSinCambios: data.duplicadosSinCambios,
          },
          visto: false,
        });
      } catch (error) {
        console.error("❌ Error al registrar la notificación:", error);
        toast.error("⚠️ Importación correcta, pero falló la notificación");
      }
    } else {
      toast.error(data.message || "❌ Error al importar");
    }

    // Cerrar overlay con pequeña pausa para que se vea el 100%
    setTimeout(() => setEnviando(false), 300);
    return data.success;
  };

  const puedeVer = !!userData?.rol?.some((r) => rolesPermitidos.includes(r));
  if (!userData || cargando || !puedeVer) return null;

  const totalRegistros = excelData.length;
  const totalPages = Math.max(1, Math.ceil(totalRegistros / PREVIEW_PAGE_SIZE));
  const start = (page - 1) * PREVIEW_PAGE_SIZE;
  const previewRows = useMemo(
    () => excelData.slice(start, start + PREVIEW_PAGE_SIZE),
    [excelData, start]
  );

  return (
    <div className="relative p-6 w-full min-h-screen bg-slate-50 dark:bg-[#0f172a]">
      {/* ============== LANDING / SPLASH (corto) ============== */}
      {landing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-gradient-to-b from-white to-slate-100 dark:from-slate-900 dark:to-slate-950">
          <div className="w-[420px] max-w-[92vw] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 backdrop-blur p-8 text-center">
            <div className="mx-auto mb-5 h-14 w-14 rounded-full border-4 border-slate-300 dark:border-slate-700 border-t-transparent animate-spin" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Cargando Importador de Instalaciones…
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Preparando recursos y cuadrillas. Un momento por favor.
            </p>
          </div>
        </div>
      )}

      {/* ============== OVERLAY DE PROCESO (barra indeterminada) ============== */}
      {enviando && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="w-[420px] max-w-[92vw] rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              Importando instalaciones…
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              No cierres esta ventana. Estamos procesando {totalRegistros} registros.
            </p>

            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#30518c] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl pointer-events-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            📥 Importar Instalaciones (Excel)
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Arrastra tu archivo o selecciónalo. La lógica de carga se mantiene.
          </p>
        </div>

        {/* Card principal */}
        <div className="bg-white dark:bg-slate-800 shadow-lg rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Zona de carga */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-700">
            <div
              ref={dropRef}
              className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <p className="font-medium text-slate-800 dark:text-slate-100">
                Suelta aquí tu archivo .xlsx
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Tamaño máx.: {MAX_FILE_MB} MB
              </p>

              <div className="flex items-center justify-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={enviando}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg font-semibold bg-[#30518c] text-white hover:bg-[#274371] disabled:opacity-60"
                  disabled={enviando}
                >
                  Seleccionar archivo
                </button>
                <button
                  onClick={limpiarTodo}
                  className="px-4 py-2 rounded-lg font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-60"
                  disabled={enviando}
                >
                  Limpiar
                </button>
              </div>

              {archivoNombre && (
                <div className="mt-4 inline-flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    📄 {archivoNombre}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-300">
                    {archivoPesoMB} MB
                  </span>
                </div>
              )}

              {totalRegistros > 0 && (
                <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
                  Total de registros cargados:{" "}
                  <strong className="text-slate-900 dark:text-white">{totalRegistros}</strong>
                </p>
              )}
            </div>

            {/* Acciones */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                disabled={totalRegistros === 0 || enviando}
                onClick={() => {
                  toast.custom((t) => (
                    <div className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 p-4 shadow-lg rounded-xl border w-[360px]">
                      <h2 className="font-semibold text-lg text-[#30518c] mb-2">
                        ¿Confirmar importación?
                      </h2>
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        Se importarán <strong>{totalRegistros}</strong> registros.
                      </p>
                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          className="px-4 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm dark:bg-slate-700 dark:hover:bg-slate-600"
                          onClick={() => toast.dismiss(t.id)}
                        >
                          Cancelar
                        </button>
                        <button
                          className="px-4 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                          onClick={async () => {
                            toast.dismiss(t.id);
                            const toastId = toast.loading("Importando instalaciones…");
                            try {
                              await enviarAlServidor(); // overlay + barra indeterminada
                              toast.dismiss(toastId);
                            } catch (error) {
                              toast.error("❌ Error al importar", { id: toastId });
                            }
                          }}
                          disabled={enviando}
                        >
                          Confirmar
                        </button>
                      </div>
                    </div>
                  ));
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50"
              >
                {enviando ? "Importando…" : "Importar instalaciones"}
              </button>
            </div>
          </div>

          {/* Resumen (tal cual backend) */}
          {resumen && (
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <p className="font-semibold text-slate-800 dark:text-slate-100 mb-2">
                📊 Resumen de importación
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-slate-500">Usuario</div>
                  <div className="font-medium">{resumen.usuario}</div>
                </div>
                <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-slate-500">Fecha</div>
                  <div className="font-medium">
                    {new Date(resumen.fecha).toLocaleString("es-PE")}
                  </div>
                </div>
                <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-slate-500">Nuevos</div>
                  <div className="font-bold text-green-600">{resumen.nuevos}</div>
                </div>
                <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-slate-500">Actualizados</div>
                  <div className="font-bold text-amber-500">{resumen.actualizados}</div>
                </div>
                <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-slate-500">Sin cambios</div>
                  <div className="font-bold text-slate-500">
                    {resumen.duplicadosSinCambios}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Vista previa */}
          {totalRegistros > 0 && (
            <div className="p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  📊 Vista previa ({totalRegistros} registros) — mostrando {previewRows.length} por página
                </p>
                <div className="flex items-center gap-2 text-sm">
                  <button
                    className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || enviando}
                  >
                    ◀
                  </button>
                  <span className="text-slate-600 dark:text-slate-300">
                    Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                  </span>
                  <button
                    className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || enviando}
                  >
                    ▶
                  </button>
                </div>
              </div>

              <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="min-w-[900px] text-sm">
                  <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0 z-10">
                    <tr className="text-left text-slate-700 dark:text-slate-100">
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        Cliente (E)
                      </th>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        Fecha (D)
                      </th>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        Estado (I/J)
                      </th>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        Zona (N/L)
                      </th>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        Tramo (Q)
                      </th>
                      <th className="px-3 py-2 border-r border-slate-200 dark:border-slate-600">
                        TipoTraba (C)
                      </th>
                      <th className="px-3 py-2">F.Soli (F)</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-800 dark:text-slate-100">
                    {previewRows.map((row, i) => (
                      <tr
                        key={`${start + i}-${row.id}`}
                        className="even:bg-slate-50/60 dark:even:bg-slate-800/50"
                      >
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.cliente}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.fechaInstalacion?.slice(0, 10)}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.estado}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.zona}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.tramo}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.tipoServicio}
                        </td>
                        <td className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                          {row.fSoliOriginal || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Usando columnas: E (Cliente), D (Fecha), I/J (Estado), N/L (Zona), Q (Tramo), C (TipoTraba), F (F.Soli)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
