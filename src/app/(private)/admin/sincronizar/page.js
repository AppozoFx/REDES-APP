"use client";

import { useState } from "react";
import { collection, getDocs, setDoc, doc } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";

export default function SincronizarStock() {
  const [sincronizando, setSincronizando] = useState(false);

  const actualizarStockCuadrillas = async () => {
    setSincronizando(true);
    toast.loading("🔄 Sincronizando stock de equipos...");

    try {
      // 1️⃣ Obtener todas las cuadrillas y normalizar nombres
      const cuadrillasSnap = await getDocs(collection(db, "cuadrillas"));
      const cuadrillas = cuadrillasSnap.docs.map(doc => ({
        id: doc.id,
        nombre: (doc.data().nombre || "").trim().toLowerCase()
      }));

      // 2️⃣ Obtener todos los equipos con ubicación asignada
      const equiposSnap = await getDocs(collection(db, "equipos"));
      const equipos = equiposSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 3️⃣ Filtrar equipos con ubicación válida
      const equiposConUbicacion = equipos.filter(e => e.ubicacion);

      let contadorActualizados = 0;
      let contadorNoEncontrados = 0;

      // 4️⃣ Procesar cada equipo
      for (const equipo of equiposConUbicacion) {
        const ubicacionNormalizada = equipo.ubicacion.trim().toLowerCase();

        const cuadrilla = cuadrillas.find(c => c.nombre === ubicacionNormalizada);

        if (cuadrilla) {
          const ref = doc(db, "cuadrillas", cuadrilla.id, "stock_equipos", equipo.SN);
          await setDoc(ref, {
            SN: equipo.SN,
            equipo: equipo.equipo,
            descripcion: equipo.descripcion || "",
            estado: equipo.estado || "",
            f_ingreso: equipo.f_ingreso || null
          });
          contadorActualizados++;
        } else {
          console.warn(`⚠️ Ubicación sin coincidencia: ${equipo.ubicacion} (Equipo SN: ${equipo.SN})`);
          contadorNoEncontrados++;
        }
      }

      toast.dismiss();
      toast.success(`✅ Sincronización completada: ${contadorActualizados} equipos actualizados.`);

      if (contadorNoEncontrados > 0) {
        toast(`⚠️ ${contadorNoEncontrados} equipos no coincidieron con ninguna cuadrilla.`, { icon: "⚠️" });
      }

    } catch (error) {
      console.error("❌ Error durante la sincronización:", error);
      toast.dismiss();
      toast.error("❌ Error al sincronizar el stock. Revisa la consola.");
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h1 className="text-2xl font-bold mb-4">🔧 Sincronización de Stock de Equipos</h1>
      <p className="mb-6 text-gray-600">Esta herramienta actualizará el stock de equipos en cada cuadrilla según la ubicación registrada en la colección de equipos.</p>
      <Button
        onClick={actualizarStockCuadrillas}
        disabled={sincronizando}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg shadow"
      >
        {sincronizando ? "Sincronizando..." : "🚀 Iniciar Sincronización"}
      </Button>
    </div>
  );
}
