import React from 'react';

export default function StockCuadrilla({ titulo, items, tipo }) {
  if (!items || items.length === 0) {
    return (
      <div className="mt-6 bg-white shadow-md rounded-lg p-4">
        <h2 className="text-lg font-bold mb-2">{titulo}</h2>
        <p className="text-sm text-gray-500">Sin registros.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 bg-white shadow-md rounded-lg p-4">
      <h2 className="text-lg font-bold mb-2">{titulo}</h2>
      <ul className="list-disc pl-6 text-sm space-y-1">
      {tipo === 'equipos' ? (
  <div className="overflow-x-auto">
    <table className="min-w-full text-sm border">
      <thead className="bg-gray-100">
        <tr>
          <th className="px-2 py-1 text-left">SN</th>
          <th className="px-2 py-1 text-left">Equipo</th>
          <th className="px-2 py-1 text-left">Fecha de Despacho</th>
        </tr>
      </thead>
      <tbody>
        {items.map(eq => {

           // ✅ Convertir la fecha de Firestore
           const fechaDespacho = eq.f_despacho?.seconds
           ? new Date(eq.f_despacho.seconds * 1000).toLocaleDateString('es-PE')
           : 'Sin fecha';
         

             // ✅ Leer 'equipo' o 'tipo'
             const tipoEquipo = eq.equipo || eq.tipo || 'Sin tipo';

          return (
            <tr key={eq.id} className="border-t">
              <td className="px-2 py-1">{eq.SN}</td>
              <td className="px-2 py-1">{tipoEquipo}</td>
              <td className="px-2 py-1">{fechaDespacho}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
) : (
  <ul className="list-disc pl-6 text-sm space-y-1">
  {items.map(mat => (
    <li key={mat.id}>
      {mat.id === "bobina"
        ? <>bobinas: <strong>{mat.cantidad} m</strong></>
        : <>{mat.nombre?.replaceAll("_", " ") || mat.id}: <strong>{mat.cantidad}</strong></>
      }
    </li>
  ))}
</ul>

)}

      </ul>
    </div>
  );
}
