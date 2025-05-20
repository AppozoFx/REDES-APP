"use client";
import { useState, useEffect } from "react"; // Asegúrate de tener useEffect si lo necesitas para otras cosas
import * as XLSX from "xlsx";
import { db } from "@/firebaseConfig";
import { collection, addDoc, getDocs, Timestamp, serverTimestamp, doc, setDoc } from "firebase/firestore"; // Añadido doc y setDoc
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";

export default function CargaEquipos() {
  const { userData } = useAuth();
  const [equiposParaCargar, setEquiposParaCargar] = useState([]); // Equipos que son realmente nuevos
  const [snExistentesEnExcelYDB, setSnExistentesEnExcelYDB] = useState([]); // SNs del Excel que ya están en DB
  const [archivoNombre, setArchivoNombre] = useState("");
  const [mensaje, setMensaje] = useState(null); // Cambiado para objeto
  const [resumen, setResumen] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const detectarEquipo = (descripcion) => {
    const desc = descripcion?.toUpperCase() || "";
    if (desc.includes("ONT HUAWEI")) return "ONT";
    if (desc.includes("K562E")) return "MESH";
    if (desc.includes("TELÉFONO")) return "FONO";
    if (desc.includes("BOX")) return "BOX";
    return "";
  };

  const convertirFecha = (valor) => {
    if (!valor) return Timestamp.fromDate(new Date()); // O null si prefieres no poner fecha por defecto
    if (!isNaN(valor)) { // Si es un número (formato Excel)
      const parsed = XLSX.SSF.parse_date_code(valor);
      if (parsed) return Timestamp.fromDate(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
    // Intenta parsear como string si no es número
    const date = new Date(valor);
    return isNaN(date.getTime()) ? Timestamp.fromDate(new Date()) : Timestamp.fromDate(date);
  };

  const mostrarFecha = (timestamp) => {
    if (!timestamp?.toDate) return "";
    const f = timestamp.toDate();
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  };

  const handleArchivo = async (e) => {
    const file = e.target.files[0];
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
        const nombresCuadrillas = cuadrillasSnap.docs.map(doc =>
          (doc.data().nombre || "").toLowerCase().trim()
        );

        const equiposEnDbSnap = await getDocs(collection(db, "equipos"));
        const snEnDb = new Set();
      equiposEnDbSnap.forEach(doc => {
        // Añadimos el ID del documento (que podría ser un SN para los nuevos)
        snEnDb.add(doc.id); 
        // Añadimos el valor del campo SN (para los documentos con ID aleatorio)
        if (doc.data().SN) {
          snEnDb.add(String(doc.data().SN).trim()); 
        }
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
            ubicacionFinal = cuadrillasSnap.docs.find(doc => (doc.data().nombre || "").toLowerCase().trim() === ubicacionLimpia)?.data().nombre || ubicacionLimpia; // Usar nombre original
            estadoFinal = "campo";
          } else if (ubicacionLimpia !== "" && ubicacionLimpia !== "almacen") {
             ubicacionesInvalidas++;
          }

          const equipoFormateado = {
            SN: snActual, // <--- AÑADIR ESTA LÍNEA para que el campo SN también exista
            // SN: snActual, // Se usará como ID, opcional guardarlo también como campo
            equipo: row.equipo || detectarEquipo(row.descripcion),
            // ... (todos los demás campos formateados como en tu código anterior)
            guia_ingreso: String(row.guia_ingreso || ""),
            f_ingreso: convertirFecha(row.f_ingreso),
            usuario: `${userData?.nombres || ""} ${userData?.apellidos || ""}`.trim(),
            estado: estadoFinal,
            ubicacion: ubicacionFinal,
            descripcion: String(row.descripcion || ""),
            tecnicos: row.tecnicos ? String(row.tecnicos).split(",").map(t => t.trim()) : [],
            f_despacho: row.f_despacho ? convertirFecha(row.f_despacho) : null,
            usuario_despacho: String(row.usuario_despacho || ""),
            cliente: String(row.cliente || ""),
            f_instalado: row.f_instalado ? convertirFecha(row.f_instalado) : null,
            proid: String(row.proid || ""),
            caso: String(row.caso || ""),
            observacion: String(row.observacion || ""),
            "pri-tec": String(row["pri-tec"] || 'no').toLowerCase() === "si" ? "si" : "no",
            "tec-liq": String(row["tec-liq"] || 'no').toLowerCase() === "si" ? "si" : "no",
            inv: String(row["inv"] || 'no').toLowerCase() === "si" ? "si" : "no",
        };
          
          // Ahora la verificación de duplicados es más completa
        if (snEnDb.has(snActual)) {
          _snExistentesEnExcelYDB.push({ SN: snActual, ...equipoFormateado });
        } else {
          // Preparamos para usar snActual como ID, guardándolo temporalmente en _id
          _equiposParaCargar.push({ _id: snActual, ...equipoFormateado }); 
        }
      }

        setEquiposParaCargar(_equiposParaCargar);
        setSnExistentesEnExcelYDB(_snExistentesEnExcelYDB);
        
        setMensaje({
        nuevos: _equiposParaCargar.length,
        existentesEnDB: _snExistentesEnExcelYDB.length,
        duplicadosInternos: contadorDuplicadosInternosExcel
      });

        toast.dismiss();
      let infoMsg = `✅ Archivo procesado: ${_equiposParaCargar.length} equipos nuevos para cargar. `;
      if (_snExistentesEnExcelYDB.length > 0) infoMsg += `${_snExistentesEnExcelYDB.length} SNs ya existen en la BD y serán omitidos. `;
      if (contadorDuplicadosInternosExcel > 0) infoMsg += `Se omitieron ${contadorDuplicadosInternosExcel} SNs duplicados dentro del mismo Excel.`;
      toast.success(infoMsg, { duration: 5000 });
      
      if (ubicacionesInvalidas > 0) {
        toast(`⚠️ ${ubicacionesInvalidas} ubicaciones no válidas fueron asignadas como "almacen".`, { icon: "⚠️", duration: 4000 });
      }

      } catch (error) {
        console.error("Error al procesar el archivo:", error);
        toast.dismiss();
        toast.error("❌ Error al procesar el archivo. Asegúrate de que sea un archivo Excel válido.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ""; // Para permitir recargar el mismo archivo
  };
  
  const handleDescargarPlantilla = () => {
    const data = [
      {
        SN: "123456789012345", // Campo SN debe ser texto
        guia_ingreso: "12345",
        f_ingreso: "2025-04-04", // Formato YYYY-MM-DD o número Excel
        descripcion: "ONT HUAWEI HG8145X6-10",
        equipo: "ONT", // Opcional si descripción es clara
        proid: "PRO123",
        ubicacion: "K11 RESIDENCIAL", 
        tecnicos: "TEC1,TEC2", // Nombres o IDs separados por coma
        f_instalado: "2025-04-10",
        f_despacho: "2025-04-05",
        usuario_despacho: "Nombre Apellido Despacho",
        cliente: "Juan Perez",
        caso: "CASO001",
        observacion: "Observacion de ejemplo",
        "pri-tec": "si", // "si" o "no"
        "tec-liq": "no", // "si" o "no"
        inv: "si"      // "si" o "no"
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    // Forzar la columna SN como texto
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) { // Iniciar desde la segunda fila (datos)
        const cell_address = {c:0, r:R}; // Columna A
        const cell_ref = XLSX.utils.encode_cell(cell_address);
        if(ws[cell_ref]) {
            ws[cell_ref].t = 's'; // Establecer tipo a string
            // Si el valor es numérico, convertirlo a string explícitamente
            if (typeof ws[cell_ref].v === 'number') {
                ws[cell_ref].v = String(ws[cell_ref].v);
            }
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
    setGuardando(true);
    const toastId = toast.loading("Guardando equipos en Firebase...");
    let equiposGuardadosExitosamente = 0;

    try {
      for (const equipoData of equiposParaCargar) {
        // El SN está en equipoData._id y lo usamos como ID del documento
        // El resto de los datos están en equipoData
        const { _id: sn, ...dataToSave } = equipoData; 
        const equipoRef = doc(db, "equipos", sn); // Usar SN como ID del documento
        
        // No necesitamos verificar si existe porque handleArchivo ya lo hizo.
        // Simplemente creamos el documento.
        await setDoc(equipoRef, {
            SN: sn, // Aseguramos que el campo SN esté presente
            ...dataToSave,
            createdAt: serverTimestamp(), // Añadir timestamp de creación
            lastUpdatedAt: serverTimestamp()
        });
        equiposGuardadosExitosamente++;
      }

      const conteo = {
        ONT: equiposParaCargar.filter(e => e.equipo === "ONT").length,
        MESH: equiposParaCargar.filter(e => e.equipo === "MESH").length,
        FONO: equiposParaCargar.filter(e => e.equipo === "FONO").length,
        BOX: equiposParaCargar.filter(e => e.equipo === "BOX").length,
      };
      setResumen(conteo); // Resumen de los equipos que SÍ se cargaron
      
      let successMessage = `✅ ${equiposGuardadosExitosamente} equipos nuevos cargados exitosamente.`;
      if (snExistentesEnExcelYDB.length > 0) {
        successMessage += ` ${snExistentesEnExcelYDB.length} SNs del Excel ya existían en la BD y fueron omitidos.`;
      }
      toast.success(successMessage, { id: toastId, duration: 5000 });
      
      // Limpiar solo los equipos que se iban a cargar
      setEquiposParaCargar([]); 
      // NO limpiar snExistentesEnExcelYDB aquí, para que el usuario pueda exportarlos.
      // El mensaje de pre-carga (`mensaje`) se puede limpiar o actualizar
      setMensaje(prev => ({...prev, nuevos: 0 }));


    } catch (err) {
      toast.error(`❌ Error al guardar los equipos: ${err.message}`, { id: toastId });
      console.error(err);
    } finally {
      setGuardando(false);
    }
  };

  const exportarSnExistentes = () => {
    if (snExistentesEnExcelYDB.length === 0) {
      toast.error("No hay SNs duplicados/existentes para exportar.");
      return;
    }
    const dataParaExportar = snExistentesEnExcelYDB.map(eq => ({
        SN: eq.SN,
        // Puedes añadir más campos del `eq` aquí si los necesitas en el Excel
        // Por ejemplo: eq.descripcion, eq.equipo, etc.
        // Esto asume que `eq` tiene la estructura completa del equipo formateado.
        Descripcion_Excel: eq.descripcion,
        Equipo_Excel: eq.equipo,
        GuiaIngreso_Excel: eq.guia_ingreso,
        FechaIngreso_Excel: mostrarFecha(eq.f_ingreso), // Formatear si es timestamp
        Ubicacion_Excel: eq.ubicacion,
        Estado_Excel: eq.estado
    }));

    const ws = XLSX.utils.json_to_sheet(dataParaExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SNs Existentes");
    XLSX.writeFile(wb, "SNs_Existentes_En_BD.xlsx");
    toast.success("📄 SNs que ya existían en la BD exportados a Excel.");
  };


  return (
    <div className="p-6 max-w-3xl mx-auto bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold text-[#30518c] mb-6 flex items-center gap-2">
        📥 Carga Masiva de Equipos
      </h1>
  
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Seleccionar archivo (.xlsx)
        </label>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <input
            type="file"
            accept=".xlsx"
            onChange={handleArchivo}
            className="block w-full sm:w-auto border border-gray-300 rounded px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={handleDescargarPlantilla}
            className="bg-[#30518c] hover:bg-[#203960] text-white px-4 py-2 rounded shadow flex items-center gap-2 text-sm"
          >
            📄 Descargar Plantilla
          </button>
        </div>
      </div>
  
      <p className="text-xs text-gray-500 mb-4">
        Por favor, asegúrate de usar la plantilla oficial para evitar errores en la carga. Solo se aceptan archivos en formato <strong>.xlsx</strong>.
        Los SNs que ya existan en la base de datos serán omitidos.
      </p>
  
      {archivoNombre && (
        <p className="text-sm text-gray-700 mb-2">
          📄 <strong>Archivo seleccionado:</strong> {archivoNombre}
        </p>
      )}
  
      {mensaje && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded shadow text-sm mb-4 space-y-1">
          <p className="font-semibold text-blue-700">Resumen del archivo procesado:</p>
          {mensaje.nuevos > 0 && <p className="text-green-700">SNs nuevos para cargar: <strong>{mensaje.nuevos}</strong></p>}
          {mensaje.existentesEnDB > 0 && <p className="text-yellow-700">SNs ya existentes en BD (serán omitidos): <strong>{mensaje.existentesEnDB}</strong></p>}
          {mensaje.duplicadosInternos > 0 && <p className="text-orange-600">SNs duplicados dentro del archivo Excel (se consideró solo el primero): <strong>{mensaje.duplicadosInternos}</strong></p>}
        </div>
      )}
  
      {equiposParaCargar.length > 0 && (
        <>
          <div className="mt-6 max-h-[300px] overflow-auto border rounded-md p-4 bg-gray-50 shadow text-sm">
            <h3 className="font-semibold mb-2 text-[#30518c]">📋 Previsualización de Equipos NUEVOS a Cargar ({equiposParaCargar.length}):</h3>
            <table className="min-w-full table-auto border border-gray-300">
              <thead className="bg-[#30518c] text-white">
                <tr>
                  <th className="px-3 py-2">SN (ID Documento)</th>
                  <th className="px-3 py-2">Equipo</th>
                  <th className="px-3 py-2">Guía Ingreso</th>
                  <th className="px-3 py-2">Fecha Ingreso</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">PROID</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {equiposParaCargar.map((e, i) => (
                  <tr key={e._id || i} className="border-t text-center hover:bg-gray-100"> 
                    <td className="py-1">{e._id}</td> 
                    <td>{e.equipo}</td>
                    <td>{e.guia_ingreso}</td>
                    <td>{mostrarFecha(e.f_ingreso)}</td>
                    <td>{e.descripcion}</td>
                    <td>{e.proid}</td>
                    <td>{e.ubicacion}</td>
                    <td>{e.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
  
          <button
            onClick={handleGuardar}
            disabled={guardando}
            className={`mt-4 font-bold px-6 py-2 rounded shadow transition text-lg
              ${guardando ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}
            `}
          >
            {guardando ? "⏳ Guardando..." : "✅ Guardar Equipos Nuevos en Firebase"}
          </button>
        </>
      )}

      {snExistentesEnExcelYDB.length > 0 && !guardando && ( // Mostrar solo si no se está guardando
        <div className="mt-6">
          <p className="text-sm text-yellow-700 font-semibold mb-2">
            Se encontraron {snExistentesEnExcelYDB.length} SNs en el archivo Excel que ya existen en la base de datos. Estos no serán creados nuevamente.
          </p>
          <button
            onClick={exportarSnExistentes}
            className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 text-sm"
          >
            📄 Exportar Lista de SNs Ya Existentes
          </button>
        </div>
      )}
  
      {resumen && !guardando && ( // Mostrar solo si no se está guardando
        <div className="mt-6 text-sm bg-blue-50 border-l-4 border-blue-400 p-4 rounded shadow">
          <p className="font-semibold text-blue-800">📊 Resumen de equipos NUEVOS agregados:</p>
          <ul className="ml-4 mt-2 space-y-1 text-blue-700">
            <li>🔹 ONT: {resumen.ONT}</li>
            <li>🔹 MESH: {resumen.MESH}</li>
            <li>🔹 FONO: {resumen.FONO}</li>
            <li>🔹 BOX: {resumen.BOX}</li>
          </ul>
        </div>
      )}
    </div>  
  );
}