"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/firebaseConfig"; 
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  getDocs, 
  query,   
  orderBy  
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext"; 
import toast from "react-hot-toast";

const UNIDADES_DE_MEDIDA_PREDEFINIDAS = ["UND", "METROS", "CAJA", "ROLLO", "PAR", "KIT"];

export default function IngresoMaterialesVentaPage() {
  const { userData } = useAuth();
  
  const [codigoMaterial, setCodigoMaterial] = useState("");
  const [materialExistente, setMaterialExistente] = useState(null);
  const [buscando, setBuscando] = useState(false);

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  
  const [precioPorUnidadBase, setPrecioPorUnidadBase] = useState(0);
  const [precioPorUnidadAlternativa, setPrecioPorUnidadAlternativa] = useState(0);

  const [unidadMedidaBase, setUnidadMedidaBase] = useState("UND");
  const [stockMinimo, setStockMinimo] = useState(10); 
  const [cantidadIngresar, setCantidadIngresar] = useState(0); 
  
  const [usarUnidadAlternativaParaIngreso, setUsarUnidadAlternativaParaIngreso] = useState(false);
  const [nombreUnidadAlternativa, setNombreUnidadAlternativa] = useState("Caja");
  const [factorConversionUnidadAlternativa, setFactorConversionUnidadAlternativa] = useState(1);
  const [cantidadUnidadesAlternativas, setCantidadUnidadesAlternativas] = useState(0);

  const [guardando, setGuardando] = useState(false);
  const [listaStockMateriales, setListaStockMateriales] = useState([]);
  const [cargandoStock, setCargandoStock] = useState(true);

  const coleccionMateriales = collection(db, "material_venta_stock");

  const cargarStockMateriales = useCallback(async () => {
    setCargandoStock(true);
    try {
      const q = query(coleccionMateriales, orderBy("nombre")); 
      const snapshot = await getDocs(q);
      const stock = snapshot.docs.map(doc => ({
        id: doc.id, 
        ...doc.data()
      }));
      setListaStockMateriales(stock);
    } catch (error) {
      console.error("Error cargando stock de materiales:", error);
      toast.error("No se pudo cargar el stock de materiales.");
    } finally {
      setCargandoStock(false);
    }
  }, []); 

  useEffect(() => {
    cargarStockMateriales();
  }, [cargarStockMateriales]);

  const limpiarFormularioNuevo = (mantenerCodigo = false) => {
    if (!mantenerCodigo) setCodigoMaterial("");
    setNombre("");
    setDescripcion("");
    setPrecioPorUnidadBase(0); 
    setPrecioPorUnidadAlternativa(0); 
    setUnidadMedidaBase("UND");
    setStockMinimo(10); 
    setUsarUnidadAlternativaParaIngreso(false);
    setNombreUnidadAlternativa("Caja");
    setFactorConversionUnidadAlternativa(unidadMedidaBase === "METROS" ? 305 : 1); 
    setCantidadUnidadesAlternativas(0);
    setCantidadIngresar(0);
    if (!mantenerCodigo) setMaterialExistente(null);
  };

  const limpiarTodo = () => {
    limpiarFormularioNuevo(false); 
    toast("Formulario limpiado.");
  };

  useEffect(() => {
    if (usarUnidadAlternativaParaIngreso && 
        unidadMedidaBase === "METROS" && 
        Number(factorConversionUnidadAlternativa) > 0 && 
        Number(precioPorUnidadAlternativa) > 0) {
      setPrecioPorUnidadBase(parseFloat((Number(precioPorUnidadAlternativa) / Number(factorConversionUnidadAlternativa)).toFixed(4)));
    } else if (!usarUnidadAlternativaParaIngreso && !materialExistente) {
      // Si no se usa unidad alternativa y es nuevo material, permitir entrada directa de precio base
      // No resetear precioPorUnidadBase aquí si el usuario ya lo estaba escribiendo.
    }
  }, [precioPorUnidadAlternativa, factorConversionUnidadAlternativa, usarUnidadAlternativaParaIngreso, unidadMedidaBase, materialExistente]);
  

  useEffect(() => {
    if (usarUnidadAlternativaParaIngreso) {
      const factor = Number(factorConversionUnidadAlternativa);
      const cantidadAlt = Number(cantidadUnidadesAlternativas);
      if (factor > 0 && cantidadAlt >= 0) { 
        setCantidadIngresar(cantidadAlt * factor);
      } else {
        setCantidadIngresar(0); 
      }
    }
  }, [cantidadUnidadesAlternativas, factorConversionUnidadAlternativa, usarUnidadAlternativaParaIngreso]);

  useEffect(() => {
    if (!usarUnidadAlternativaParaIngreso && !materialExistente) {
      setNombreUnidadAlternativa("Caja");
      setFactorConversionUnidadAlternativa(unidadMedidaBase === "METROS" ? 305 : 1); 
      setCantidadUnidadesAlternativas(0);
    }
  }, [usarUnidadAlternativaParaIngreso, materialExistente, unidadMedidaBase]);

  const handleBuscarCodigo = async () => {
    if (!codigoMaterial.trim()) { 
        toast.error("Por favor, ingresa un código de material.");
        setMaterialExistente(null);
        limpiarFormularioNuevo(true); // Mantener código, limpiar resto.
        return; 
    }
    setBuscando(true);
    const codigoFinal = codigoMaterial.trim().toUpperCase();
    const docRef = doc(coleccionMateriales, codigoFinal);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      setMaterialExistente(data);
      setNombre(data.nombre);
      setDescripcion(data.descripcion);
      setPrecioPorUnidadBase(data.precioPorUnidadBase || 0); 
      setPrecioPorUnidadAlternativa(data.precioPorUnidadAlternativa || 0); 
      setUnidadMedidaBase(data.unidadMedidaBase || "UND");
      setStockMinimo(data.stockMinimo || 10); 
      
      if (data.sePuedeIngresarPorUnidadAlternativa) {
        setNombreUnidadAlternativa(data.nombreUnidadAlternativa || "Caja");
        setFactorConversionUnidadAlternativa(data.factorConversionUnidadAlternativa || 1);
      }
      setUsarUnidadAlternativaParaIngreso(false); 
      setCantidadUnidadesAlternativas(0); 
      setCantidadIngresar(0);
      toast.success(`Material "${data.nombre}" encontrado.`);
    } else {
      setMaterialExistente(null);
      const codigoActual = codigoMaterial; // Guardar código ingresado
      limpiarFormularioNuevo(true); // Limpiar detalles, mantener código
      setCodigoMaterial(codigoActual); // Restaurar código
      // No limpiar nombre, desc, precio base si el usuario ya los estaba llenando para un nuevo material
      // setNombre(""); setDescripcion(""); setPrecioPorUnidadBase(0); 
      setStockMinimo(10); // Sí resetear stock mínimo a default para nuevo
      setUsarUnidadAlternativaParaIngreso(false); // Resetear opción de unidad alternativa
      setCantidadIngresar(0);
      setCantidadUnidadesAlternativas(0);
      toast("Código no encontrado. Puedes registrarlo como un nuevo material."); 
    }
    setBuscando(false);
  };
  
  const handleGuardar = async () => {
    if (!userData) { toast.error("Debes iniciar sesión."); return; }
    const codigoTrimmed = codigoMaterial.trim();
    if (!codigoTrimmed) { toast.error("El código del material es obligatorio."); return; }
    if (!materialExistente && !nombre.trim()) { toast.error("El nombre es obligatorio para nuevos materiales."); return; }
    
    let cantidadFinalAAgregarAlStock = 0;
    if (usarUnidadAlternativaParaIngreso) {
        if (Number(cantidadUnidadesAlternativas) <= 0 || Number(factorConversionUnidadAlternativa) <= 0) {
            toast.error("La cantidad de unidades alternativas y el factor de conversión deben ser mayores a cero.");
            return;
        }
        cantidadFinalAAgregarAlStock = Number(cantidadUnidadesAlternativas) * Number(factorConversionUnidadAlternativa);
    } else {
        cantidadFinalAAgregarAlStock = Number(cantidadIngresar);
    }

    if (cantidadFinalAAgregarAlStock <= 0 && !materialExistente) { 
      toast.error("La cantidad final a ingresar para un nuevo material debe ser mayor que cero.");
      return; 
    }
    
    let finalPrecioPorUnidadBase = Number(precioPorUnidadBase);
    if (!materialExistente && usarUnidadAlternativaParaIngreso && unidadMedidaBase === "METROS" && Number(factorConversionUnidadAlternativa) > 0 && Number(precioPorUnidadAlternativa) > 0) {
        finalPrecioPorUnidadBase = parseFloat((Number(precioPorUnidadAlternativa) / Number(factorConversionUnidadAlternativa)).toFixed(4));
    }

    if (Number(finalPrecioPorUnidadBase) <= 0 && !usarUnidadAlternativaParaIngreso) {
        toast.error("El precio por unidad base debe ser mayor a cero.");
        return;
    }
    if (usarUnidadAlternativaParaIngreso && unidadMedidaBase === "METROS" && Number(precioPorUnidadAlternativa) <= 0) {
        toast.error("El precio por unidad alternativa (ej. Caja) debe ser mayor a cero si se usa esta opción.");
        return;
    }
    
    // Condición para evitar guardado innecesario si es existente y nada cambió significativamente
    if (materialExistente && cantidadFinalAAgregarAlStock <=0 && 
        Number(stockMinimo) === (materialExistente.stockMinimo || 10) && 
        nombre.trim() === materialExistente.nombre &&
        descripcion.trim() === materialExistente.descripcion &&
        Number(precioPorUnidadBase) === (materialExistente.precioPorUnidadBase || 0) && 
        Number(precioPorUnidadAlternativa) === (materialExistente.precioPorUnidadAlternativa || 0) &&
        unidadMedidaBase === materialExistente.unidadMedidaBase
    ) {
        toast.info("No hay cambios para guardar en el material existente.");
        return;
    }


    setGuardando(true);
    const codigoFinal = codigoTrimmed.toUpperCase();
    const docRef = doc(coleccionMateriales, codigoFinal);
    const usuarioActual = `${userData.nombres || ""} ${userData.apellidos || ""}`.trim() || userData.email;

    try {
      const datosMaterial = {
        nombre: nombre.trim(),
        descripcion: descripcion.trim(),
        precioPorUnidadBase: finalPrecioPorUnidadBase,
        precioPorUnidadAlternativa: (unidadMedidaBase === "METROS" && usarUnidadAlternativaParaIngreso) ? Number(precioPorUnidadAlternativa) : (materialExistente ? materialExistente.precioPorUnidadAlternativa : null),
        unidadMedidaBase: unidadMedidaBase,
        stockMinimo: Number(stockMinimo),
        sePuedeIngresarPorUnidadAlternativa: (unidadMedidaBase === "METROS" && usarUnidadAlternativaParaIngreso) || (materialExistente && materialExistente.sePuedeIngresarPorUnidadAlternativa && unidadMedidaBase === "METROS"),
        nombreUnidadAlternativa: (unidadMedidaBase === "METROS" && usarUnidadAlternativaParaIngreso) ? nombreUnidadAlternativa : (materialExistente && materialExistente.nombreUnidadAlternativa && unidadMedidaBase === "METROS" ? materialExistente.nombreUnidadAlternativa : null),
        factorConversionUnidadAlternativa: (unidadMedidaBase === "METROS" && usarUnidadAlternativaParaIngreso) ? Number(factorConversionUnidadAlternativa) : (materialExistente && materialExistente.factorConversionUnidadAlternativa && unidadMedidaBase === "METROS" ? materialExistente.factorConversionUnidadAlternativa : null),
        lastUpdatedAt: serverTimestamp(),
        lastUpdatedBy: usuarioActual,
      };

      if (materialExistente) {
        await updateDoc(docRef, {
          ...datosMaterial,
          cantidad: cantidadFinalAAgregarAlStock > 0 ? increment(cantidadFinalAAgregarAlStock) : materialExistente.cantidad,
        });
        toast.success(`Material "${materialExistente.nombre}" actualizado.`);
      } else {
        await setDoc(docRef, {
          ...datosMaterial,
          codigoInterno: codigoFinal,
          cantidad: cantidadFinalAAgregarAlStock,
          createdAt: serverTimestamp(),
        });
        toast.success(`Material "${nombre.trim()}" registrado.`);
      }
      limpiarTodo();
      cargarStockMateriales(); 
    } catch (error) { 
      console.error("Error guardando material:", error);
      toast.error("Error al guardar el material.");
    } 
    finally { setGuardando(false); }
  };

  const mostrarCamposUnidadAlternativaIU = 
    (!materialExistente && unidadMedidaBase === "METROS") || 
    (materialExistente && materialExistente.sePuedeIngresarPorUnidadAlternativa && materialExistente.unidadMedidaBase === "METROS");

  const esBotonGuardarDeshabilitado = () => {
    if (guardando) return true;
    if (!codigoMaterial.trim()) return true;
    if (!materialExistente && !nombre.trim()) return true;

    let cantidadCalculadaFinal = 0;
    if (usarUnidadAlternativaParaIngreso) {
        cantidadCalculadaFinal = Number(cantidadUnidadesAlternativas) * Number(factorConversionUnidadAlternativa);
        if (Number(cantidadUnidadesAlternativas) <= 0 || Number(factorConversionUnidadAlternativa) <= 0) return true;
    } else {
        cantidadCalculadaFinal = Number(cantidadIngresar);
    }
    
    if (!materialExistente && cantidadCalculadaFinal <= 0) return true;
    
    // Para material existente, permitir guardar si solo se cambian detalles (stockMinimo, precios)
    // aunque la cantidad a agregar sea 0.
    if (materialExistente && cantidadCalculadaFinal <= 0) {
        // Verificar si algún otro detalle ha cambiado
        if (nombre.trim() !== materialExistente.nombre ||
            descripcion.trim() !== materialExistente.descripcion ||
            Number(precioPorUnidadBase) !== (materialExistente.precioPorUnidadBase || 0) ||
            Number(precioPorUnidadAlternativa) !== (materialExistente.precioPorUnidadAlternativa || 0) ||
            unidadMedidaBase !== materialExistente.unidadMedidaBase ||
            Number(stockMinimo) !== (materialExistente.stockMinimo || 10) ||
            (mostrarCamposUnidadAlternativaIU && usarUnidadAlternativaParaIngreso && 
             (nombreUnidadAlternativa !== materialExistente.nombreUnidadAlternativa || 
              Number(factorConversionUnidadAlternativa) !== materialExistente.factorConversionUnidadAlternativa))
            ) {
            return false; // Hay cambios en detalles, habilitar
        }
        return true; // No hay cantidad a agregar Y no hay cambios en detalles, deshabilitar
    }
    return false; 
  };
  
  return (
    <div className="p-4 md:p-6 space-y-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-xl border border-gray-200 p-6">
        <h1 className="text-3xl font-bold text-center text-[#2c5282] mb-8">
          Ingreso de Materiales
        </h1>

        <div className="mb-6">
          <label htmlFor="codigoMaterial" className="block text-sm font-semibold text-gray-700 mb-1">
            Código del Material (ID Único) <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text" 
              id="codigoMaterial" 
              list="materiales-datalist"
              value={codigoMaterial}
              onChange={(e) => setCodigoMaterial(e.target.value.toUpperCase())}
              onBlur={handleBuscarCodigo} 
              placeholder="Escribe o selecciona un código"
              className="flex-grow border border-gray-300 rounded-md px-4 py-2 shadow-sm focus:ring-2 focus:ring-[#30518c] focus:border-[#30518c]"
            />
            <datalist id="materiales-datalist">
              {listaStockMateriales.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.nombre} ({material.id})
                </option>
              ))}
            </datalist>
            <button 
              onClick={handleBuscarCodigo} 
              disabled={buscando || !codigoMaterial.trim()}
              className="bg-[#30518c] hover:bg-[#243b55] text-white px-5 py-2 rounded-md shadow-md disabled:opacity-60 transition-colors duration-150"
            >
              {buscando ? "Buscando..." : "Verificar"}
            </button>
          </div>
        </div>

        {materialExistente && (
          <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-500 rounded-md shadow">
            <h3 className="font-semibold text-green-800 text-md mb-1">Material Encontrado:</h3>
            <p className="text-sm text-gray-700"><strong>Nombre:</strong> {materialExistente.nombre}</p>
            <p className="text-sm text-gray-700"><strong>Stock Actual:</strong> {materialExistente.cantidad || 0} {materialExistente.unidadMedidaBase}</p>
            <p className="text-sm text-gray-700"><strong>Stock Mínimo:</strong> {materialExistente.stockMinimo || "N/A"}</p>
            <p className="text-sm text-gray-700"><strong>Precio Base:</strong> S/ {Number(materialExistente.precioPorUnidadBase || 0).toFixed(2)} / {materialExistente.unidadMedidaBase}</p>
            {materialExistente.sePuedeIngresarPorUnidadAlternativa && materialExistente.precioPorUnidadAlternativa > 0 && (
                 <p className="text-sm text-gray-700"><strong>Precio ({materialExistente.nombreUnidadAlternativa}):</strong> S/ {Number(materialExistente.precioPorUnidadAlternativa).toFixed(2)}</p>
            )}
          </div>
        )}

        <div className="space-y-4 mb-6 p-4 border border-gray-200 rounded-md shadow-sm">
          <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-4">
            {materialExistente ? "Detalles del Material (Editable)" : "Detalles del Nuevo Material"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <label htmlFor="nombre" className="block text-sm font-medium text-gray-600">Nombre del Material <span className="text-red-500">*</span></label>
              <input type="text" id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                     className={`mt-1 w-full border rounded-md px-3 py-2 shadow-sm border-gray-300 focus:ring-1 focus:ring-[#30518c]`}
                     required={!materialExistente}
              />
            </div>
             <div>
              <label htmlFor="precioPorUnidadBase" className="block text-sm font-medium text-gray-600">
                  Precio por {unidadMedidaBase} (S/) <span className="text-red-500">*</span>
              </label>
              <input 
                  type="number" id="precioPorUnidadBase" value={precioPorUnidadBase} 
                  onChange={(e) => setPrecioPorUnidadBase(parseFloat(e.target.value) || 0)}
                  min="0" step="0.01" 
                  className={`mt-1 w-full border rounded-md px-3 py-2 shadow-sm ${(usarUnidadAlternativaParaIngreso && unidadMedidaBase === "METROS") ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-300 focus:ring-1 focus:ring-[#30518c]'}`}
                  disabled={(usarUnidadAlternativaParaIngreso && unidadMedidaBase === "METROS")}
                  required={!usarUnidadAlternativaParaIngreso || unidadMedidaBase !== "METROS"}
              />
              {usarUnidadAlternativaParaIngreso && unidadMedidaBase === "METROS" && <p className="text-xs text-blue-600 mt-1">Calculado desde el precio de la unidad alternativa.</p>}
            </div>
            <div className="md:col-span-2">
              <label htmlFor="descripcion" className="block text-sm font-medium text-gray-600">Descripción</label>
              <textarea id="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                        rows="2" className={`mt-1 w-full border rounded-md px-3 py-2 shadow-sm border-gray-300 focus:ring-1 focus:ring-[#30518c]`}></textarea>
            </div>
            <div>
              <label htmlFor="unidadMedidaBase" className="block text-sm font-medium text-gray-600">Unidad de Medida (Stock) <span className="text-red-500">*</span></label>
              <select id="unidadMedidaBase" value={unidadMedidaBase}
                      onChange={(e) => setUnidadMedidaBase(e.target.value)}
                      className={`mt-1 w-full border rounded-md px-3 py-2 shadow-sm ${materialExistente ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-300 focus:ring-1 focus:ring-[#30518c]'}`}
                      disabled={!!materialExistente}>
                {UNIDADES_DE_MEDIDA_PREDEFINIDAS.map(unidad => <option key={unidad} value={unidad}>{unidad}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="stockMinimo" className="block text-sm font-medium text-gray-600">Stock Mínimo (Alerta)</label>
              <input 
                type="number" id="stockMinimo" value={stockMinimo} 
                onChange={(e) => setStockMinimo(parseInt(e.target.value) || 0)}
                min="0" 
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 shadow-sm focus:ring-1 focus:ring-[#30518c]"
              />
            </div>
          </div>
        </div>
        
        {mostrarCamposUnidadAlternativaIU && (
          <div className="mb-6 p-4 border border-blue-200 rounded-md bg-blue-50 shadow-sm">
             <label className="flex items-center mb-3 cursor-pointer">
                <input type="checkbox" checked={usarUnidadAlternativaParaIngreso}
                       onChange={(e) => {
                           setUsarUnidadAlternativaParaIngreso(e.target.checked);
                           if (!e.target.checked) { 
                               setCantidadIngresar(0);
                               if(!materialExistente) setPrecioPorUnidadBase(0); // Resetear precio base si es nuevo y se desmarca
                           } else { 
                               setCantidadUnidadesAlternativas(0);
                               if(!materialExistente) setPrecioPorUnidadAlternativa(0); // Resetear precio alt si es nuevo y se marca
                           }
                       }}
                       className="mr-2 h-4 w-4 text-[#30518c] border-gray-300 rounded focus:ring-[#30518c]"/>
                <span className="text-sm font-medium text-gray-700">Ingresar usando unidad alternativa (ej. Cajas, Rollos)</span>
              </label>

            {usarUnidadAlternativaParaIngreso && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2"> {/* Ajustado a 2 columnas para el precio alternativo */}
                <div>
                  <label htmlFor="nombreUnidadAlternativa" className="block text-xs font-medium text-gray-600">Nombre Unidad Alt. <span className="text-red-500">*</span></label>
                  <input type="text" id="nombreUnidadAlternativa" value={nombreUnidadAlternativa}
                         onChange={(e) => setNombreUnidadAlternativa(e.target.value)} placeholder="Ej: Caja"
                         required={usarUnidadAlternativaParaIngreso}
                         className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-[#30518c]"/>
                </div>
                <div>
                  <label htmlFor="factorConversionUnidadAlternativa" className="block text-xs font-medium text-gray-600">
                    {unidadMedidaBase} por Unidad Alt. <span className="text-red-500">*</span>
                  </label>
                  <input type="number" id="factorConversionUnidadAlternativa" value={factorConversionUnidadAlternativa}
                         onChange={(e) => setFactorConversionUnidadAlternativa(parseFloat(e.target.value) || 0)}
                         min="1" placeholder="Ej: 305" required={usarUnidadAlternativaParaIngreso}
                         className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-[#30518c]"/>
                </div>
                <div>
                  <label htmlFor="cantidadUnidadesAlternativas" className="block text-xs font-medium text-gray-600">Cant. de Unidades Alt. <span className="text-red-500">*</span></label>
                  <input type="number" id="cantidadUnidadesAlternativas" value={cantidadUnidadesAlternativas}
                         onChange={(e) => setCantidadUnidadesAlternativas(parseInt(e.target.value) || 0)}
                         min="0" placeholder="Ej: 2" required={usarUnidadAlternativaParaIngreso}
                         className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-[#30518c]"/>
                </div>
                <div>
                  <label htmlFor="precioPorUnidadAlternativa" className="block text-xs font-medium text-gray-600">
                    Precio por {nombreUnidadAlternativa} (S/) <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="number" id="precioPorUnidadAlternativa" value={precioPorUnidadAlternativa}
                    onChange={(e) => setPrecioPorUnidadAlternativa(parseFloat(e.target.value) || 0)}
                    min="0" step="0.01" required={usarUnidadAlternativaParaIngreso}
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-[#30518c]"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-6">
          <label htmlFor="cantidadIngresar" className="block text-sm font-medium text-gray-700 mb-1">
            {usarUnidadAlternativaParaIngreso ? `Total en ${unidadMedidaBase} a Ingresar (Calculado):` :
             `Cantidad en ${unidadMedidaBase} a Ingresar:`} <span className="text-red-500">*</span>
          </label>
          <input
            type="number" id="cantidadIngresar" value={cantidadIngresar}
            onChange={(e) => {
              if (!usarUnidadAlternativaParaIngreso) {
                setCantidadIngresar(parseInt(e.target.value) || 0);
              }
            }}
            min="0" placeholder="0"
            required={!usarUnidadAlternativaParaIngreso}
            className={`w-full border rounded-md px-3 py-2 shadow-sm ${usarUnidadAlternativaParaIngreso ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-300 focus:ring-1 focus:ring-[#30518c]'}`}
            disabled={usarUnidadAlternativaParaIngreso}
          />
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
            <button
                onClick={handleGuardar}
                disabled={esBotonGuardarDeshabilitado()}
                className="w-full sm:w-auto flex-grow bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-md shadow-lg disabled:opacity-60 transition-all duration-150 ease-in-out transform hover:scale-105"
            >
                {guardando ? "Guardando..." : (materialExistente ? `Añadir Stock / Actualizar Detalles` : "Registrar Nuevo Material")}
            </button>
            <button
                onClick={limpiarTodo}
                type="button" 
                className="w-full sm:w-auto bg-gray-500 hover:bg-gray-600 text-white font-semibold px-6 py-3 rounded-md shadow-lg transition-all duration-150 ease-in-out"
            >
                Limpiar / Cancelar
            </button>
        </div>
      </div>

      {/* Tabla de Stock del Almacén */}
      <div className="mt-10 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-[#2c5282] mb-6">
          Stock Actual del Almacén
        </h2>
        {cargandoStock ? (
          <p className="text-center text-gray-500">Cargando stock...</p>
        ) : listaStockMateriales.length === 0 ? (
          <p className="text-center text-gray-500">No hay materiales en stock.</p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-lg shadow-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Código (ID)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Stock Actual</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unidad</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Stock Mínimo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio Base</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio Alt.</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {listaStockMateriales.map((material) => {
                  const bajoStock = material.cantidad <= (material.stockMinimo || 0);
                  return (
                    <tr key={material.id} className={`hover:bg-gray-50 ${bajoStock ? 'bg-red-100 hover:bg-red-200' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{material.id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{material.nombre}</td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-semibold ${bajoStock ? 'text-red-600' : 'text-gray-700'}`}>
                        {material.cantidad || 0}
                        {bajoStock && <span className="ml-1" title="Stock bajo o igual al mínimo">⚠️</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{material.unidadMedidaBase}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 text-right">{material.stockMinimo || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs">{material.descripcion}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 text-right">S/ {Number(material.precioPorUnidadBase || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 text-right">
                        {material.precioPorUnidadAlternativa ? `S/ ${Number(material.precioPorUnidadAlternativa).toFixed(2)} (${material.nombreUnidadAlternativa || 'Alt.'})` : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}