"use client";

import { useState } from "react";
import { db } from "@/firebaseConfig";
import { collection, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import toast, { Toaster } from "react-hot-toast";

export default function MaterialesPage() {
  const { userData } = useAuth();
  const [cantidades, setCantidades] = useState({});
  const [resumen, setResumen] = useState(null);

  const materiales = [
    "bobina", "conectores", "acopladores", "pachcord", "cintillos 30",
    "cintillos bandera", "caja grapas", "hebillas", "cinta bandi", "clevis",
    "cinta aislante", "cintillos 10", "anclajes tipo p", "templadores",
    "rosetas", "actas"
  ];

  const handleChange = (e, material) => {
    const value = parseInt(e.target.value) || 0;
    setCantidades(prev => ({ ...prev, [material]: value }));
  };

  const calcularBobinas = (metros) => {
    const bobinas = Math.floor(metros / 2000);
    const resto = metros % 2000;
    return `${bobinas} bobinas${resto > 0 ? ` y ${resto} m` : ""}`;
  };

  const handleGuardar = async () => {
    if (!userData) return;

    const resumenIngreso = {};
    let totalIngresados = 0;

    const loadingToast = toast.loading("Registrando materiales...");

    try {
      for (const material of materiales) {
        const cantidad = cantidades[material] || 0;
        if (cantidad === 0) continue;

        const docRef = doc(db, "materiales_stock", material);
        const docSnap = await getDoc(docRef);
        const actual = docSnap.exists() ? docSnap.data().cantidad || 0 : 0;
        const nuevo = actual + cantidad;

        await setDoc(docRef, {
          cantidad: nuevo,
          actualizado: serverTimestamp(),
          usuario: `${userData.nombres} ${userData.apellidos}`,
        });

        resumenIngreso[material] = cantidad;
        totalIngresados += 1;
      }

      if (totalIngresados === 0) {
        toast.dismiss(loadingToast);
        toast.error("⚠️ No ingresaste cantidades válidas.");
        return;
      }

      toast.dismiss(loadingToast);
      toast.success("✅ Materiales registrados correctamente.");
      setResumen(resumenIngreso);
      setCantidades({});
    } catch (error) {
      console.error("Error al registrar materiales:", error);
      toast.dismiss(loadingToast);
      toast.error("❌ Ocurrió un error al guardar los datos.");
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Toaster position="top-right" />
      <h1 className="text-2xl font-bold text-[#30518c] mb-4">📦 Registro de Materiales Complementarios</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {materiales.map((material) => (
          <div key={material} className="flex flex-col">
            <label className="text-sm font-medium capitalize mb-1">{material}</label>
            <input
              type="number"
              min="0"
              value={cantidades[material] || ""}
              onChange={(e) => handleChange(e, material)}
              className="border px-3 py-1 rounded-md shadow-sm"
              placeholder="Cantidad"
            />
          </div>
        ))}
      </div>

      <button
        onClick={handleGuardar}
        className="bg-[#30518c] text-white font-semibold px-6 py-2 rounded shadow hover:bg-[#26406d] transition"
      >
        ✅ Registrar Materiales
      </button>

      {resumen && (
        <div className="mt-6 p-4 border rounded bg-white shadow text-sm">
          <h2 className="text-lg font-bold text-[#1e3a8a] mb-2">Resumen de Ingreso:</h2>
          <ul className="list-disc ml-6">
            {Object.entries(resumen).map(([mat, cant], i) => (
              <li key={i}>
                <strong>{mat}:</strong>{" "}
                {mat === "bobina" ? `${cant} m (${calcularBobinas(cant)})` : cant}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            🔒 Ingresado por: <strong>{`${userData.nombres} ${userData.apellidos}`}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
