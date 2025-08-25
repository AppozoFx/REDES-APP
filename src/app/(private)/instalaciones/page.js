"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { db } from "@/firebaseConfig";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import toast from "react-hot-toast";
import dayjs from "dayjs";

export default function ImportarLiquidaciones() {
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [actualizarExistentes, setActualizarExistentes] = useState(false);

  const handleFileChange = (e) => {
    setArchivo(e.target.files[0]);
  };

  const manejarImportacion = async () => {
    if (!archivo) {
      toast.error("📂 Selecciona un archivo Excel primero");
      return;
    }

    setProcesando(true);
    setProgreso({ actual: 0, total: 0 });
    toast.loading("Iniciando importación...");

    try {
      const data = await archivo.arrayBuffer();
      const workbook = XLSX.read(data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const registros = XLSX.utils.sheet_to_json(sheet);

      let importados = [];
      let actualizados = [];
      let duplicados = [];

      setProgreso({ actual: 0, total: registros.length });

      for (const reg of registros) {
        const codigoCliente = reg.codigoCliente?.toString();
        if (!codigoCliente) {
          setProgreso(prev => ({ ...prev, actual: prev.actual + 1 }));
          continue;
        }

        const docRef = doc(db, "liquidacion_instalaciones", codigoCliente);
        const docSnap = await getDoc(docRef);

        // ✅ Conversión segura de fechaInstalacion
        let fechaInstalacion = null;
        if (reg.fechaInstalacion) {
          if (typeof reg.fechaInstalacion === "string") {
            // Soporta texto tipo "2/01/2025" o "2025-01-02"
            fechaInstalacion = dayjs(reg.fechaInstalacion, ["DD/MM/YYYY", "YYYY-MM-DD"]).isValid()
              ? dayjs(reg.fechaInstalacion, ["DD/MM/YYYY", "YYYY-MM-DD"]).toDate()
              : null;
          } else if (typeof reg.fechaInstalacion === "number") {
            // Formato Excel número de fecha
            fechaInstalacion = XLSX.SSF.parse_date_code(reg.fechaInstalacion);
            if (fechaInstalacion) {
              fechaInstalacion = new Date(
                fechaInstalacion.y,
                fechaInstalacion.m - 1,
                fechaInstalacion.d,
                fechaInstalacion.H || 0,
                fechaInstalacion.M || 0,
                fechaInstalacion.S || 0
              );
            }
          } else {
            fechaInstalacion = new Date(reg.fechaInstalacion);
          }
        }

        // Arrays
        const snMESH = reg.snMESH ? reg.snMESH.split(",").map(s => s.trim()) : [];
        const snBOX = reg.snBOX ? reg.snBOX.split(",").map(s => s.trim()) : [];

        const datos = {
          fechaInstalacion,
          tipoServicio: reg.tipoServicio || "",
          nActa: reg.nActa || "",
          codigoCliente,
          cliente: reg.cliente || "",
          documento: reg.documento || "",
          direccion: reg.direccion || "",
          residencialCondominio: reg.residencialCondominio || "",
          cuadrillaNombre: reg.cuadrilla || "",
          plan: reg.plan || "",
          snONT: reg.snONT || "",
          snMESH,
          snBOX,
          snFONO: reg.snFONO || "",
          planGamer: reg.planGamer || "",
          kitWifiPro: reg.kitWifiPro || "",
          servicioCableadoMesh: reg.servicioCableadoMesh || "",
          cat5e: Number(reg.cat5e) || 0,
          cat6: Number(reg.cat6) || 0,
          cableUTP: reg.cableUTP || "",
          observacion: reg.observacion || ""
        };

        if (docSnap.exists()) {
          if (actualizarExistentes) {
            await updateDoc(docRef, datos);
            actualizados.push({ codigoCliente });
          } else {
            duplicados.push({ codigoCliente });
          }
        } else {
          await setDoc(docRef, datos);
          importados.push({ codigoCliente });
        }

        setProgreso(prev => ({ ...prev, actual: prev.actual + 1 }));
      }

      toast.dismiss();
      toast.success(`✅ Terminado: ${importados.length} nuevos, ${actualizados.length} actualizados, ${duplicados.length} duplicados.`);

      // 📤 Exportar reporte Excel
      const wbReporte = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbReporte, XLSX.utils.json_to_sheet(importados), "Importados");
      XLSX.utils.book_append_sheet(wbReporte, XLSX.utils.json_to_sheet(actualizados), "Actualizados");
      XLSX.utils.book_append_sheet(wbReporte, XLSX.utils.json_to_sheet(duplicados), "Duplicados");
      XLSX.writeFile(wbReporte, "Reporte_Importacion_Liquidaciones.xlsx");

    } catch (error) {
      console.error("❌ Error al importar:", error);
      toast.dismiss();
      toast.error("Error durante la importación.");
    }

    setProcesando(false);
  };

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-4">📥 Importar Liquidaciones desde Excel</h1>
      <Input type="file" accept=".xlsx, .xls" onChange={handleFileChange} className="mb-4" />

      <div className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          id="actualizar"
          checked={actualizarExistentes}
          onChange={() => setActualizarExistentes(!actualizarExistentes)}
        />
        <label htmlFor="actualizar" className="text-gray-700 font-medium">
          Actualizar registros existentes
        </label>
      </div>

      <Button onClick={manejarImportacion} disabled={procesando}>
        {procesando ? "Procesando..." : "Iniciar Importación"}
      </Button>

      {procesando && (
        <p className="mt-4 text-blue-600 font-semibold">
          🔄 Importando: {progreso.actual} / {progreso.total} registros
        </p>
      )}
    </div>
  );
}
