"use client";

import { useState, useEffect } from "react";
import { Button } from "@/app/components/ui/button"; // Asumo que tienes este componente
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext"; 
import { useRouter } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions"; 
import { Loader2 } from "lucide-react"; // Para el ícono de carga

export default function ExportarLiquidacionesSheetsPage() {
  const { userData, loading } = useAuth();
  const router = useRouter();
  const [exportando, setExportando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState(null);

  // Protección de ruta: Solo usuarios con rol "TI" pueden acceder
  useEffect(() => {
    if (!loading) {
      if (!userData) {
        router.push("/login"); // Si no hay usuario, redirigir a login
        return;
      }
      // Verifica si el rol es un array o un string y si incluye "TI"
      const esTI = Array.isArray(userData.rol) ? userData.rol.includes("TI") : userData.rol === "TI";
      if (!esTI) {
        toast.error("Acceso denegado. Esta página es solo para personal de TI.");
        router.push("/dashboard"); // Redirigir a dashboard o página principal
      }
    }
  }, [userData, loading, router]);

  const handleExportar = async () => {
    setExportando(true);
    setUltimoResultado(null);
    const toastId = toast.loading("🔄 Exportando datos a Google Sheets... Esto puede tardar unos momentos.");

    try {
      const functionsInstance = getFunctions(); 
      // Asegúrate que el nombre de la función aquí coincida exactamente con el nombre exportado en tu index.js de Cloud Functions
      const exportarLiquidacionesASheetsFn = httpsCallable(functionsInstance, 'exportarLiquidacionesASheets'); 
      
      const result = await exportarLiquidacionesASheetsFn(); // Llamar a la Cloud Function
      
      toast.dismiss(toastId); // Cerrar el toast de carga

      if (result.data.success) {
        toast.success(result.data.message || "✅ Exportación completada exitosamente.");
        setUltimoResultado(`Exportados: ${result.data.count || 0} registros. Hoja: 'Instalaciones-Liquidadas'.`);
      } else {
        // Si la función devuelve success: false, pero no lanza un error HTTP
        throw new Error(result.data.message || "Error desconocido durante la exportación desde la función.");
      }
    } catch (error) {
      console.error("Error al llamar a la Cloud Function:", error);
      toast.dismiss(toastId); // Asegurarse de cerrar el toast de carga en caso de error
      
      let errorMessage = "❌ Error al exportar.";
      // Firebase Functions onCall devuelve errores con un objeto `error` que tiene `code` y `message`
      if (error.code && error.message) {
        errorMessage += ` Detalles: ${error.message} (Código: ${error.code})`;
      } else if (error.message) {
        errorMessage += ` Detalles: ${error.message}`;
      } else {
        errorMessage += " Error desconocido."
      }
      toast.error(errorMessage);
      setUltimoResultado(`Error: ${error.message || "Error desconocido."}`);
    } finally {
      setExportando(false);
    }
  };

  // Mostrar un loader mientras se verifica el usuario y los permisos
  if (loading || !userData || (userData && !(Array.isArray(userData.rol) ? userData.rol.includes("TI") : userData.rol === "TI"))) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100 dark:bg-black">
        <div className="text-center">
          <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4 mx-auto"></div>
          <p className="text-gray-500 dark:text-gray-400">Cargando o verificando permisos...</p>
        </div>
        <style jsx>{`
          .loader {
            border-top-color: #3498db; /* O tu color primario */
            animation: spinner 1.2s linear infinite;
          }
          @keyframes spinner {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-lg shadow-xl border border-gray-200 dark:bg-gray-800">
      <h1 className="text-3xl font-bold text-center text-[#2c5282] dark:text-blue-300 mb-8">
        📤 Exportar Liquidaciones a Google Sheets
      </h1>
      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 dark:border-blue-400 p-4 rounded-md mb-6">
        <p className="text-sm text-blue-700 dark:text-blue-200">
          Esta herramienta leerá todos los documentos de la colección <strong>liquidacion_instalaciones</strong> 
          y los exportará a la hoja de cálculo de Google Sheets llamada <strong>Instalaciones-Liquidadas</strong> 
          en el Drive de REDES M&D.
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
          <strong>Nota:</strong> La hoja existente será reemplazada con los datos actuales de Firestore. 
          Asegúrate de que la Cloud Function <code>exportarLiquidacionesASheets</code> esté desplegada y 
          configurada correctamente con los permisos y variables de entorno necesarias.
        </p>
      </div>
      
      <Button
        onClick={handleExportar}
        disabled={exportando}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-md shadow-lg disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 ease-in-out transform hover:scale-105 flex items-center justify-center"
      >
        {exportando ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Exportando...
          </>
        ) : (
          "🚀 Iniciar Exportación Manual a Google Sheets"
        )}
      </Button>

      {ultimoResultado && (
        <div className={`mt-6 p-4 rounded-md text-sm ${ultimoResultado.startsWith('Error') ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
          <strong>Último resultado:</strong> {ultimoResultado}
        </div>
      )}
    </div>
  );
}
