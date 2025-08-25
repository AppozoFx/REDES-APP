"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { db } from "@/firebaseConfig";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { Input } from "@/app/components/ui/input";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/es";
import toast from "react-hot-toast";
import Select from "react-select";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";



dayjs.extend(customParseFormat);
dayjs.locale("es");

export default function LiquidacionesPage() {
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [ediciones, setEdiciones] = useState({});

  const valorONulo = (valor) => {
  return valor !== undefined && valor !== "" ? valor : null;
};

  



  const [filtros, setFiltros] = useState({
    mes: dayjs().format("YYYY-MM"),
    dia: "", 
    cuadrilla: "",
    tipoCuadrilla: [],
    busqueda: "",
    filtrarPlanGamer: false,
    filtrarKitWifiPro: false,
    filtrarCableadoMesh: false,
    filtrarObservacion: false,
    cat5eFiltro: "",
    residencialCondominio: "",
  });

  const opcionesCuadrilla = useMemo(() => {
    return [...new Set(liquidaciones.map((l) => l.cuadrillaNombre).filter(Boolean))].map(
      (cuadrilla) => ({
        value: cuadrilla,
        label: cuadrilla,
      })
    );
  }, [liquidaciones]);
  

  const handleExportarExcel = () => {
    // 🔹 Primero detectamos cuántos máximos tiene MESH y BOX en todas las filas
    let maxMesh = 0;
    let maxBox = 0;

    liquidacionesFiltradas.forEach((l) => {
        if (l.snMESH) maxMesh = Math.max(maxMesh, l.snMESH.length);
        if (l.snBOX) maxBox = Math.max(maxBox, l.snBOX.length);
    });

    const dataExportar = liquidacionesFiltradas.map((l) => {
  const fecha = convertirAFecha(l.fechaInstalacion);
  const cat5 = parseNumero(l.cat5e);
  const cat6 = parseNumero(l.cat6);
  const puntos = cat5 + cat6;

  const snMESH = l.snMESH || [];
  const snBOX = l.snBOX || [];

  const meshColumns = {};
  for (let i = 0; i < maxMesh; i++) {
    meshColumns[`SN_MESH_${i + 1}`] = valorONulo(snMESH[i]);
  }

  const boxColumns = {};
  for (let i = 0; i < maxBox; i++) {
    boxColumns[`SN_BOX_${i + 1}`] = valorONulo(snBOX[i]);
  }

  return {
    FechaInstalacion: formatearFecha(fecha),
    TipoCuadrilla: valorONulo(l.tipoCuadrilla),
    TipoServicio: valorONulo(l.tipoServicio),
    Cuadrilla: valorONulo(l.cuadrillaNombre),
    CodigoCliente: valorONulo(l.codigoCliente),
    documento: valorONulo(l.documento),
    Cliente: valorONulo(l.cliente),
    Direccion: valorONulo(l.direccion),
    TipoZona: valorONulo(l.residencialCondominio),
    Plan: valorONulo(l.plan),
    SN_ONT: valorONulo(l.snONT),
    prooid: valorONulo(l.proidONT),
    ...meshColumns,
    ...boxColumns,
    SN_FONO: valorONulo(l.snFONO),
    PlanGamer: valorONulo(l.planGamer),
    KitWifiPro: valorONulo(l.kitWifiPro),
    ServicioCableadoMesh: valorONulo(l.servicioCableadoMesh),
    Cat5e: cat5,
    Cat6: cat6,
    PuntosUTP: puntos,
    Observacion: valorONulo(l.observacion),
  };
});


    const ws = XLSX.utils.json_to_sheet(dataExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Liquidaciones");

    const fechaMes = dayjs(filtros.mes).format("MMMM_YYYY").toLowerCase();
    const fechaDia = filtros.dia ? `_${dayjs(filtros.dia).format("DD_MM_YYYY")}` : "";
    const nombreArchivo = `Liquidacion_REDES_${fechaMes}${fechaDia}.xlsx`;

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), nombreArchivo);

    toast.success(`✅ Archivo "${nombreArchivo}" exportado correctamente`);
};

  
  
  
  

  const listaCuadrillas = useMemo(() => {
    return [...new Set(liquidaciones.map((l) => l.cuadrillaNombre).filter(Boolean))];
  }, [liquidaciones]);

  const opcionesTipoCuadrilla = useMemo(() => {
    return [...new Set(liquidaciones.map((l) => l.tipoCuadrilla).filter(Boolean))].map(
      (tipo) => ({
        value: tipo,
        label: tipo,
      })
    );
  }, [liquidaciones]);

  useEffect(() => {
    obtenerLiquidaciones();
  }, [filtros.mes]);

  

  const convertirAFecha = (valor) => {
    if (!valor) return null;
    if (valor.toDate) return valor.toDate();
    const parseada = dayjs(valor, "D [de] MMMM [de] YYYY, h:mm:ss A [UTC-5]", "es", true);
    return parseada.isValid() ? parseada.toDate() : new Date(valor);
  };

  const handleEdicionChange = (id, campo, valor) => {
    setEdiciones((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [campo]: valor,
      },
    }));
  };
  

  const formatearFecha = (fecha) => (fecha ? dayjs(fecha).format("DD/MM/YYYY") : "-");

  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const resaltarPlan = (planTexto) => {
    if (!planTexto) return "-";
    const palabrasClave = [
      { texto: "INTERNETGAMER", color: "bg-green-300", tooltip: "Paquete especial para gamers" },
      { texto: "KIT WIFI PRO (EN VENTA)", color: "bg-blue-300", tooltip: "Incluye Kit Wifi Pro en venta" },
      { texto: "SERVICIO CABLEADO DE MESH", color: "bg-purple-300", tooltip: "Servicio adicional de cableado para MESH" },
    ];
    let resultado = planTexto;
    palabrasClave.forEach(({ texto, color, tooltip }) => {
      const regex = new RegExp(escapeRegExp(texto), "gi");
      const spanHTML = `<span class='px-1 ${color} font-bold rounded cursor-help' title='${tooltip}'>${texto}</span>`;
      resultado = resultado.replace(regex, spanHTML);
    });
    return resultado;
  };
  

  const parseNumero = (valor) => {
    const num = parseInt(valor);
    return isNaN(num) ? 0 : num;
  };

  const obtenerLiquidaciones = async () => {
    setCargando(true);
    try {
      const ref = collection(db, "liquidacion_instalaciones");
      const snapshot = await getDocs(ref);
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setLiquidaciones(data);
    } catch (error) {
      toast.error("Error al obtener las liquidaciones");
    }
    setCargando(false);
  };

  const handleFiltroChange = (e) => {
    const { name, value } = e.target;
    setFiltros((prev) => ({ ...prev, [name]: value }));
  };


  const liquidacionesFiltradas = liquidaciones.filter((l) => {
    const fecha = convertirAFecha(l.fechaInstalacion);
    if (!fecha) return false;
    const fechaFormateada = dayjs(fecha);

    const coincideMes = fechaFormateada.format("YYYY-MM") === filtros.mes;
    const coincideDia = filtros.dia
  ? fechaFormateada.format("YYYY-MM-DD") === filtros.dia
  : true;


  const coincideCuadrilla =
  filtros.cuadrilla.length > 0
    ? filtros.cuadrilla.includes(l.cuadrillaNombre)
    : true;

    const coincideTipoCuadrilla =
      filtros.tipoCuadrilla.length > 0 ? filtros.tipoCuadrilla.includes(l.tipoCuadrilla) : true;
    const coincideBusqueda = filtros.busqueda
      ? l.codigoCliente?.includes(filtros.busqueda) ||
        l.cliente?.toLowerCase().includes(filtros.busqueda.toLowerCase())
      : true;
      const cumplePlanGamer = !filtros.filtrarPlanGamer || l.planGamer !== "";
      const cumpleKitWifiPro = !filtros.filtrarKitWifiPro || l.kitWifiPro !== "";
      const cumpleCableado = !filtros.filtrarCableadoMesh || l.servicioCableadoMesh !== "";      
    const cumpleCat5e =
      filtros.cat5eFiltro !== "" ? parseNumero(l.cat5e) === parseInt(filtros.cat5eFiltro) : true;
      const coincideTipoZona =
      filtros.residencialCondominio.length > 0
        ? filtros.residencialCondominio.includes(l.residencialCondominio?.toUpperCase())
        : true;
    
    const cumpleObservacion =
      !filtros.filtrarObservacion || (l.observacion && l.observacion.trim() !== "");

    return (
      coincideMes &&
      coincideDia &&
      coincideCuadrilla &&
      coincideTipoCuadrilla &&
      coincideBusqueda &&
      coincideTipoZona &&
      cumplePlanGamer &&
      cumpleKitWifiPro &&
      cumpleCableado &&
      cumpleCat5e &&
      cumpleObservacion
    );
  });
  

  // Resumen Totales
  const totalInstalaciones = liquidacionesFiltradas.length;
  const totalONT = liquidacionesFiltradas.filter((l) => l.snONT).length;
  const totalMESH = liquidacionesFiltradas.reduce((acc, l) => acc + (l.snMESH?.length || 0), 0);
  const totalBOX = liquidacionesFiltradas.reduce((acc, l) => acc + (l.snBOX?.length || 0), 0);
  const totalFONO = liquidacionesFiltradas.filter((l) => l.snFONO).length;
  const totalGamer = liquidacionesFiltradas.filter((l) => l.planGamer).length;
  const totalWifiPro = liquidacionesFiltradas.filter((l) => l.kitWifiPro).length;
  const totalCableado = liquidacionesFiltradas.filter((l) => l.servicioCableadoMesh).length;
  const totalCat5e = liquidacionesFiltradas.reduce((acc, l) => acc + parseNumero(l.cat5e), 0);
  const totalCat6 = liquidacionesFiltradas.reduce((acc, l) => acc + parseNumero(l.cat6), 0);
  const totalUTP = totalCat5e + totalCat6;


  return (
    <div className="p-4">

      {/* Título */}
      <h1 className="text-2xl font-bold mb-4">Liquidación de Instalaciones</h1>

      {/* Filtros principales */}
<div className="flex flex-wrap gap-4 mb-4 items-end">
  {/* Mes */}
  <div className="flex flex-col">
        <label className="text-sm font-medium text-gray-700">Mes</label>
        <Input
          type="month"
          name="mes"
          value={filtros.mes}
          onChange={handleFiltroChange}
        />
      </div>

         {/* Selector único de Día (simple) */}
      <div className="flex flex-col">
        <label className="text-sm font-medium text-gray-700">Día</label>
        <Input
          type="date"
          name="dia"
          value={filtros.dia}
          onChange={handleFiltroChange}
        />
      </div>






   {/* Selector múltiple de Tipo de Cuadrilla */}
   <div className="flex flex-col min-w-[220px]">
        <label className="text-sm font-medium text-gray-700 mb-1">Tipo de Cuadrilla</label>
        <Select
          isMulti
          name="tipoCuadrilla"
          options={opcionesTipoCuadrilla}
          className="text-sm"
          placeholder="Seleccionar..."
          value={opcionesTipoCuadrilla.filter((opt) =>
            filtros.tipoCuadrilla.includes(opt.value)
          )}
          onChange={(selected) =>
            setFiltros((prev) => ({
              ...prev,
              tipoCuadrilla: selected.map((s) => s.value),
            }))
          }
        />
      </div>

  {/* Selector múltiple de Tipo Zona */}
<div className="flex flex-col min-w-[220px]">
  <label className="text-sm font-medium text-gray-700 mb-1">Tipo Zona</label>
  <Select
    isMulti
    name="residencialCondominio"
    options={[
      { value: "RESIDENCIAL", label: "Residencial" },
      { value: "CONDOMINIO", label: "Condominio" }
    ]}
    className="text-sm"
    placeholder="Seleccionar..."
    value={[
      { value: "RESIDENCIAL", label: "Residencial" },
      { value: "CONDOMINIO", label: "Condominio" }
    ].filter((opt) => filtros.residencialCondominio.includes(opt.value))}
    onChange={(selected) =>
      setFiltros((prev) => ({
        ...prev,
        residencialCondominio: selected.map((s) => s.value),
      }))
    }
  />
</div>


  {/* Selector múltiple de Cuadrilla */}
<div className="flex flex-col min-w-[220px]">
  <label className="text-sm font-medium text-gray-700 mb-1">Cuadrilla</label>
  <Select
    isMulti
    name="cuadrilla"
    options={opcionesCuadrilla}
    className="text-sm"
    placeholder="Seleccionar..."
    value={opcionesCuadrilla.filter((opt) =>
      filtros.cuadrilla.includes(opt.value)
    )}
    onChange={(selected) =>
      setFiltros((prev) => ({
        ...prev,
        cuadrilla: selected.map((s) => s.value),
      }))
    }
  />
</div>


  {/* Cliente / Código */}
  <div className="flex flex-col">
    <label className="text-sm font-medium text-gray-700">Código o Cliente</label>
    <Input
      type="text"
      name="busqueda"
      placeholder="Buscar código o cliente"
      value={filtros.busqueda}
      onChange={handleFiltroChange}
    />
  </div>
</div>

{/* Filtros avanzados */}
<div className="flex flex-wrap gap-4 items-end mb-4">
  {/* Plan Gamer */}
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="planGamer"
      checked={filtros.filtrarPlanGamer}
      onChange={(e) => setFiltros((prev) => ({ ...prev, filtrarPlanGamer: e.target.checked }))}
    />
    <label htmlFor="planGamer" className="text-sm">🎮 Plan Gamer</label>
  </div>

  {/* Kit Wifi Pro */}
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="kitWifiPro"
      checked={filtros.filtrarKitWifiPro}
      onChange={(e) => setFiltros((prev) => ({ ...prev, filtrarKitWifiPro: e.target.checked }))}
    />
    <label htmlFor="kitWifiPro" className="text-sm">📦 Kit Wifi Pro</label>
  </div>

  {/* Cableado */}
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="cableadoMesh"
      checked={filtros.filtrarCableadoMesh}
      onChange={(e) => setFiltros((prev) => ({ ...prev, filtrarCableadoMesh: e.target.checked }))}
    />
    <label htmlFor="cableadoMesh" className="text-sm">🧵 Cableado Mesh</label>
  </div>

  {/* Cat5e */}
  <div className="flex flex-col">
    <label htmlFor="cat5eFiltro" className="text-sm font-medium text-gray-700">📶 Cat5e</label>
    <select
      id="cat5eFiltro"
      name="cat5eFiltro"
      value={filtros.cat5eFiltro}
      onChange={(e) => setFiltros((prev) => ({ ...prev, cat5eFiltro: e.target.value }))}
      className="border px-2 py-1 rounded text-sm"
    >
      <option value="">Todos</option>
      <option value="0">0</option>
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4">4</option>
      <option value="5">5</option>
    </select>
  </div>

  {/* Observación */}
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="observacion"
      checked={filtros.filtrarObservacion}
      onChange={(e) => setFiltros((prev) => ({ ...prev, filtrarObservacion: e.target.checked }))}
    />
    <label htmlFor="observacion" className="text-sm">📝 Observación</label>
  </div>
</div>

<div className="flex justify-star mb-4">
  <button
    onClick={handleExportarExcel}
    className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded shadow"
  >
    📤 Exportar a Excel
  </button>
</div>



      

      {/* Resumen */}
      <div className="text-sm bg-blue-50 p-3 rounded shadow-sm flex flex-wrap gap-4 justify-between border border-blue-200 mb-4 font-medium text-blue-800">
        <p>📌 {totalInstalaciones} instalaciones</p>
        <p>🔌 ONT: {totalONT} | MESH: {totalMESH} | BOX: {totalBOX} | FONO: {totalFONO}</p>
        <p>🎮 Gamer: {totalGamer} | 📦 Wifi Pro: {totalWifiPro} | 🧵 Cableado: {totalCableado}</p>
        <p>📶 Cat5e: {totalCat5e} | Cat6: {totalCat6} | Puntos UTP: {totalUTP}</p>
      </div>

      

      {/* Tabla */}
      {cargando ? (
        <p className="text-center text-gray-600">Cargando...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-200 text-center text-gray-700 font-bold">
                {[
                  "Fecha Instalación", "Tipo Cuadrilla", "Cuadrilla","Código", "Cliente",
                  "R/C", "Plan", "SN ONT", "SN MESH", "SN BOX", "SN FONO",
                  "Plan Gamer", "Kit Wifi Pro", "Servicio Cableado Mesh", "Cat5e", "Cat6", "Puntos UTP", "Observación", "Accion"
                ].map((col, idx) => (
                  <th key={idx} className="p-2 border">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liquidacionesFiltradas.map((l) => {
                const fecha = convertirAFecha(l.fechaInstalacion);
                const cat5 = parseNumero(l.cat5e);
                const cat6 = parseNumero(l.cat6);
                const puntos = cat5 + cat6;

                return (
                  <tr key={l.id} className="hover:bg-gray-100 text-center">
                    <td className="border p-1">{formatearFecha(fecha)}</td>
                    <td className="border p-1">
  <select
    value={ediciones[l.id]?.tipoCuadrilla ?? l.tipoCuadrilla ?? ""}
    className="border rounded px-1 py-0.5 text-sm"
    onChange={(e) => handleEdicionChange(l.id, "tipoCuadrilla", e.target.value)}
  >
    <option value="">-- Seleccionar --</option>
    {opcionesTipoCuadrilla.map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
</td>

                    <td className="border p-1">{l.cuadrillaNombre || "-"}</td>
                    <td className="border p-1">{l.codigoCliente || "-"}</td>
                    <td className="border p-1">{l.cliente || "-"}</td>
                    <td className="border p-1">
  <select
    value={ediciones[l.id]?.residencialCondominio ?? l.residencialCondominio ?? ""}
    className="border rounded px-1 py-0.5 text-sm"
    onChange={(e) => handleEdicionChange(l.id, "residencialCondominio", e.target.value)}
  >
    <option value="">-- Seleccionar --</option>
    <option value="RESIDENCIAL">RESIDENCIAL</option>
    <option value="CONDOMINIO">CONDOMINIO</option>
  </select>
</td>


                    <td className="border p-1" dangerouslySetInnerHTML={{ __html: resaltarPlan(l.plan) }} />
                    <td className="border p-1">{l.snONT || "-"}</td>
                    <td className="border p-1">{l.snMESH?.length > 0 ? l.snMESH.join(", ") : "-"}</td>
                    <td className="border p-1">{l.snBOX?.length > 0 ? l.snBOX.join(", ") : "-"}</td>
                    <td className="border p-1">{l.snFONO || "-"}</td>
                    <td className="border p-1">{l.planGamer || "-"}</td>
                    <td className="border p-1">
  <input
    type="checkbox"
    checked={(ediciones[l.id]?.kitWifiPro ?? l.kitWifiPro ?? "") !== ""}
    onChange={(e) =>
      handleEdicionChange(
        l.id,
        "kitWifiPro",
        e.target.checked ? "KIT WIFI PRO (AL CONTADO)" : ""
      )
    }
    />
    
</td>
<td className="border p-1">
  <input
    type="checkbox"
    checked={(ediciones[l.id]?.servicioCableadoMesh ?? l.servicioCableadoMesh ?? "") !== ""}
    onChange={(e) =>
      handleEdicionChange(
        l.id,
        "servicioCableadoMesh",
        e.target.checked ? "SERVICIO CABLEADO DE MESH" : ""
      )
    }
    />
    
</td>
<td className="border p-1">
  <input
    type="number"
    value={ediciones[l.id]?.cat5e ?? l.cat5e ?? 0}
    className="w-20 text-center border rounded"
    onChange={(e) => handleEdicionChange(l.id, "cat5e", e.target.value)}
  />
</td>
                    <td className="border p-1">{cat6}</td>
                    <td className="border p-1">{puntos}</td>
                    <td className="border p-1">
  <input
    type="text"
    value={ediciones[l.id]?.observacion ?? l.observacion ?? ""}
    className="w-full px-1 border rounded"
    onChange={(e) => handleEdicionChange(l.id, "observacion", e.target.value)}
  />
</td>
<td className="border p-1">
  <button
    className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs"
    onClick={async () => {
      const cambios = ediciones[l.id];
      if (!cambios) {
        toast.error("No hay cambios para guardar");
        return;
      }

      try {
        // 🔴 Guardar cambios en Firestore
        await updateDoc(doc(db, "liquidacion_instalaciones", l.id), cambios);

        toast.success("Cambios guardados exitosamente");

        // 🔄 Refrescar lista desde Firestore
        obtenerLiquidaciones();

        // 🧹 Limpiar los cambios locales de edición para esa fila
        setEdiciones((prev) => {
          const copia = { ...prev };
          delete copia[l.id];
          return copia;
        });
      } catch (error) {
        console.error("Error al guardar cambios:", error);
        toast.error("Error al guardar cambios");
      }
    }}
  >
    Guardar
  </button>
</td>

                  </tr>
                );
              })}
            </tbody>
          </table>
          {liquidacionesFiltradas.length === 0 && (
            <p className="text-center mt-4">No hay registros para los filtros seleccionados.</p>
          )}
        </div>
      )}
    </div>
  );
}
