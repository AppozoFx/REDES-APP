"use client";

import { useState, useEffect, useCallback } from "react";
import { db, storage } from "@/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  addDoc, 
  updateDoc,
  increment,
  setDoc 
} from "firebase/firestore";
import { ref as storageRefStandard, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JsBarcode from 'jsbarcode';

// --- FUNCIONES DE AYUDA PARA WHATSAPP (adaptadas de tu Despacho.js) ---
const obtenerCelularesTecnicos = async (tecnicosUID) => {
  if (!tecnicosUID || tecnicosUID.length === 0) return [];
  const celulares = [];
  try {
    for (const uid of tecnicosUID) {
      const userRef = doc(db, "usuarios", uid); // Asegúrate que la colección es "usuarios"
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.celular) {
          // Limpiar el número para que solo contenga dígitos
          const celularLimpio = String(userData.celular).replace(/\D/g, '');
          if (celularLimpio) { // Asegurarse que no quede vacío después de limpiar
            celulares.push(celularLimpio);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error obteniendo celulares de técnicos:", error);
    toast.error("Error al obtener celulares para WhatsApp.");
  }
  return celulares;
};

const enviarPorWhatsAppManual = (numero, { tipoGuia, guiaId, cuadrilla, tecnicos, usuario, urlComprobante, extraInfo = "" }) => {
  const mensaje = 
`📄 *${tipoGuia}*
*Guía:* ${guiaId}
*Cuadrilla:* ${cuadrilla}
*Técnicos:* ${tecnicos.join(", ")}
*Registrado por:* ${usuario}
${extraInfo ? `\n${extraInfo}` : ""}

Puedes ver el comprobante aquí:
${urlComprobante}`;

  // Asegurar que el número tenga el código de país (ej. 51 para Perú) si no lo tiene
  const numeroInternacional = numero.startsWith('51') ? numero : `51${numero}`;
  const enlace = `https://wa.me/${numeroInternacional}?text=${encodeURIComponent(mensaje)}`;
  window.open(enlace, "_blank");
};
// --- FIN FUNCIONES WHATSAPP ---


// --- Componente MaterialSelector (asumiendo que está corregido y funciona) ---
function MaterialSelector({ material, onAdd, stockDisponible }) {
  const [cantidadInput, setCantidadInput] = useState(1);
  
  const esMaterialTipoMetrosConAlternativa = 
    material.unidadMedidaBase === "METROS" &&
    material.sePuedeIngresarPorUnidadAlternativa &&
    material.nombreUnidadAlternativa &&
    material.factorConversionUnidadAlternativa &&
    Number(material.factorConversionUnidadAlternativa) > 0 &&
    typeof material.precioPorUnidadAlternativa === 'number';

  const [unidadSeleccionada, setUnidadSeleccionada] = useState(() => {
    if (esMaterialTipoMetrosConAlternativa && stockDisponible >= Number(material.factorConversionUnidadAlternativa)) {
      return material.nombreUnidadAlternativa;
    }
    return material.unidadMedidaBase;
  });

  useEffect(() => {
    setCantidadInput(1);
    if (esMaterialTipoMetrosConAlternativa && stockDisponible >= Number(material.factorConversionUnidadAlternativa)) {
      setUnidadSeleccionada(material.nombreUnidadAlternativa);
    } else {
      setUnidadSeleccionada(material.unidadMedidaBase);
    }
  }, [material, stockDisponible, esMaterialTipoMetrosConAlternativa]);

  const handleAddClick = () => {
    if (cantidadInput <= 0) {
      toast.error("La cantidad debe ser mayor a cero.");
      return;
    }

    let cantidadParaDescontarStock = Number(cantidadInput);
    let precioDeLaUnidadVendida = Number(material.precioPorUnidadBase || 0);
    let unidadDeVenta = unidadSeleccionada;

    if (esMaterialTipoMetrosConAlternativa && unidadSeleccionada === material.nombreUnidadAlternativa) {
      cantidadParaDescontarStock = Number(cantidadInput) * Number(material.factorConversionUnidadAlternativa);
      precioDeLaUnidadVendida = Number(material.precioPorUnidadAlternativa || 0);
    } else {
      unidadDeVenta = material.unidadMedidaBase;
    }

    if (cantidadParaDescontarStock > stockDisponible) {
      toast.error(`Stock insuficiente. Disponible: ${stockDisponible} ${material.unidadMedidaBase}. Solicitado (convertido): ${cantidadParaDescontarStock} ${material.unidadMedidaBase}`);
      return;
    }
    
    onAdd(material, Number(cantidadInput), unidadDeVenta, precioDeLaUnidadVendida, cantidadParaDescontarStock);
    
    setCantidadInput(1); 
    if (esMaterialTipoMetrosConAlternativa && stockDisponible >= Number(material.factorConversionUnidadAlternativa)) {
        setUnidadSeleccionada(material.nombreUnidadAlternativa);
    } else {
        setUnidadSeleccionada(material.unidadMedidaBase);
    }
  };
  
  let precioMostradoTexto = `S/ ${Number(material.precioPorUnidadBase || 0).toFixed(2)} (por ${material.unidadMedidaBase})`;
  if (esMaterialTipoMetrosConAlternativa) {
      if (unidadSeleccionada === material.nombreUnidadAlternativa) {
          precioMostradoTexto = `S/ ${Number(material.precioPorUnidadAlternativa || 0).toFixed(2)} (por ${material.nombreUnidadAlternativa})`;
      } else { 
          precioMostradoTexto = `S/ ${Number(material.precioPorUnidadBase || 0).toFixed(2)} (por ${material.unidadMedidaBase})`;
      }
  }

  return (
    <div className="p-3 border rounded-md shadow-sm bg-white hover:shadow-lg transition-shadow">
      <h4 className="font-semibold text-gray-800">{material.nombre} <span className="text-xs text-gray-500">({material.id})</span></h4>
      <p className="text-xs text-gray-600 mb-1 truncate" title={material.descripcion}>{material.descripcion || "Sin descripción"}</p>
      <p className="text-xs text-gray-500">
        Stock: <span className={`font-bold ${stockDisponible <= (material.stockMinimo || 0) ? 'text-red-500' : 'text-green-600'}`}>{stockDisponible}</span> {material.unidadMedidaBase}
        {stockDisponible <= (material.stockMinimo || 0) && <span className="ml-1 text-red-500" title="Stock bajo">⚠️</span>}
      </p>
      <p className="text-xs text-gray-500">Precio: {precioMostradoTexto}</p>
      
      <div className="flex items-end gap-2 mt-2">
        <div className="flex-grow">
            <label htmlFor={`cantidad-${material.id}`} className="text-xs text-gray-500 block mb-0.5">Cantidad:</label>
            <input
              id={`cantidad-${material.id}`}
              type="number"
              value={cantidadInput}
              onChange={(e) => setCantidadInput(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
              className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm shadow-sm focus:ring-1 focus:ring-blue-500"
            />
        </div>
        {esMaterialTipoMetrosConAlternativa && (
          <div className="flex-shrink-0">
            <label htmlFor={`unidad-${material.id}`} className="text-xs text-gray-500 block mb-0.5">Unidad:</label>
            <select
              id={`unidad-${material.id}`}
              value={unidadSeleccionada}
              onChange={(e) => setUnidadSeleccionada(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm h-[34px] shadow-sm focus:ring-1 focus:ring-blue-500"
            >
              <option value={material.unidadMedidaBase}>{material.unidadMedidaBase}</option>
              <option value={material.nombreUnidadAlternativa}>
                {material.nombreUnidadAlternativa}
              </option>
            </select>
          </div>
        )}
      </div>
      {esMaterialTipoMetrosConAlternativa && unidadSeleccionada === material.nombreUnidadAlternativa && (
        <p className="text-xs text-blue-600 mt-1">
            Total a descontar del stock: {Number(cantidadInput) * Number(material.factorConversionUnidadAlternativa)} {material.unidadMedidaBase}.
        </p>
      )}
      <button
          onClick={handleAddClick}
          disabled={stockDisponible === 0}
          className="mt-2 w-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm shadow disabled:opacity-50 transition-colors"
        >
          Añadir al Despacho
      </button>
    </div>
  );
}
// --- FIN MaterialSelector ---

export default function VentaMaterialesPage() {
  const { userData, user } = useAuth(); 
  const [cuadrillas, setCuadrillas] = useState([]);
  const [usuarios, setUsuarios] = useState([]); 
  const [stockAlmacen, setStockAlmacen] = useState([]);

  const [cuadrillaSeleccionadaId, setCuadrillaSeleccionadaId] = useState("");
  const [cuadrillaSeleccionadaInfo, setCuadrillaSeleccionadaInfo] = useState(null);
  
  const [itemsDespacho, setItemsDespacho] = useState([]);
  const [observaciones, setObservaciones] = useState("");
  const [procesandoDespacho, setProcesandoDespacho] = useState(false);
  const [filtroMaterial, setFiltroMaterial] = useState("");
  const [usuarioNombre, setUsuarioNombre] = useState('');

  useEffect(() => { 
    if (userData) { 
      setUsuarioNombre(`${userData.nombres || ""} ${userData.apellidos || ""}`.trim() || userData.email);
    } else if (user) { 
      setUsuarioNombre(user.email || "Usuario Desconocido");
    }
  }, [userData, user]);
  
  useEffect(() => { 
    const fetchData = async () => {
      try {
        const cuadrillasSnap = await getDocs(query(collection(db, "cuadrillas"), orderBy("nombre")));
        setCuadrillas(cuadrillasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const usuariosSnap = await getDocs(collection(db, "usuarios"));
        setUsuarios(usuariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error cargando datos iniciales:", error);
        toast.error("Error al cargar cuadrillas o usuarios.");
      }
    };
    fetchData();
  }, []);

  const cargarStockAlmacen = useCallback(async () => { 
    try {
      const stockSnap = await getDocs(query(collection(db, "material_venta_stock"), orderBy("nombre")));
      setStockAlmacen(stockSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error("Error cargando stock del almacén:", error);
      toast.error("Error al cargar el stock de materiales.");
    }
  }, []);
  useEffect(() => { cargarStockAlmacen(); }, [cargarStockAlmacen]);

  useEffect(() => { 
    if (cuadrillaSeleccionadaId) {
      const cuadrilla = cuadrillas.find(c => c.id === cuadrillaSeleccionadaId);
      if (cuadrilla) {
        const tecnicosInfo = (cuadrilla.tecnicos || []).map(uid => {
          const userTec = usuarios.find(u => u.id === uid);
          return userTec ? `${userTec.nombres} ${userTec.apellidos}` : uid;
        });
        const coordinadorInfo = usuarios.find(u => u.id === cuadrilla.coordinador);
        setCuadrillaSeleccionadaInfo({
          ...cuadrilla,
          tecnicosNombres: tecnicosInfo,
          coordinadorNombre: coordinadorInfo ? `${coordinadorInfo.nombres} ${coordinadorInfo.apellidos}` : "No asignado",
          tecnicosUID: cuadrilla.tecnicos || [], 
          telefonoCoordinador: coordinadorInfo?.celular || cuadrilla.celularCoordinador || cuadrilla.telefono 
        });
      } else { setCuadrillaSeleccionadaInfo(null); }
    } else { setCuadrillaSeleccionadaInfo(null); }
  }, [cuadrillaSeleccionadaId, cuadrillas, usuarios]);

  const handleAddMaterialAlDespacho = (material, cantidadDeUnidadVendida, unidadDeVenta, precioDeUnidadVendida, cantidadParaDescontarDelStock) => {
    setItemsDespacho(prevItems => {
      const existente = prevItems.find(item => item.materialId === material.id && item.unidadMedida === unidadDeVenta);
      const stockDisponibleEnAlmacen = stockAlmacen.find(m => m.id === material.id)?.cantidad || 0;
      
      if (existente) {
        const nuevaCantidadOriginalDespachada = existente.cantidadOriginalDespachada + cantidadDeUnidadVendida;
        const nuevaCantidadParaDescontarStock = existente.cantidadParaDescontarStock + cantidadParaDescontarDelStock;

        if (nuevaCantidadParaDescontarStock > stockDisponibleEnAlmacen) {
            toast.error(`No puedes añadir más. Stock disponible (${material.unidadMedidaBase}): ${stockDisponibleEnAlmacen}.`);
            return prevItems;
        }
        return prevItems.map(item =>
          item.materialId === material.id && item.unidadMedida === unidadDeVenta
            ? { 
                ...item, 
                cantidadOriginalDespachada: nuevaCantidadOriginalDespachada,
                cantidadParaDescontarStock: nuevaCantidadParaDescontarStock,
                subtotal: nuevaCantidadOriginalDespachada * item.precioUnitario 
              }
            : item
        );
      } else {
        if (cantidadParaDescontarDelStock > stockDisponibleEnAlmacen) {
            toast.error(`Stock insuficiente para ${material.nombre}. Disponible (${material.unidadMedidaBase}): ${stockDisponibleEnAlmacen}`);
            return prevItems;
        }
        return [
          ...prevItems,
          {
            materialId: material.id,
            nombreMaterial: material.nombre,
            descripcionMaterial: material.descripcion || "",
            unidadMedida: unidadDeVenta, 
            cantidadOriginalDespachada: cantidadDeUnidadVendida, 
            cantidadParaDescontarStock: cantidadParaDescontarDelStock, 
            precioUnitario: precioDeUnidadVendida, 
            subtotal: cantidadDeUnidadVendida * precioDeUnidadVendida
          }
        ];
      }
    });
  };
  
  const handleRemoveMaterialDelDespacho = (materialId, unidadMedida) => {
    setItemsDespacho(prevItems => prevItems.filter(item => !(item.materialId === materialId && item.unidadMedida === unidadMedida) ));
    toast.success("Material eliminado del despacho.");
  };

  const handleUpdateCantidadDespacho = (materialId, unidadMedidaOriginal, nuevaCantidadOriginalStr) => {
    const nuevaCantidadOriginal = parseInt(nuevaCantidadOriginalStr) || 0;
    const itemActual = itemsDespacho.find(i => i.materialId === materialId && i.unidadMedida === unidadMedidaOriginal);
    if (!itemActual) return;

    const materialEnDb = stockAlmacen.find(m => m.id === materialId); 
    if (!materialEnDb) return;
    
    const stockDisponibleEnAlmacen = materialEnDb.cantidad || 0;

    if (nuevaCantidadOriginal < 0) {
        toast.error("La cantidad no puede ser negativa.");
        return;
    }
    
    let nuevaCantidadParaDescontar = nuevaCantidadOriginal;
    if (unidadMedidaOriginal === materialEnDb.nombreUnidadAlternativa && materialEnDb.factorConversionUnidadAlternativa) {
        nuevaCantidadParaDescontar = nuevaCantidadOriginal * Number(materialEnDb.factorConversionUnidadAlternativa);
    }

    const stockRealDisponibleParaEsteItem = stockDisponibleEnAlmacen + itemActual.cantidadParaDescontarStock;

    if (nuevaCantidadParaDescontar > stockRealDisponibleParaEsteItem) {
      toast.error(`Stock insuficiente. Disponible real para este ítem (${materialEnDb.unidadMedidaBase}): ${stockRealDisponibleParaEsteItem}.`);
      return; 
    }

    setItemsDespacho(prevItems =>
      prevItems.map(item => {
        if (item.materialId === materialId && item.unidadMedida === unidadMedidaOriginal) {
          return { 
            ...item, 
            cantidadOriginalDespachada: nuevaCantidadOriginal,
            cantidadParaDescontarStock: nuevaCantidadParaDescontar,
            subtotal: nuevaCantidadOriginal * item.precioUnitario 
          };
        }
        return item;
      })
    );
  };

  const totalGeneralDespacho = itemsDespacho.reduce((acc, item) => acc + item.subtotal, 0);
  
  const generarNumeroGuiaDespachoMateriales = async () => { 
    const anio = new Date().getFullYear();
    const ref = doc(db, "counters", "guias_despacho_materiales"); 
    const snap = await getDoc(ref);
    let count = 1;
    if (snap.exists()) {
      count = (snap.data().valor || 0) + 1;
    }
    await setDoc(ref, { valor: count }, { merge: true });
    return `VENTA-${anio}-${String(count).padStart(5, "0")}`;
  };
  
  const generarPDFGuiaMateriales = async (guiaId, datosGuia) => {
    const maxAlturaPorPagina = 280; 
    const docPDF = new jsPDF({ unit: "mm", format: [80, maxAlturaPorPagina], compress: true });
    let y = 10;
    const margenIzquierdo = 5;
    const margenDerecho = 75; 
    const anchoContenido = margenDerecho - margenIzquierdo; 

    docPDF.setFontSize(9);
    docPDF.setFont("helvetica", "normal");
    const center = { align: "center", maxWidth: anchoContenido };

    docPDF.text("CONSTRUCCIÓN DE REDES M&D S.A.C", 40, y, center); y += 4;
    docPDF.text("RUC: 20601345979", 40, y, center); y += 4;
    docPDF.text("Cal. Juan Prado de Zela Mza. F2 Lote. 3", 40, y, center); y += 4;
    docPDF.text("Apv. San Francisco de Cayran", 40, y, center); y += 4;
    docPDF.text("Celular/WSP: 913 637 815", 40, y, center); y += 6;

    docPDF.setFont("helvetica", "bold");
    docPDF.text("GUÍA DE DESPACHO DE MATERIALES", 40, y, center); y += 5;
    docPDF.text(`Guía: ${guiaId}`, 40, y, center); y += 5;
    docPDF.setFont("helvetica", "normal");
    
    const fechaDespachoObj = datosGuia.fechaDespacho instanceof Date ? datosGuia.fechaDespacho : datosGuia.fechaDespacho.toDate();
    docPDF.text(`Fecha: ${fechaDespachoObj.toLocaleString('es-PE', { timeZone: 'America/Lima' })}`, margenIzquierdo, y); y += 5;
    docPDF.text(`Almacén: ${datosGuia.usuarioDespachoNombre}`, margenIzquierdo, y); y += 5;
    
    const addWrappedText = (label, value, currentY) => {
        const labelFull = label + ": ";
        const labelWidth = docPDF.getTextWidth(labelFull);
        const valueX = margenIzquierdo + labelWidth;
        const availableWidthForValue = margenDerecho - valueX;
        
        docPDF.text(labelFull, margenIzquierdo, currentY);
        const valueLines = docPDF.splitTextToSize(value || 'No asignado', availableWidthForValue);
        docPDF.text(valueLines, valueX , currentY);
        return currentY + (valueLines.length * 4); 
    };

    y = addWrappedText("Cuadrilla", datosGuia.cuadrillaNombre, y); y+=1;
    y = addWrappedText("Coordinador", datosGuia.coordinadorNombre, y); y+=1;
    
    if (datosGuia.tecnicosNombres && datosGuia.tecnicosNombres.length > 0) {
        y = addWrappedText("Técnicos", datosGuia.tecnicosNombres.join(", "), y); y+=1;
    }
    y += 3; 

    autoTable(docPDF, {
      startY: y,
      head: [['Cant.', 'Unid.', 'Material', 'P.U.', 'Total']],
      body: datosGuia.items.map(item => [ 
        item.cantidadDespachada, 
        item.unidadMedida, 
        item.nombreMaterial,
        Number(item.precioUnitario).toFixed(2),
        Number(item.subtotal).toFixed(2)
      ]),
      theme: 'plain', 
      styles: { 
        fontSize: 7, 
        cellPadding: 0.8, 
        halign: 'left',
        lineWidth: 0 
      },
      headStyles: { 
        fontStyle: 'bold', 
        fillColor: false, 
        textColor: 0, 
        lineWidth: 0 
      },
      columnStyles: {
        0: { halign: 'right', cellWidth: 8 }, 
        1: { cellWidth: 10 }, 
        2: { cellWidth: 27 }, 
        3: { halign: 'right', cellWidth: 10 }, 
        4: { halign: 'right', cellWidth: 10 }  
      },
      margin: { left: margenIzquierdo, right: margenIzquierdo }
    });

    y = docPDF.lastAutoTable.finalY + 6; 
    docPDF.setFont("helvetica", "bold");
    docPDF.text(`TOTAL GENERAL: S/ ${Number(datosGuia.totalGeneral).toFixed(2)}`, margenDerecho, y, {align: 'right'}); 
    y += 5;
    docPDF.setFont("helvetica", "normal");

    if (datosGuia.observaciones) {
      docPDF.text("Observaciones:", margenIzquierdo, y); y += 4;
      const obsLines = docPDF.splitTextToSize(datosGuia.observaciones, anchoContenido -2);
      docPDF.text(obsLines, margenIzquierdo + 2, y);
      y += obsLines.length * 4;
    }
    y += 10; 

    const canvas = document.createElement("canvas");
    try {
        JsBarcode(canvas, guiaId, { format: "CODE128", displayValue: false, width: 1.5, height: 25, margin: 0 });
        const imgData = canvas.toDataURL("image/png");
        docPDF.addImage(imgData, "PNG", margenIzquierdo + 5, y, anchoContenido -10 , 12);
    } catch (e) {
        console.error("Error generando barcode:", e);
        docPDF.text(`Error Barcode: ${guiaId}`, margenIzquierdo, y);
    }
    y += 30; 
    
    if (y > maxAlturaPorPagina - 25) { 
        docPDF.addPage();
        y = 10; 
    }

    docPDF.text("___________________", margenIzquierdo, y);
    docPDF.text("___________________", margenIzquierdo + 35, y);
    y += 5;
    docPDF.text("Firma Cuadrilla", margenIzquierdo + 5, y);
    docPDF.text("Firma Almacén", margenIzquierdo + 40, y);

    const pdfBlob = docPDF.output("blob");
    // Asegúrate que `storageRefStandard` esté definido correctamente si `storageRef` causa conflicto.
    const pdfStoragePath = `guias_despacho_materiales/${guiaId}.pdf`;
    const finalStorageRef = storageRefStandard(storage, pdfStoragePath);
    await uploadBytes(finalStorageRef, pdfBlob);
    const downloadURL = await getDownloadURL(finalStorageRef);
    
    const url = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    };
    iframe.onafterprint = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };
    return downloadURL;
  };


  // --- MODIFICADO: handleConfirmarDespacho con Notificaciones y WhatsApp ---
  const handleConfirmarDespacho = async () => {
    if (!cuadrillaSeleccionadaId) { toast.error("Selecciona una cuadrilla."); return; }
    if (itemsDespacho.length === 0) { toast.error("Añade al menos un material al despacho."); return; }
    if (!usuarioNombre) { toast.error("No se pudo identificar al usuario. Intenta recargar."); return; }

    setProcesandoDespacho(true);
    const toastId = toast.loading("Procesando despacho...");
    const batch = writeBatch(db);
    const guiaId = await generarNumeroGuiaDespachoMateriales();
    let pdfUrlGenerada = ""; // Definida para almacenar la URL del PDF

    try {
      for (const item of itemsDespacho) {
        const materialRef = doc(db, "material_venta_stock", item.materialId);
        const materialSnap = await getDoc(materialRef);

        if (!materialSnap.exists()) throw new Error(`Material ${item.nombreMaterial} (ID: ${item.materialId}) no existe.`);
        const stockActual = materialSnap.data().cantidad || 0;
        
        if (item.cantidadParaDescontarStock > stockActual) { 
          throw new Error(`Stock insuficiente para ${item.nombreMaterial}. Disp: ${stockActual}, Sol (convertido): ${item.cantidadParaDescontarStock}`);
        }
        batch.update(materialRef, {
          cantidad: increment(-item.cantidadParaDescontarStock), 
          lastUpdatedAt: serverTimestamp(),
          lastUpdatedBy: usuarioNombre,
        });
      }

      const guiaData = {
        guiaId,
        cuadrillaId: cuadrillaSeleccionadaId,
        cuadrillaNombre: cuadrillaSeleccionadaInfo?.nombre || "N/A",
        tecnicosNombres: cuadrillaSeleccionadaInfo?.tecnicosNombres || [],
        coordinadorNombre: cuadrillaSeleccionadaInfo?.coordinadorNombre || "N/A",
        fechaDespacho: serverTimestamp(),
        usuarioDespachoId: user?.uid, 
        usuarioDespachoNombre: usuarioNombre,
        items: itemsDespacho.map(it => ({ 
            materialId: it.materialId,
            nombreMaterial: it.nombreMaterial,
            unidadMedida: it.unidadMedida, 
            cantidadDespachada: it.cantidadOriginalDespachada, 
            precioUnitario: it.precioUnitario,
            subtotal: it.subtotal
        })),
        totalGeneral: totalGeneralDespacho,
        observaciones: observaciones.trim(),
        createdAt: serverTimestamp(),
        pdfUrl: "",
        estadoVenta: "Pendiente",
      };
      const guiaDocRef = doc(db, "guias_despacho_materiales", guiaId);
      batch.set(guiaDocRef, guiaData);
      
      await batch.commit();
      toast.success("Datos del despacho guardados.", { id: toastId });

      toast.loading("Generando PDF...", { id: toastId });
      pdfUrlGenerada = await generarPDFGuiaMateriales(guiaId, { ...guiaData, fechaDespacho: new Date() });
      
      if (pdfUrlGenerada && typeof pdfUrlGenerada === 'string') {
        await updateDoc(guiaDocRef, { pdfUrl: pdfUrlGenerada });
        toast.success("Guía PDF generada y enlazada.", { id: toastId });
      } else {
        console.error("Error: La URL del PDF no se generó correctamente.", pdfUrlGenerada);
        toast.error("Error al obtener la URL del PDF. La guía se guardó sin el enlace al PDF.", { id: toastId });
      }

      // --- NOTIFICACIÓN EN FIRESTORE ---
      try {
        const resumenItemsNotif = itemsDespacho.map(it => `${it.cantidadOriginalDespachada} ${it.unidadMedida} ${it.nombreMaterial}`).join(", ");
        await addDoc(collection(db, "notificaciones"), {
          tipo: "Despacho Materiales", // Tipo específico para este despacho
          mensaje: `📦 ${usuarioNombre} despachó materiales a "${cuadrillaSeleccionadaInfo?.nombre}". Guía: ${guiaId}.`,
          usuario: usuarioNombre,
          fecha: serverTimestamp(),
          guiaId: guiaId,
          link: pdfUrlGenerada || "No disponible", 
          detalles: {
            cuadrilla: cuadrillaSeleccionadaInfo?.nombre,
            coordinador: cuadrillaSeleccionadaInfo?.coordinadorNombre,
            itemsResumen: resumenItemsNotif, // Un resumen más corto para el mensaje
            total: totalGeneralDespacho.toFixed(2)
          },
          visto: false,
          rolDestino: ["Administrador", "Almacen", "Coordinador"] // Ajustar roles según necesidad
        });
        toast.success("🔔 Notificación de despacho registrada");
      } catch (notifError) {
        console.error("Error creando notificación:", notifError);
        toast.error("Error al crear la notificación del despacho.");
      }
      // --- FIN NOTIFICACIÓN ---

      // --- ENVÍO DE WHATSAPP ---
      const tecnicosUIDParaWsp = cuadrillaSeleccionadaInfo?.tecnicosUID || [];
      const celularesTecnicos = await obtenerCelularesTecnicos(tecnicosUIDParaWsp);
      
      // Usar el teléfono del coordinador si está disponible en cuadrillaSeleccionadaInfo
      const celularCoordinador = cuadrillaSeleccionadaInfo?.telefonoCoordinador; 
      const numerosParaEnviar = new Set(); 
      
      celularesTecnicos.forEach(cel => numerosParaEnviar.add(cel));
      if (celularCoordinador) {
        numerosParaEnviar.add(String(celularCoordinador).replace(/\D/g, ''));
      }
      
      if (numerosParaEnviar.size > 0) {
        const resumenItemsWsp = itemsDespacho.map(it => `- ${it.cantidadOriginalDespachada} ${it.unidadMedida} ${it.nombreMaterial}`).join("\n");
        const extraInfoWsp = `*Materiales Despachados:*\n${resumenItemsWsp}\n\n*Total General: S/ ${totalGeneralDespacho.toFixed(2)}*`;

        numerosParaEnviar.forEach(numero => {
          if (numero) { 
            enviarPorWhatsAppManual(numero, {
              tipoGuia: "DESPACHO DE MATERIALES", // Tipo de guía específico
              guiaId,
              cuadrilla: cuadrillaSeleccionadaInfo?.nombre || "N/A",
              tecnicos: cuadrillaSeleccionadaInfo?.tecnicosNombres || [], 
              usuario: usuarioNombre,
              urlComprobante: pdfUrlGenerada || "No disponible",
              extraInfo: extraInfoWsp
            });
          }
        });
        toast.success("Preparando mensajes de WhatsApp...");
      } else {
        toast.warn("No se encontraron números de celular para enviar WhatsApp.");
      }
      // --- FIN ENVÍO DE WHATSAPP ---
      
      setCuadrillaSeleccionadaId("");
      setItemsDespacho([]);
      setObservaciones("");
      cargarStockAlmacen();

    } catch (error) {
      console.error("Error al confirmar despacho:", error);
      toast.error(`Error en despacho: ${error.message}`, { id: toastId });
    } finally {
      setProcesandoDespacho(false);
    }
  };
  // --- FIN MODIFICADO ---
  
  const materialesFiltrados = stockAlmacen.filter(material => 
    material.nombre.toLowerCase().includes(filtroMaterial.toLowerCase()) ||
    (material.id && material.id.toLowerCase().includes(filtroMaterial.toLowerCase()))
  );

  return (
    // --- JSX Principal (sin cambios significativos en la estructura) ---
    <div className="p-4 md:p-6 space-y-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-center text-[#2c5282] mb-6">
        Venta/Despacho de Materiales
      </h1>

      {/* Sección 1: Selección de Cuadrilla */}
      <div className="bg-white p-6 rounded-lg shadow-lg border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-700 mb-3">1. Seleccionar Cuadrilla</h2>
        <select
          value={cuadrillaSeleccionadaId}
          onChange={(e) => setCuadrillaSeleccionadaId(e.target.value)}
          className="w-full md:w-1/2 p-2.5 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">-- Seleccione una Cuadrilla --</option>
          {cuadrillas.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>

        {cuadrillaSeleccionadaInfo && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm space-y-1">
            <p><strong>Nombre:</strong> {cuadrillaSeleccionadaInfo.nombre}</p>
            <p><strong>Coordinador:</strong> {cuadrillaSeleccionadaInfo.coordinadorNombre}</p>
            <p><strong>Técnicos:</strong> {cuadrillaSeleccionadaInfo.tecnicosNombres.join(", ") || "No asignados"}</p>
            {(cuadrillaSeleccionadaInfo.telefonoCoordinador) && 
             <p><strong>Tel. Contacto (WSP):</strong> {cuadrillaSeleccionadaInfo.telefonoCoordinador}</p>
            }
          </div>
        )}
      </div>

      {/* Sección 2: Selección de Materiales */}
      {cuadrillaSeleccionadaId && (
        <div className="bg-white p-6 rounded-lg shadow-lg border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">2. Seleccionar Materiales del Almacén</h2>
          <input 
            type="text"
            placeholder="Buscar material por código o nombre..."
            value={filtroMaterial}
            onChange={(e) => setFiltroMaterial(e.target.value)}
            className="w-full p-2.5 border border-gray-300 rounded-md mb-4 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[50vh] overflow-y-auto p-1 custom-scrollbar">
            {materialesFiltrados.length > 0 ? (
              materialesFiltrados.map(material => (
                <MaterialSelector
                  key={material.id}
                  material={material}
                  onAdd={handleAddMaterialAlDespacho}
                  stockDisponible={material.cantidad || 0}
                />
              ))
            ) : (
              <p className="col-span-full text-center text-gray-500 py-4">
                {stockAlmacen.length === 0 ? "No hay materiales en stock." : "No se encontraron materiales."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sección 3: Resumen del Despacho */}
      {itemsDespacho.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-lg border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">3. Resumen del Despacho</h2>
          <div className="overflow-x-auto mb-4">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Material</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Cant.</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Unidad</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">P.U.</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Subtotal</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600">Acción</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {itemsDespacho.map(item => (
                  <tr key={`${item.materialId}-${item.unidadMedida}`}> 
                    <td className="px-4 py-2 whitespace-nowrap">{item.nombreMaterial}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                       <input
                         type="number"
                         value={item.cantidadOriginalDespachada} 
                         onChange={(e) => handleUpdateCantidadDespacho(item.materialId, item.unidadMedida, e.target.value)}
                         min="0"
                         className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right shadow-sm focus:ring-1 focus:ring-blue-500"
                       />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{item.unidadMedida}</td> 
                    <td className="px-4 py-2 whitespace-nowrap text-right">S/ {item.precioUnitario.toFixed(2)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">S/ {item.subtotal.toFixed(2)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-center">
                      <button
                        onClick={() => handleRemoveMaterialDelDespacho(item.materialId, item.unidadMedida)} 
                        className="text-red-600 hover:text-red-700 text-xs font-medium"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
           <div className="text-right font-bold text-gray-800 text-xl mb-4">
            Total General: S/ {totalGeneralDespacho.toFixed(2)}
          </div>
          <div>
            <label htmlFor="observaciones" className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
            <textarea
              id="observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows="2"
              className="w-full p-2.5 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Alguna nota adicional sobre el despacho..."
            ></textarea>
          </div>

          <button
            onClick={handleConfirmarDespacho}
            disabled={procesandoDespacho}
            className="mt-6 w-full bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-md shadow-lg disabled:opacity-60 transition-all duration-150 ease-in-out transform hover:scale-105"
          >
            {procesandoDespacho ? "Procesando..." : "Confirmar y Generar Guía de Despacho"}
          </button>
        </div>
      )}
    </div>
  );
}
