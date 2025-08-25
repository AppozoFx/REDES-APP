"use client";

import { useEffect, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
} from "firebase/firestore";
import dayjs from "dayjs";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";



  


export default function VisualizarAsistencia() {
    const { userData } = useAuth();
    const [fecha, setFecha] = useState(dayjs().format("YYYY-MM-DD"));
    const [asistenciaCuadrillas, setAsistenciaCuadrillas] = useState([]);
    const [asistenciaTecnicos, setAsistenciaTecnicos] = useState([]);
    const [usuarios, setUsuarios] = useState([]);
    const [cuadrillas, setCuadrillas] = useState([]);
    const [filtroGestor, setFiltroGestor] = useState("");
    const [filtroCoordinador, setFiltroCoordinador] = useState("");
    const [filtroCuadrilla, setFiltroCuadrilla] = useState("");
    const [editando, setEditando] = useState({});
    const [zonas, setZonas] = useState([]);
    const [filtroTecnico, setFiltroTecnico] = useState("");


  
    const puedeEditar = userData?.rol?.some((r) =>
      ["TI", "Gerencia", "RRHH", "Almacén"].includes(r)
    );


    const exportarExcel = () => {
        const cuadrillasSheet = asistenciaCuadrillas.map((c) => {
          const cuadrilla = cuadrillas.find((cu) => cu.id === c.cuadrillaId);
          const gestor = usuarios.find((u) => u.id === cuadrilla?.gestor);
          const coordinador = usuarios.find((u) => u.id === cuadrilla?.coordinador);
      
          return {
            Fecha: c.fecha,
            Cuadrilla: c.nombre,
            Tipo: c.tipo,
            Zona: c.zona,
            Estado: c.estado,
            Placa: c.placa,
            Observaciones: c.observaciones || "",
            "Registrado por": usuarios.find((u) => u.id === c.registradoPor)
              ? `${usuarios.find((u) => u.id === c.registradoPor).nombres} ${usuarios.find((u) => u.id === c.registradoPor).apellidos}`
              : c.registradoPor,
            "Modificado por": usuarios.find((u) => u.id === c.modificadoPor)
              ? `${usuarios.find((u) => u.id === c.modificadoPor).nombres} ${usuarios.find((u) => u.id === c.modificadoPor).apellidos}`
              : c.modificadoPor,
            Gestor: gestor ? `${gestor.nombres} ${gestor.apellidos}` : "-",
            Coordinador: coordinador ? `${coordinador.nombres} ${coordinador.apellidos}` : "-",
          };
        });
      
        const tecnicosSheet = asistenciaTecnicos.map((t) => {
          const tecnico = usuarios.find((u) => u.id === t.tecnicoId);
          const cuadrilla = cuadrillas.find((c) => c.id === t.cuadrillaId);
      
          return {
            Fecha: t.fecha,
            Técnico: tecnico ? `${tecnico.nombres} ${tecnico.apellidos}` : t.tecnicoId,
            Cuadrilla: cuadrilla?.nombre || "-",
            Estado: t.estado,
            Observaciones: t.observaciones || "",
            "Registrado por": usuarios.find((u) => u.id === t.registradoPor)
              ? `${usuarios.find((u) => u.id === t.registradoPor).nombres} ${usuarios.find((u) => u.id === t.registradoPor).apellidos}`
              : t.registradoPor,
            "Modificado por": usuarios.find((u) => u.id === t.modificadoPor)
              ? `${usuarios.find((u) => u.id === t.modificadoPor).nombres} ${usuarios.find((u) => u.id === t.modificadoPor).apellidos}`
              : t.modificadoPor,
          };
        });
      
        const workbook = XLSX.utils.book_new();
        const cuadrillasWS = XLSX.utils.json_to_sheet(cuadrillasSheet);
        const tecnicosWS = XLSX.utils.json_to_sheet(tecnicosSheet);
      
        XLSX.utils.book_append_sheet(workbook, cuadrillasWS, "Cuadrillas");
        XLSX.utils.book_append_sheet(workbook, tecnicosWS, "Técnicos");



        const resumenSheet = [
            { Categoría: "Cuadrillas con asistencia", Total: asistenciaCuadrillas.filter(c => c.estado === "asistencia").length },
            { Categoría: "Cuadrillas con falta", Total: asistenciaCuadrillas.filter(c => c.estado === "falta").length },
            { Categoría: "Cuadrillas con otros estados", Total: asistenciaCuadrillas.filter(c => !["asistencia", "falta"].includes(c.estado)).length },
            { Categoría: "Técnicos con asistencia", Total: asistenciaTecnicos.filter(t => t.estado === "asistencia").length },
            { Categoría: "Técnicos con falta", Total: asistenciaTecnicos.filter(t => t.estado === "falta").length },
            { Categoría: "Técnicos con otros estados", Total: asistenciaTecnicos.filter(t => !["asistencia", "falta"].includes(t.estado)).length },
            { Categoría: "Exportado por", Total: `${userData?.nombres || ""} ${userData?.apellidos || ""}` },
            { Categoría: "Fecha de exportación", Total: dayjs().format("YYYY-MM-DD HH:mm") },
          ];
          
          // hoja resumen
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resumenSheet), "Resumen");
          



      
        const nombreArchivo = `asistencia_del_dia_${fecha}.xlsx`;
        XLSX.writeFile(workbook, nombreArchivo);
      };

    const estadoClase = (estado) => {
        switch (estado) {
          case "asistencia": return "bg-green-100 text-green-700";
          case "falta": return "bg-red-100 text-red-700";
          case "descanso": return "bg-yellow-100 text-yellow-700";
          case "descanso medico": return "bg-purple-100 text-purple-700";
          case "vacaciones": return "bg-blue-100 text-blue-700";
          case "suspendida": return "bg-gray-200 text-gray-800";
          case "recuperacion": return "bg-orange-100 text-orange-700";
          case "asistencia compensada": return "bg-indigo-100 text-indigo-700";
          default: return "";
        }
      };

      
      
  
    useEffect(() => {
      const fetchData = async () => {
        const [cuadSnap, userSnap, cuadAsisSnap, tecAsisSnap, zonasSnap] = await Promise.all([
          getDocs(collection(db, "cuadrillas")),
          getDocs(collection(db, "usuarios")),
          getDocs(query(collection(db, "asistencia_cuadrillas"), where("fecha", "==", fecha))),
          getDocs(query(collection(db, "asistencia_tecnicos"), where("fecha", "==", fecha))),
          getDocs(collection(db, "zonas")), // <-- aquí
        ]);
  
        const cuadrillasData = cuadSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const usuariosData = userSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const asistenciaCData = cuadAsisSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const asistenciaTData = tecAsisSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  
        const asistenciaCConDatos = asistenciaCData.map((a) => ({
          ...a,
          gestor: a.gestor || "-",
          coordinador: a.coordinador || "-",
        }));
        

        const zonasData = zonasSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .sort((a, b) => a.zona.localeCompare(b.zona)); // opcional: orden alfabético

setZonas(zonasData);

  
        setCuadrillas(cuadrillasData);
        setUsuarios(usuariosData);
        setAsistenciaCuadrillas(asistenciaCConDatos);
        setAsistenciaTecnicos(asistenciaTData);
      };
      fetchData();
    }, [fecha]);
  
    const gestoresUnicos = [
      ...new Set(asistenciaCuadrillas.map((a) => a.gestor).filter(Boolean))
    ];
    
    
    const coordinadoresUnicos = [
      ...new Set(asistenciaCuadrillas.map((a) => a.coordinador).filter(Boolean))
    ];
    
    
  
    const cuadrillasFiltradas = asistenciaCuadrillas.filter((a) => {
      const coincideGestor = filtroGestor ? a.gestor === filtroGestor : true;
      const coincideCoordinador = filtroCoordinador ? a.coordinador === filtroCoordinador : true;
      const coincideNombre = filtroCuadrilla
        ? a.nombre.toLowerCase().includes(filtroCuadrilla.toLowerCase())
        : true;
      return coincideGestor && coincideCoordinador && coincideNombre;
    });
  
    const cuadrillasMostradas = cuadrillasFiltradas.map((c) => c.cuadrillaId);
    const tecnicosFiltrados = asistenciaTecnicos.filter((t) => {
      const nombreCompleto = (() => {
        const u = usuarios.find((u) => u.id === t.tecnicoId);
        return u ? `${u.nombres} ${u.apellidos}`.toLowerCase() : "";
      })();
    
      const coincideTecnico = filtroTecnico
        ? nombreCompleto.includes(filtroTecnico.toLowerCase())
        : true;
    
      const coincideCuadrilla = filtroCuadrilla
        ? cuadrillasMostradas.includes(t.cuadrillaId)
        : true;
    
      return coincideTecnico && coincideCuadrilla;
    });
    
  
    const handleEditChange = (id, field, value) => {
      setEditando((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: value },
      }));
    };
  
    const guardarCambios = async (c) => {
      const nuevosDatos = editando[c.id];
      if (!nuevosDatos) return;
  
      await updateDoc(doc(db, "asistencia_cuadrillas", c.id), {
        ...nuevosDatos,
        modificadoPor: userData?.uid || "",
      });
  
      setAsistenciaCuadrillas((prev) =>
        prev.map((item) => (item.id === c.id ? { ...item, ...nuevosDatos } : item))
      );
  
      toast.success("✅ Cambios guardados correctamente");
  
      setEditando((prev) => {
        const actualizado = { ...prev };
        delete actualizado[c.id];
        return actualizado;
      });
    };
  
    const guardarCambiosTecnico = async (t) => {
      const idDoc = `${t.tecnicoId}_${t.fecha}`;
      const nuevosDatos = editando[idDoc];
      if (!nuevosDatos) return;
  
      await updateDoc(doc(db, "asistencia_tecnicos", idDoc), {
        ...nuevosDatos,
        modificadoPor: userData?.uid || "",
      });
  
      setAsistenciaTecnicos((prev) =>
        prev.map((item) =>
          `${item.tecnicoId}_${item.fecha}` === idDoc ? { ...item, ...nuevosDatos } : item
        )
      );
  
      toast.success("✅ Cambios guardados en asistencia del técnico");
  
      setEditando((prev) => {
        const actualizado = { ...prev };
        delete actualizado[idDoc];
        return actualizado;
      });
    };
  
    
    return (
      <div className="h-full w-full overflow-auto pr-4">
         <div className="sticky top-0 z-10 bg-white dark:bg-[#0f0f0f] pb-2">
        <h2 className="text-2xl font-bold mb-4 text-[#30518c]">Visualizar Asistencia</h2>
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex flex-col">
            <label className="text-sm font-semibold">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
          <select
            value={filtroGestor}
            onChange={(e) => setFiltroGestor(e.target.value)}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los Gestores</option>
            {gestoresUnicos.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select
            value={filtroCoordinador}
            onChange={(e) => setFiltroCoordinador(e.target.value)}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Todos los Coordinadores</option>
            {coordinadoresUnicos.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar cuadrilla..."
            value={filtroCuadrilla}
            onChange={(e) => setFiltroCuadrilla(e.target.value)}
            className="px-4 py-2 border rounded-md"
          />

<input
  type="text"
  placeholder="Buscar técnico..."
  value={filtroTecnico}
  onChange={(e) => setFiltroTecnico(e.target.value)}
  className="px-4 py-2 border rounded-md"
/>

<button
    onClick={exportarExcel}
    className="bg-[#30518c] text-white px-4 py-2 rounded shadow hover:bg-[#203a66]"
  >
    📤 Exportar Excel
  </button>


        </div>

        </div>

            {/* Cuadro resumen debajo de los filtros */}
<div className="bg-white p-4 rounded shadow border mb-6">
  <h3 className="text-lg font-bold text-[#30518c] mb-2">Resumen del día</h3>

  <div className="grid md:grid-cols-2 gap-4 text-sm">
    {/* Cuadrillas */}
    <div>
      <p className="font-semibold text-[#30518c] mb-1">✅ Cuadrillas con asistencia ({cuadrillasFiltradas.filter(c => c.estado === "asistencia").length}):</p>
      <ul className="list-disc list-inside">
        {cuadrillasFiltradas.filter(c => c.estado === "asistencia").map(c => (
          <li key={c.id}>{c.nombre}</li>
        ))}
      </ul>

      <p className="font-semibold text-[#ff6413] mt-3 mb-1">❌ Cuadrillas con falta ({cuadrillasFiltradas.filter(c => c.estado === "falta").length}):</p>
      <ul className="list-disc list-inside">
        {cuadrillasFiltradas.filter(c => c.estado === "falta").map(c => (
          <li key={c.id}>{c.nombre}</li>
        ))}
      </ul>

      <p className="font-semibold text-gray-600 mt-3 mb-1">
        🟡 Cuadrillas con otros estados ({cuadrillasFiltradas.filter(c => !["asistencia", "falta"].includes(c.estado)).length}):
      </p>
      <ul className="list-disc list-inside">
        {cuadrillasFiltradas
          .filter(c => !["asistencia", "falta"].includes(c.estado))
          .map(c => (
            <li key={c.id}>{c.nombre} - {c.estado}</li>
        ))}
      </ul>
    </div>

    {/* Técnicos */}
    <div>
      <p className="font-semibold text-[#30518c] mb-1">
        ✅ Técnicos con asistencia ({tecnicosFiltrados.filter(t => t.estado === "asistencia").length}):
      </p>
      <ul className="list-disc list-inside">
        {tecnicosFiltrados.filter(t => t.estado === "asistencia").map((t, i) => {
          const user = usuarios.find(u => u.id === t.tecnicoId);
          return <li key={i}>{user ? `${user.nombres} ${user.apellidos}` : t.tecnicoId}</li>;
        })}
      </ul>

      <p className="font-semibold text-[#ff6413] mt-3 mb-1">
        ❌ Técnicos con falta ({tecnicosFiltrados.filter(t => t.estado === "falta").length}):
      </p>
      <ul className="list-disc list-inside">
        {tecnicosFiltrados.filter(t => t.estado === "falta").map((t, i) => {
          const user = usuarios.find(u => u.id === t.tecnicoId);
          return <li key={i}>{user ? `${user.nombres} ${user.apellidos}` : t.tecnicoId}</li>;
        })}
      </ul>

      <p className="font-semibold text-gray-600 mt-3 mb-1">
        🟡 Técnicos con otros estados ({tecnicosFiltrados.filter(t => !["asistencia", "falta"].includes(t.estado)).length}):
      </p>
      <ul className="list-disc list-inside">
        {tecnicosFiltrados
          .filter(t => !["asistencia", "falta"].includes(t.estado))
          .map((t, i) => {
            const user = usuarios.find(u => u.id === t.tecnicoId);
            return <li key={i}>{user ? `${user.nombres} ${user.apellidos}` : t.tecnicoId} - {t.estado}</li>;
          })}
      </ul>
    </div>
  </div>
</div>








  
        <h3 className="text-xl font-bold mt-6 mb-2 text-[#30518c]">Cuadrillas</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#30518c] text-white">
              <th className="p-2">Cuadrilla</th>
              <th className="p-2">Fecha</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">Zona</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Placa</th>
              <th className="p-2">Observaciones</th>
              <th className="p-2">Gestor</th>
              <th className="p-2">Coordinador</th>
              {puedeEditar && <th className="p-2">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {cuadrillasFiltradas.map((c) => {
              const esEditando = !!editando[c.id];
              const valor = editando[c.id] || c;
  
              return (
                <tr key={c.id} className="border-b">
                  <td className="p-2">{c.nombre}</td>
                  <td className="p-2">{c.fecha}</td>
                  <td className="p-2">
  {esEditando ? (
    <select
      value={valor.tipo}
      onChange={(e) => handleEditChange(c.id, "tipo", e.target.value)}
      className="border px-1 py-1"
    >
      <option value="Regular">Regular</option>
      <option value="TOP">TOP</option>
      <option value="Alto Valor">Alto Valor</option>
    </select>
  ) : (
    c.tipo
  )}
</td>

<td className="p-2">
  {esEditando ? (
    <select
      value={valor.zona}
      onChange={(e) => handleEditChange(c.id, "zona", e.target.value)}
      className="border px-2 py-1 w-40 max-w-full"
    >
      {zonas.map((z) => (
        <option key={z.id} value={z.zona}>{z.zona}</option>
      ))}
    </select>
  ) : (
    c.zona
  )}
</td>

                  <td className="p-2">
                    {esEditando ? (
                      <select
                        value={valor.estado}
                        onChange={(e) => handleEditChange(c.id, "estado", e.target.value)}
                        className="border px-1 py-1"
                      >
                        <option value="asistencia">asistencia</option>
                        <option value="falta">falta</option>
                        <option value="suspendida">suspendida</option>
                        <option value="descanso">descanso</option>
                        <option value="descanso medico">descanso médico</option>
                        <option value="vacaciones">vacaciones</option>
                        <option value="recuperacion">recuperación</option>
                        <option value="asistencia compensada">asistencia compensada</option>
                      </select>
                    ) : (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${estadoClase(c.estado)}`}>
                        {c.estado}
                      </span>
                      
                    )}
                  </td>
                  <td className="p-2">
                    {esEditando ? (
                      <input
                        value={valor.placa}
                        onChange={(e) => handleEditChange(c.id, "placa", e.target.value)}
                        className="border px-1 py-1"
                      />
                    ) : (
                        c.placa ? c.placa : <span className="text-gray-400 italic">Sin placa</span>

                    )}
                  </td>
                  <td className="p-2">
                    {esEditando ? (
                      <input
                        value={valor.observaciones}
                        onChange={(e) => handleEditChange(c.id, "observaciones", e.target.value)}
                        className="border px-1 py-1"
                      />
                    ) : (
                        c.observaciones ? c.observaciones : <span className="text-gray-400 italic">Sin observaciones</span>

                    )}
                  </td>
                  <td className="p-2">{c.gestor}</td>
                  <td className="p-2">{c.coordinador}</td>
                  {puedeEditar && (
                    <td className="p-2">
                      {esEditando ? (
                        <button
                          onClick={() => guardarCambios(c)}
                          className="bg-green-500 text-white px-2 py-1 rounded"
                        >
                          Guardar
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setEditando((prev) => ({ ...prev, [c.id]: c }))
                          }
                          className="bg-yellow-500 text-white px-2 py-1 rounded"
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
  
        <h3 className="text-xl font-bold mt-6 mb-2 text-[#30518c]">Técnicos</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#30518c] text-white">
              <th className="p-2">Técnico</th>
              <th className="p-2">Cuadrilla</th>
              <th className="p-2">Fecha</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Observaciones</th>
              {puedeEditar && <th className="p-2">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {tecnicosFiltrados.map((t, i) => {
              const idDoc = `${t.tecnicoId}_${t.fecha}`;
              const esEditando = !!editando[idDoc];
              const valor = editando[idDoc] || t;
  
              return (
                <tr key={i} className="border-b">
                  <td className="p-2">
    {
      (() => {
        const tecnico = usuarios.find((u) => u.id === t.tecnicoId);
        return tecnico ? `${tecnico.nombres} ${tecnico.apellidos}` : t.tecnicoId;
      })()
    }
  </td>
  
                  <td className="p-2">
                    {cuadrillas.find((c) => c.id === t.cuadrillaId)?.nombre || "-"}
                  </td>
                  <td className="p-2">{t.fecha}</td>
                  <td className="p-2">
                    {esEditando ? (
                      <select
                        value={valor.estado}
                        onChange={(e) => handleEditChange(idDoc, "estado", e.target.value)}
                        className="border px-1 py-1"
                      >
                        <option value="asistencia">asistencia</option>
                        <option value="falta">falta</option>
                        <option value="suspendida">suspendida</option>
                        <option value="descanso">descanso</option>
                        <option value="descanso medico">descanso médico</option>
                        <option value="vacaciones">vacaciones</option>
                        <option value="recuperacion">recuperación</option>
                        <option value="asistencia compensada">asistencia compensada</option>
                      </select>
                    ) : (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${estadoClase(t.estado)}`}>
                        {t.estado}
                      </span>
                      
                    )}
                  </td>
                  <td className="p-2">
                    {esEditando ? (
                      <input
                        value={valor.observaciones}
                        onChange={(e) => handleEditChange(idDoc, "observaciones", e.target.value)}
                        className="border px-1 py-1"
                      />
                    ) : (
                        t.observaciones ? t.observaciones : <span className="text-gray-400 italic">Sin observaciones</span>

                    )}
                  </td>
                  {puedeEditar && (
                    <td className="p-2">
                      {esEditando ? (
                        <button
                        onClick={() => guardarCambiosTecnico(t)}
                          className="bg-green-500 text-white px-2 py-1 rounded"
                        >
                          Guardar
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditando((prev) => ({ ...prev, [idDoc]: t }))}
                          className="bg-yellow-500 text-white px-2 py-1 rounded"
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  