"use client";

import { useAuth } from "@/app/context/AuthContext";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { db } from "@/firebaseConfig";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";


const rolesPermitidos = ["TI", "Gerencia", "Almacén", "Gestor"];

export default function ImportarInstalaciones() {
  const { userData, cargando } = useAuth();
  const [excelData, setExcelData] = useState([]);
  const [archivoNombre, setArchivoNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [cuadrillas, setCuadrillas] = useState([]);
  

  useEffect(() => {
    if (!cargando && userData && !userData.rol?.some((r) => rolesPermitidos.includes(r))) {
      toast.error("No tienes permiso para acceder a esta página.");
    }
  }, [userData, cargando]);

  useEffect(() => {
    const cargarCuadrillas = async () => {
      const snap = await getDocs(collection(db, "cuadrillas"));
      setCuadrillas(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    };
    cargarCuadrillas();
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setArchivoNombre(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", range: 8 });

      const procesado = jsonData.map((row) => {
        const geo = row[20]?.toString().split(",") || [];
        const tramo = extraerHora(row[3]);
        const horaEnCamino = extraerHoraEnCaminoDesdeTexto(row[21])?.slice(0, 5);
        const nombreOriginal = row[7]?.toString();
const codigoCuadrilla = obtenerCodigoCuadrilla(nombreOriginal);
const cuadrillaInfo = cuadrillas.find((c) => c.id === codigoCuadrilla);


let tipo = "";
let zona = "";
let gestor = "";
let coordinador = "";

if (cuadrillaInfo) {
  tipo = cuadrillaInfo.tipo || "";
  zona = cuadrillaInfo.zona || "";
  gestor = cuadrillaInfo.gestor || "";
  coordinador = cuadrillaInfo.coordinador || "";
}

 // ⭐ Aquí defines datosExtra antes del return
 const idenServiTexto = row[11];   // Ajusta si es necesario
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
          horaEnCamino: horaEnCamino, // Asegúrate que esta línea esté
          cuadrillaNombre: cuadrillaInfo?.nombre || nombreOriginal,
cuadrillaId: codigoCuadrilla,
tipoCuadrilla: tipo,
zonaCuadrilla: zona,
gestorCuadrilla: gestor,
coordinadorCuadrilla: coordinador,

// ➕ Agregamos los campos extraídos de IdenServi
...datosExtra

        };
      });

      setExcelData(procesado.filter((r) => r.id));
      toast.success("Archivo cargado correctamente");
    };
    reader.readAsBinaryString(file);
  };

  const extraerHora = (valor) => {
    try {
      if (typeof valor === "string" && valor.includes(":")) {
        const partes = valor.trim().split(" ");
        return partes[1] || "";
      }
      if (typeof valor === "number") {
        const totalSegundos = Math.round((valor % 1) * 86400);
        const horas = Math.floor(totalSegundos / 3600).toString().padStart(2, "0");
        const minutos = Math.floor((totalSegundos % 3600) / 60).toString().padStart(2, "0");
        return `${horas}:${minutos}`;
      }
      return "";
    } catch {
      return "";
    }
  };

  const extraerHoraEnCaminoDesdeTexto = (texto) => {
    if (!texto || typeof texto !== "string") return "";
  
    const regex = /Fecha:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+Estado:\s*En camino/g;
    let match;
    let ultimaHora = "";
  
    // Recorre todas las coincidencias de "Estado: En camino"
    while ((match = regex.exec(texto)) !== null) {
      ultimaHora = match[2]; // Captura la hora completa (hh:mm:ss)
    }
  
    // Retorna solo hh:mm si se encontró al menos una coincidencia
    return ultimaHora ? ultimaHora.slice(0, 5) : "";
  };

  const extraerDatosIdenServi = (texto) => {
    const datosExtra = {};
  
    if (!texto) return datosExtra;
  
    if (texto.includes("INTERNETGAMER 350 Mbps")) {
      datosExtra.planGamer = "GAMER";
      datosExtra.cat6 = "1";
    }
  
    if (texto.includes("KIT WIFI PRO (EN VENTA)")) {
      datosExtra.kitWifiPro = "KIT WIFI PRO (AL CONTADO)";
    }
  
    if (texto.includes("SERVICIO CABLEADO DE MESH")) {
      datosExtra.servicioCableadoMesh = "SERVICIO CABLEADO DE MESH";
    }
  
    // ⭐ Cantidad de Mesh dinámico
    const matchMesh = texto.match(/Cantidad de Mesh:\s*(\d+)/);
    if (matchMesh) {
      datosExtra.cantMESHwin = matchMesh[1];
    }
  
    // ⭐ Cantidad de FONO
    if (texto.includes("FONO WIN 100")) {
      datosExtra.cantFONOwin = "1";
    }
  
    // ⭐ Cantidad de BOX dinámica
    const comodatoMatch = texto.match(/(\d+)\s*WIN BOX \(EN COMODATO\)/);
    let totalBox = comodatoMatch ? parseInt(comodatoMatch[1]) : 0;
  
    const adicionales = (texto.match(/\+\s*1\s*WIN BOX/g) || []).length;
  
    totalBox += adicionales;
  
    if (totalBox > 0) {
      datosExtra.cantBOXwin = totalBox.toString();
    }
  
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
      const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
      const dia = new Date(fecha).getDay();
      return dias[dia];
    } catch {
      return "";
    }
  };

  const obtenerCodigoCuadrilla = (nombreCompleto) => {
    const match = nombreCompleto?.match(/^K\s*(\d+)/i);
    if (!match) return null;
  
    const numero = match[1];
    const esMoto = nombreCompleto.toUpperCase().includes("MOTO");
  
    return `c_K${numero}${esMoto ? "_MOTO" : ""}`;
  };
  

  const enviarAlServidor = async () => {
    setEnviando(true);
    const res = await fetch("https://importarinstalaciones-p7c2u2btmq-uc.a.run.app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instalaciones: excelData, usuario: `${userData?.nombres} ${userData?.apellidos}` }),
    });

    const data = await res.json();

    if (data.success) {
      setResumen(data);
      toast.success("✅ Importación completada");
      setExcelData([]);
  
      try {
        // 🚨 Crear Notificación en Firestore
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Importación",
          mensaje: `📥 ${data.usuario} importó instalaciones. Nuevos: ${data.nuevos}, Actualizados: ${data.actualizados}, Sin cambios: ${data.duplicadosSinCambios}`,
          usuario: data.usuario,
          fecha: serverTimestamp(),
          //link: `https://firebasestorage.googleapis.com/v0/b/tu-proyecto.appspot.com/o/guias_devolucion%2F${datosFinal.guiaId}.pdf?alt=media`,
          detalles: {
            nuevos: data.nuevos,
            actualizados: data.actualizados,
            duplicadosSinCambios: data.duplicadosSinCambios
          },
          visto: false
        });
      } catch (error) {
        console.error("❌ Error al registrar la notificación:", error);
        toast.error("⚠️ Importación correcta, pero falló la notificación");
      }
  
  } else {
      toast.error(data.message || "❌ Error al importar");
  }
  

  return data.success;
};

  if (!userData || cargando || !userData.rol?.some((r) => rolesPermitidos.includes(r))) return null;

  return (
    <div className="p-6 w-full dark:bg-[#0f172a] min-h-screen">
  <div className="bg-white dark:bg-slate-800 dark:text-gray-100 shadow-md rounded-xl p-6">

        <h1 className="text-2xl font-bold mb-4">📥 Importar Instalaciones desde Excel</h1>

        <label className="block mb-2 font-medium">Seleccionar archivo</label>
        <input
          type="file"
          accept=".xlsx"
          onChange={handleFileUpload}
          className="mb-4 p-2 border border-gray-300 rounded-md w-full max-w-md bg-white dark:bg-slate-700 dark:border-gray-600 dark:text-white"
        />

        {archivoNombre && (
          <p className="text-sm text-gray-600 mb-4">📄 <strong>Archivo:</strong> {archivoNombre}</p>
        )}

{excelData.length > 0 && (
  <p className="text-sm mb-4 text-gray-700 dark:text-gray-300">
    Total de registros cargados: <strong>{excelData.length}</strong>
  </p>
)}


<button
  disabled={excelData.length === 0 || enviando}
  onClick={() => {
    toast.custom((t) => (
      <div className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 p-4 shadow-md rounded border w-[320px]">

        <h2 className="font-semibold text-lg text-[#30518c] mb-2">¿Confirmar importación?</h2>
        <p className="text-sm text-gray-700">¿Deseas importar las instalaciones mostradas?</p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-4 py-1 rounded bg-gray-300 hover:bg-gray-400 text-sm"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
            onClick={async () => {
              toast.dismiss(t.id);
              const toastId = toast.loading("Importando instalaciones...");
              setEnviando(true);
              try {
                const ok = await enviarAlServidor();
                toast.dismiss(toastId); // solo si fue exitoso
              } catch (error) {
                toast.error("❌ Error al importar", { id: toastId });
              } finally {
                setEnviando(false);
              }
            }}
            
          >
            Confirmar
          </button>
        </div>
      </div>
    ));
  }}
  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
>
  Importar instalaciones
</button>


        {resumen && (
          <div className="bg-white dark:bg-slate-800 mt-6 p-4 rounded-lg border border-gray-300 dark:border-gray-600 shadow-md text-sm text-gray-800 dark:text-gray-100">

            <p className="font-semibold text-blue-700 mb-2">📊 Resumen de importación:</p>
            <ul className="space-y-1">
              <li>👤 Usuario: <strong>{resumen.usuario}</strong></li>
              <li>🕒 Fecha: {new Date(resumen.fecha).toLocaleString("es-PE")}</li>
              <li>🆕 Nuevos registros: <strong className="text-green-600">{resumen.nuevos}</strong></li>
              <li>🔁 Actualizados: <strong className="text-yellow-600">{resumen.actualizados}</strong></li>
              <li>🚫 Sin cambios: <strong className="text-gray-500">{resumen.duplicadosSinCambios}</strong></li>
            </ul>
          </div>
        )}

        {excelData.length > 0 && (
          <div className="overflow-x-auto text-sm mt-6">
            <p className="mb-2 font-semibold text-gray-700">
              📊 Vista previa de registros ({excelData.length}) usando columnas:
              <br />
              E (Cliente), D (Fecha), I (Estado), N (Zona), Q (Tramo), C (TipoTraba), F (F.Soli), J (Estado), L (Zona)
            </p>
            <table className="min-w-full border border-gray-300 dark:border-gray-600">
  <thead className="bg-gray-100 dark:bg-slate-700">

                <tr>
                  <th className="border px-2 py-1">Cliente (E)</th>
                  <th className="border px-2 py-1">Fecha (D)</th>
                  <th className="border px-2 py-1">Estado (I)</th>
                  <th className="border px-2 py-1">Zona (N)</th>
                  <th className="border px-2 py-1">Tramo (Q)</th>
                  <th className="border px-2 py-1">TipoTraba (C)</th>
                  <th className="border px-2 py-1">F.Soli (F)</th>
                  <th className="border px-2 py-1">Estado (J)</th>
                  <th className="border px-2 py-1">Zona (L)</th>
                </tr>
              </thead>
              <tbody>
                {excelData.slice(0, 5).map((row, i) => (
                  <tr key={i} className="text-center">
                    <td className="border px-2 py-1">{row.cliente}</td>
                    <td className="border px-2 py-1">{row.fechaInstalacion?.slice(0, 10)}</td>
                    <td className="border px-2 py-1">{row.estado}</td>
                    <td className="border px-2 py-1">{row.zona}</td>
                    <td className="border px-2 py-1">{row.tramo}</td>
                    <td className="border px-2 py-1">{row.tipoServicio}</td>
                    <td className="border px-2 py-1">{row.fSoliOriginal || ""}</td>
                    <td className="border px-2 py-1">{row.estado}</td>
                    <td className="border px-2 py-1">{row.zona}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}


      </div>
    </div>
  );
}