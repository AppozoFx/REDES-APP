"use client";

import { useState } from "react";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { Button } from "@/app/components/ui/button";
import toast, { Toaster } from "react-hot-toast";

export default function LimpiarLiquidaciones() {
  const [revisando, setRevisando] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [resumen, setResumen] = useState([]);
  const [limpiado, setLimpiado] = useState(false);

  const camposTexto = [
  "cliente", "direccion", "documento", "kitWifiPro", "metraje", "nActa",
  "observacion", "observacionLlamada", "plan", "planGamer", "proidONT",
  "rotuloCTO", "servicioCableadoMesh", "snFONO", "snONT", "telefono",
  "tipoCuadrilla", "residencialCondominio", "horaInicio", "horaFinLlamada",
  "horaInicioLlamada", "snBOX", "snMESH"
];


  const revisarCamposVacios = async () => {
    setRevisando(true);
    toast.loading("🔍 Revisando documentos...");

    try {
      const snapshot = await getDocs(collection(db, "liquidacion_instalaciones"));
      const resultado = [];

      for (const d of snapshot.docs) {
        const data = d.data();
        const id = d.id;
        const actualizaciones = {};

        camposTexto.forEach(campo => {
          if (data[campo] === "") {
            actualizaciones[campo] = null;
          }
        });

        if (Array.isArray(data.snBOX) && data.snBOX.length === 1 && data.snBOX[0] === "") {
          actualizaciones.snBOX = [];
        }

        if (Array.isArray(data.snMESH) && data.snMESH.length === 1 && data.snMESH[0] === "") {
          actualizaciones.snMESH = [];
        }

        if (Object.keys(actualizaciones).length > 0) {
          resultado.push({ id, ...actualizaciones });
        }
      }

      setResumen(resultado);
      toast.dismiss();
      if (resultado.length === 0) {
        toast("✅ No se encontraron campos vacíos.");
      } else {
        toast.success(`✅ Se encontraron ${resultado.length} documentos a limpiar.`);
      }
    } catch (error) {
      console.error("❌ Error al revisar:", error);
      toast.dismiss();
      toast.error("❌ Error durante la revisión.");
    } finally {
      setRevisando(false);
    }
  };

  const aplicarLimpieza = async () => {
    setLimpiando(true);
    toast.loading("🧹 Aplicando limpieza...");

    try {
      for (const item of resumen) {
        const { id, ...updates } = item;
        const ref = doc(db, "liquidacion_instalaciones", id);
        await updateDoc(ref, updates);
      }

      toast.dismiss();
      toast.success("✅ Limpieza completada correctamente.");
      setResumen([]);
      setLimpiado(true);
    } catch (error) {
      console.error("❌ Error al limpiar:", error);
      toast.dismiss();
      toast.error("❌ Ocurrió un error al limpiar.");
    } finally {
      setLimpiando(false);
    }
  };

  return (
    <div className="p-6">
      <Toaster position="top-right" />
      <h1 className="text-2xl font-bold mb-4">🧼 Limpieza de campos vacíos</h1>
      <p className="mb-4 text-gray-600">Esta herramienta detecta y corrige campos vacíos en la colección <code>liquidacion_instalaciones</code>.</p>

      <Button
        onClick={revisarCamposVacios}
        disabled={revisando || limpiando}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg shadow"
      >
        {revisando ? "Revisando..." : "🔍 Revisar documentos"}
      </Button>

      {resumen.length > 0 && (
        <>
          <p className="mt-6 mb-2 text-gray-700">
            Se encontraron <strong>{resumen.length}</strong> documentos con campos vacíos:
          </p>

          <div className="overflow-auto max-h-[400px] border border-gray-300 rounded mb-6">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="border px-2 py-1 text-left">ID</th>
                  {Object.keys(resumen[0]).filter(k => k !== "id").map((campo, idx) => (
                    <th key={idx} className="border px-2 py-1 text-left">{campo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resumen.map((doc, idx) => (
                  <tr key={idx}>
                    <td className="border px-2 py-1 font-mono">{doc.id}</td>
                    {Object.keys(doc).filter(k => k !== "id").map((campo, j) => (
                      <td key={j} className="border px-2 py-1 text-center text-gray-500">
  {Array.isArray(doc[campo])
    ? JSON.stringify(doc[campo])
    : doc[campo] === null
    ? "null"
    : String(doc[campo])}
</td>

                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button
            onClick={aplicarLimpieza}
            disabled={limpiando}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg shadow"
          >
            {limpiando ? "Limpiando..." : "✅ Aplicar limpieza"}
          </Button>
        </>
      )}

      {limpiado && (
        <p className="mt-4 text-green-600">✅ La limpieza fue aplicada correctamente.</p>
      )}

      {!revisando && resumen.length === 0 && (
        <p className="mt-6 text-gray-400">No se ha ejecutado la revisión o no se encontraron campos vacíos.</p>
      )}
    </div>
  );
}
