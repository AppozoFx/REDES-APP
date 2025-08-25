"use client";

import { useState, useEffect } from "react";
import { db } from "@/firebaseConfig";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/app/context/AuthContext";
import {
  collection,
  addDoc,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import toast from "react-hot-toast";

export default function OrdenCompraPage() {
  const { userData } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    razon: "",
    ruc: "",
    direccion: "",
    atencion: "",
    lugar: "",
    tipooc: "",
    fEntrega: "",
    condicionEntrega: "",
    cantidadEntrega: "",
    observacionEntrega: "",
    diasPago: "",
  });

  const fechaOrdenCompra = new Date().toLocaleDateString("es-PE");
  const [guardado, setGuardado] = useState(false);
  const [puedeNuevaOrden, setPuedeNuevaOrden] = useState(false);
  const [isLoading, setIsLoading] = useState(false);




 

  


  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setForm((prev) => ({ ...prev, [id]: value }));
    setGuardado(false);
  };
  
  
    
    
  

  const agregarItem = () => {
    setItems((prev) => [...prev, { cantidad: 0, codigo: "", descripcion: "", precio: 0, total: 0 }]);
  };

  
  const [editableTotal, setEditableTotal] = useState(0);
  const [porcentaje, setPorcentaje] = useState(0);
  const [baseTotal, setBaseTotal] = useState(1000); // Total original base (ajústalo según necesidad)

  const actualizarItem = (index, campo, valor) => {
    const nuevos = [...items];
    const descripcionMap = {
      "001": { desc: "INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN RESIDENCIALES", precio: 120 },
      "002": { desc: "INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN CONDOMINIOS", precio: 80 },
      "003": { desc: "CABLEADO UTP CAT 5E COLOR PLOMO", precio: 40 },
      "004": { desc: "CABLEADO UTP CAT 6 COLOR BLANCO", precio: 55 },
      "005": { desc: "TRASLADO DE SERVICIOS POR MUDANZA EN RESIDENCIALES", precio: 110 },
      "006": { desc: "TRASLADO DE SERVICIOS POR MUDANZA EN CONDOMINIOS", precio: 70 },
      "007": { desc: "PAGO DE EXCESO DE METRAJE DE F.O. (>400 MTS)", precio: 0.5 },
    };
    if (campo === "codigo" && descripcionMap[valor]) {
      nuevos[index].descripcion = descripcionMap[valor].desc;
      nuevos[index].precio = descripcionMap[valor].precio;
    }
    nuevos[index][campo] = valor;
    nuevos[index].total = nuevos[index].cantidad * nuevos[index].precio;
    setItems(nuevos);
    setGuardado(false);
  };

  const eliminarItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const subtotal = items.reduce((acc, item) => acc + item.total, 0);
  const igv = subtotal * 0.18;
  const total = subtotal + igv;

  useEffect(() => {
    setEditableTotal(total);
    setPorcentaje(100);
  }, [total]);

  const numeroALetras = (num) => {
    const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
    const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
    const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
    if (num === 100) return "CIEN";
    let words = "";
    if (num >= 1000) {
      let miles = Math.floor(num / 1000);
      words += (miles === 1 ? "MIL " : numeroALetras(miles) + " MIL ");
      num %= 1000;
    }
    if (num >= 100) {
      let cent = Math.floor(num / 100);
      words += centenas[cent] + " ";
      num %= 100;
    }
    if (num >= 20) {
      let dec = Math.floor(num / 10);
      words += decenas[dec];
      let uni = num % 10;
      if (uni > 0) words += (dec === 2 ? "I" + unidades[uni] : " Y " + unidades[uni]) + " ";
    } else if (num >= 10) {
      words += especiales[num - 10] + " ";
    } else if (num > 0) {
      words += unidades[num] + " ";
    }
    return words.trim();
  };

  const generarCodigoOC = async () => {
    const ref = doc(db, "counters", "ordenes_compra");
    const codigo = await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(ref);
      const data = docSnap.exists() ? docSnap.data() : { count: 0 };
      const nuevoCount = data.count + 1;
      transaction.set(ref, { count: nuevoCount });
      return `OC-${new Date().getFullYear()}-${String(nuevoCount).padStart(10, "0")}`;
    });
    return codigo;
  };

  const guardarOrdenEnFirestore = async (codigoOC) => {
    const datos = {
      codigo: codigoOC,
      proveedor: { ...form },
      items,
      subtotal,
      igv,
      total,
      creadoPor: `${userData?.nombres} ${userData?.apellidos}`,
      creadoEn: serverTimestamp(),
    };
    await addDoc(collection(db, "ordenes_compra"), datos);
  };

  const generarPDF = async (codigoOC) => {
    const docPDF = new jsPDF();
    const logo = new Image();
    logo.src = "/image/logo.png";
    await new Promise((resolve) => {
      logo.onload = () => {
        docPDF.addImage(logo, "PNG", 15, 10, 50, 30);
        resolve();
      };
    });

    const boxX = 140;
    const boxY = 10;
    const boxWidth = 60;
    const boxHeight = 8;
    const lines = [
      `RUC: 20601345979`,
      `ORDEN DE COMPRA`,
      `${codigoOC}`,
    ];

    docPDF.setFontSize(10);
    docPDF.setFont("helvetica", "bold");
    lines.forEach((line, i) => {
      docPDF.rect(boxX, boxY + i * boxHeight, boxWidth, boxHeight);
      const textWidth = docPDF.getTextWidth(line);
      const textX = boxX + (boxWidth / 2) - (textWidth / 2);
      const textY = boxY + i * boxHeight + boxHeight / 2 + 2;
      docPDF.text(line, textX, textY);
    });

    const pageWidth = docPDF.internal.pageSize.getWidth();
    const tableWidth = 60;
    const margin = 15;
    const fechaOrdenCompra = new Date().toLocaleDateString("es-PE");
    const fechaEntrega = form.fEntrega
  ? new Date(form.fEntrega + 'T00:00:00').toLocaleDateString('es-PE')
  : "-";

  const direccionLines = docPDF.splitTextToSize(`${form.direccion || ''}`, 80);
const direccionHeight = direccionLines.length * 5;

const atencionHeight = 5;  // atención solo ocupa una línea

const blockHeight = Math.max(direccionHeight, atencionHeight);




    const fechaStartY = 40;
    autoTable(docPDF, {
      startY: fechaStartY,
      margin: { left: margin },
      head: [["FECHA DE ORDEN DE COMPRA"]],
      body: [[fechaOrdenCompra]],
      theme: "grid",
      styles: { halign: 'center', fontSize: 8, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
      tableWidth: tableWidth
    });

    autoTable(docPDF, {
      startY: fechaStartY,
      margin: { left: pageWidth - margin - tableWidth },
      head: [["FECHA DE ENTREGA"]],
      body: [[fechaEntrega]],
      theme: "grid",
      styles: { halign: 'center', fontSize: 8, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
      tableWidth: tableWidth
    });

    let y = Math.max(docPDF.lastAutoTable.finalY, 40) + 20;

docPDF.setFontSize(10);

// Línea 1: Razón Social (izq) - RUC (der)
docPDF.setFont("helvetica", "bold");
docPDF.text(`Razón Social:`, 15, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(`${form.razon || ''}`, 50, y);
docPDF.setFont("helvetica", "bold");
docPDF.text(`RUC:`, 130, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(`${form.ruc || ''}`, 150, y);
y += 7;

// Línea 2: Dirección (izq, multilínea) - Atención (der)
docPDF.setFont("helvetica", "bold");
docPDF.text(`Dirección:`, 15, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(direccionLines, 50, y);
docPDF.setFont("helvetica", "bold");
docPDF.text(`Atención:`, 130, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(`${form.atencion || ''}`, 150, y);
// Calcula cuántas líneas ocupó y ajusta Y para ambos bloques
y += direccionLines.length * 5;

// Línea 3: Lugar de Entrega (izq) - Tipo OC (der)
docPDF.setFont("helvetica", "bold");
docPDF.text(`Lugar de Entrega:`, 15, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(`${form.lugar || ''}`, 50, y);
docPDF.setFont("helvetica", "bold");
docPDF.text(`Tipo OC:`, 130, y);
docPDF.setFont("helvetica", "normal");
docPDF.text(`${form.tipooc || ''}`, 150, y);







    const safeItems = Array.isArray(items) ? items.filter(item => item.cantidad && item.codigo) : [];
    autoTable(docPDF, {
      startY: y + 10,
      head: [["ITEM", "CANTIDAD", "CÓDIGO", "DESCRIPCIÓN", "PRECIO U.", "TOTAL"]],
      body: safeItems.length > 0 ? safeItems.map((item, i) => [
        i + 1,
        item.cantidad,
        item.codigo,
        item.descripcion,
        `S/ ${item.precio.toFixed(2)}`,
        `S/ ${item.total.toFixed(2)}`,
      ]) : [["-", "-", "-", "SIN ITEMS", "-", "-"]],
      theme: "grid",
      styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: 'center' }, // ITEM
        1: { halign: 'center' }, // CANTIDAD
        2: { halign: 'center' }, // CÓDIGO
        3: { halign: 'center', cellWidth: 70 }, // DESCRIPCIÓN (alineado a la izquierda pero más corto)
        4: { halign: 'center' }, // PRECIO U.
        5: { halign: 'center' }, // TOTAL
      }
      
    });

    const finalY = docPDF.lastAutoTable.finalY + 10;
    docPDF.text(`Subtotal: S/ ${subtotal.toFixed(2)}`, 160, finalY);
    docPDF.text(`IGV (18%): S/ ${igv.toFixed(2)}`, 160, finalY + 6);
    docPDF.text(`TOTAL: S/ ${total.toFixed(2)}`, 160, finalY + 12);

    const totalEntero = Math.floor(total);
    const totalDecimal = Math.round((total - totalEntero) * 100);
    const totalEnLetras = numeroALetras(totalEntero);
    const textoFinal = `SON: ${totalEnLetras} CON ${(totalDecimal < 10 ? "0" + totalDecimal : totalDecimal)}/100 SOLES`;
    docPDF.text(textoFinal, 105, finalY + 25, { align: "center" });

    const diasPago = form.diasPago.trim() !== "" ? form.diasPago : "60";


    autoTable(docPDF, {
      startY: finalY + 35,
      head: [[{ content: "CONDICIONES DE PAGO", colSpan: 4, styles: { halign: "center" } }]],
      body: [["MEDIO", "CONDICIÓN", "Total a Pagar", "DÍAS"],
      ["01 FACTURA", "CE - CONTRA ENTREGA", `${porcentaje.toFixed(0)}%`, diasPago]],
      theme: "grid",
      styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
    });
    
    

    const condicionEntrega = form.condicionEntrega.trim() !== "" ? form.condicionEntrega : "NINGUNA";
const cantidadEntrega = form.cantidadEntrega.trim() !== "" ? form.cantidadEntrega : "-";
const observacionEntrega = form.observacionEntrega.trim() !== "" ? form.observacionEntrega : "SIN OBSERVACIONES";

const leyendaFooter  = [
  "NOTA: La presente orden de compra está sujeta a las condiciones y términos previamente acordados entre ambas partes.",
  "Cualquier modificación, anulación o reclamo deberá ser comunicado formalmente a través de los canales autorizados.",
  "Redes M&D no se responsabiliza por demoras o incumplimientos derivados de causas ajenas a su control."
];



autoTable(docPDF, {
  startY: docPDF.lastAutoTable.finalY + 10,
  head: [[{ content: "CONDICIONES DE ENTREGA", colSpan: 4, styles: { halign: "center" } }]],
  body: [["CONDICIÓN", "CANTIDAD", "FECHA", "OBSERVACIÓN"],
         [condicionEntrega, cantidadEntrega, fechaEntrega, observacionEntrega]],
  theme: "grid",
  styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.2 },
  headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },

 // 👇 Aquí colocamos el pie de página
 didDrawPage: (data) => {
  const pageSize = docPDF.internal.pageSize;
  const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
  const pageWidth = pageSize.width ? pageSize.width : pageSize.getWidth();

  docPDF.setFontSize(8);
  docPDF.text(leyendaFooter, pageWidth / 2, pageHeight - 10, { align: 'center' });
}


});

return docPDF;

  };

  const registrarOrden = async () => {
    const toastId = toast.loading("⏳ Generando orden...");
    try {
      setIsLoading(true);        
      setGuardado(false);
      setPuedeNuevaOrden(false);
  
      const codigo = await generarCodigoOC();
      const docPDF = await generarPDF(codigo);  
      
      const pdfUrl = await guardarOrdenYSubirPDF(
        codigo,
        docPDF,
        form,
        items,
        subtotal,
        igv,
        total,
        userData
      );
  
      // ✅ Cierra el toast de carga al éxito
      toast.dismiss(toastId);
      toast.success("✅ Orden registrada, PDF generado y subido a Storage");
      console.log("✅ URL del PDF en Storage:", pdfUrl);
  
      setGuardado(true);
      setPuedeNuevaOrden(true);
  
      // ✅ Guarda localmente después del éxito
      toast.success("💾 Guardando PDF localmente...");
      docPDF.save(`${codigo}.pdf`);
  
    } catch (error) {
      toast.dismiss(toastId);
      toast.error("❌ Error al registrar la orden");
      console.error("Error al registrar la orden:", error);
  
      setGuardado(false);
      setPuedeNuevaOrden(false);
    } finally {
      setIsLoading(false);
    }
  };
  
  
  

  async function guardarOrdenYSubirPDF(codigoOC, docPDF, form, items, subtotal, igv, total, userData, isUpdate = false, docId = null) {
    const storage = getStorage();
    const dbRef = collection(db, "ordenes_compra");
    const storagePath = `ordenes_compra/${codigoOC}.pdf`;
  
    // 1️⃣ Convertir el PDF a Blob
    const pdfBlob = docPDF.output("blob");
  
    // 2️⃣ Subir a Firebase Storage
    const pdfRef = ref(storage, storagePath);
    await uploadBytes(pdfRef, pdfBlob);
    const downloadURL = await getDownloadURL(pdfRef);
  
    // 3️⃣ Preparar datos comunes
    const datos = {
      codigo: codigoOC,
      proveedor: { ...form },
      items,
      subtotal,
      igv,
      total,
      pdfUrl: downloadURL,
      actualizadoPor: `${userData?.nombres} ${userData?.apellidos}`,
      actualizadoEn: serverTimestamp(),
    };
  
    // 4️⃣ Crear o actualizar en Firestore
    if (isUpdate && docId) {
      await updateDoc(doc(db, "ordenes_compra", docId), datos);
      console.log("Orden actualizada exitosamente");
    } else {
      datos.creadoPor = `${userData?.nombres} ${userData?.apellidos}`;
      datos.creadoEn = serverTimestamp();
      await addDoc(dbRef, datos);
      console.log("Nueva orden creada exitosamente");
    }
  
    return downloadURL;
  }

  if (!userData?.rol?.includes("Gerencia")) return <p className="text-center text-red-500 font-bold">Acceso denegado</p>;

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white shadow rounded-lg">
      <h1 className="text-3xl font-bold mb-4 text-center">Orden de Compra</h1>
  
      <div className="grid grid-cols-2 gap-4 mb-6">
  {["razon", "ruc", "direccion", "atencion", "lugar", "tipooc"].map((id) => (
    <div key={id}>
      <label className="text-sm font-semibold capitalize block mb-1">{id}</label>
      <input
        type="text"
        id={id}
        value={form[id]}
        onChange={handleInputChange}
        className="w-full border px-3 py-2 rounded focus:outline-none focus:ring focus:border-blue-400"
      />
    </div>
  ))}

   {/* Fecha de orden de compra (no editable) */}
   <div>
    <label className="text-sm font-semibold capitalize block mb-1">Fecha de Orden de Compra</label>
    <p className="w-full border px-3 py-2 rounded bg-gray-100">{fechaOrdenCompra}</p>
  </div>

   {/* Fecha de entrega (editable por el usuario) */}
   <div>
    <label className="text-sm font-semibold capitalize block mb-1">Fecha de Entrega</label>
    <input
      type="date"
      id="fEntrega"
      value={form.fEntrega}
      onChange={handleInputChange}
      className="w-full border px-3 py-2 rounded focus:outline-none focus:ring focus:border-blue-400"
    />
  </div>

  
      </div>

      <div className="bg-gray-100 p-4 rounded mb-4">
  <h3 className="text-sm font-bold mb-2">Leyenda de Códigos</h3>
  <ul className="list-disc pl-5 space-y-1 text-sm">
    <li><strong>001</strong>: INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN RESIDENCIALES</li>
    <li><strong>002</strong>: INSTALACIÓN Y ACTIVACIÓN DE ABONADOS EN CONDOMINIOS</li>
    <li><strong>003</strong>: CABLEADO UTP CAT 5E COLOR PLOMO</li>
    <li><strong>004</strong>: CABLEADO UTP CAT 6 COLOR BLANCO</li>
    <li><strong>005</strong>: TRASLADO DE SERVICIOS POR MUDANZA EN RESIDENCIALES</li>
    <li><strong>006</strong>: TRASLADO DE SERVICIOS POR MUDANZA EN CONDOMINIOS</li>
    <li><strong>007</strong>: PAGO DE EXCESO DE METRAJE DE F.O. - EXCESO DE METRAJE DE FIBRA OPTICA (&gt;400 MTS)</li>
  </ul>
</div>

  
      <button onClick={agregarItem} className="bg-blue-600 text-white px-4 py-2 rounded mb-4 hover:bg-blue-700">
        Agregar Ítem
      </button>
  
      <div className="overflow-x-auto">
        <table className="w-full border mb-4 text-sm">
          <thead>
            <tr className="bg-gray-200">
              <th className="p-2 border">#</th>
              <th className="p-2 border">Cantidad</th>
              <th className="p-2 border">Código</th>
              <th className="p-2 border">Descripción</th>
              <th className="p-2 border">Precio</th>
              <th className="p-2 border">Total</th>
              <th className="p-2 border">Acción</th>
            </tr>
          </thead>
          <tbody className="text-center">
            {items.map((item, i) => (
              <tr key={i}>
                <td className="p-2 border text-center">{i + 1}</td>
                <td className="p-2 border">
                  <input
                    type="number"
                    value={item.cantidad}
                    onChange={(e) => actualizarItem(i, "cantidad", parseFloat(e.target.value) || 0)}
                    className="w-20 border px-4 py-1 rounded"
                  />
                </td>
                <td className="p-2 border">
                  <select
                    value={item.codigo}
                    onChange={(e) => actualizarItem(i, "codigo", e.target.value)}
                    className="w-20 border rounded px-1"
                  >
                    <option value="">-- Seleccionar --</option>
                    {["001", "002", "003", "004", "005", "006", "007"].map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2 border ">
                  <input
                    type="text"
                    value={item.descripcion}
                    readOnly
                    className="w-110  bg-gray-100 "
                  />
                </td>
                <td className="p-2 border ">
                  <input
                    type="number"
                    value={item.precio}
                    onChange={(e) => actualizarItem(i, "precio", parseFloat(e.target.value) || 0)}
                    className="w-10 "
                  />
                </td>
                <td className="p-2 border text-left">S/ {item.total.toFixed(2)}</td>
                <td className="p-2 border text-center">
                  <button onClick={() => eliminarItem(i)} className="text-red-500 hover:text-red-700">
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-right mb-4 text-sm">
        <p>Subtotal: <strong>S/ {subtotal.toFixed(2)}</strong></p>
        <p>IGV (18%): <strong>S/ {igv.toFixed(2)}</strong></p>
        <p className="font-bold text-lg">Total: S/ {total.toFixed(2)}</p>
      </div>
  
      <div className="bg-gray-100 p-4 rounded mb-6">
      <h2 className="text-lg font-bold mb-2 text-center">Condiciones de Pago</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold block mb-1">Medio:</label>
          <input type="text" value="01 Factura" readOnly className="w-full border px-3 py-2 rounded bg-gray-100" />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1">Condición:</label>
          <input type="text" value="CE - Contra Entrega" readOnly className="w-full border px-3 py-2 rounded bg-gray-100" />
        </div>
        <div>
  <label className="text-sm font-semibold block mb-1">Total a pagar:</label>
  <div className="relative">
    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">S/</span>
    <input
      type="number"
      value={editableTotal}
      onChange={(e) => {
        const newTotal = parseFloat(e.target.value) || 0;
        setEditableTotal(newTotal);
        const calcPorcentaje = total > 0 ? (newTotal / total) * 100 : 0;
        setPorcentaje(calcPorcentaje);
      }}
      className="w-full border pl-8 px-3 py-2 rounded"
    />
  </div>
</div>
        <div>
          <label className="text-sm font-semibold block mb-1">Días:</label>
          <input
  type="text"
  className="w-full border px-3 py-2 rounded"
  id="diasPago"
  value={form.diasPago}
  onChange={handleInputChange}
  placeholder="60"
/>
        </div>
        <div>
        <p className="text-sm font-semibold">
  Porcentaje: {porcentaje.toFixed(2)}%
</p>

        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
      <div>
  <label className="text-sm font-semibold block mb-1">Condiciones de Entrega:</label>
  <input
    type="text"
    className="w-full border px-3 py-2 rounded"
    id="condicionEntrega"
    value={form.condicionEntrega}
    onChange={handleInputChange}
    placeholder="NINGUNA"
  />
</div>

        <div>
          <label className="text-sm font-semibold block mb-1">Cantidad:</label>
          <input
  type="number"
  className="w-full border px-3 py-2 rounded"
  id="cantidadEntrega"
  value={form.cantidadEntrega}
  onChange={handleInputChange}
/>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1">Fecha:</label>
          <input
  type="date"
  id="fEntrega"
  value={form.fEntrega}
  onChange={handleInputChange}
  className="w-full border px-3 py-2 rounded"
/>

        </div>
        <div>
          <label className="text-sm font-semibold block mb-1">Observación:</label>
          <input
  type="text"
  className="w-full border px-3 py-2 rounded"
  id="observacionEntrega"
  value={form.observacionEntrega}
  onChange={handleInputChange}
  placeholder="Sin observaciones"
/>

        </div>
      </div>
    </div>
  
    <button
  onClick={registrarOrden}
  disabled={isLoading || guardado}
  className={`px-6 py-2 rounded font-semibold w-full ${
    isLoading || guardado ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'
  }`}
>
  {isLoading
    ? 'Generando orden...'
    : guardado
    ? 'Orden Guardada'
    : 'Guardar y Generar PDF'}
</button>

<button
  onClick={() => {
    toast((t) => (
      <span>
        ¿Confirmar nueva orden?
        <button
          onClick={() => {
            toast.dismiss(t.id);
            setForm({
              razon: "",
              ruc: "",
              direccion: "",
              atencion: "",
              lugar: "",
              tipooc: "",
              fEntrega: "",
              condicionEntrega: "",
              cantidadEntrega: "",
              observacionEntrega: "",
              diasPago: "",
            });
            setItems([]);
            setEditableTotal(0);
            setPorcentaje(0);
            setGuardado(false);
            setPuedeNuevaOrden(false);
            toast.success('Formulario listo para nueva orden');
          }}
          className="ml-2 bg-green-500 text-white px-2 py-1 rounded"
        >
          Sí
        </button>
        <button
          onClick={() => toast.dismiss(t.id)}
          className="ml-2 bg-red-500 text-white px-2 py-1 rounded"
        >
          No
        </button>
      </span>
    ));
  }}
  disabled={!puedeNuevaOrden}
  className={`mt-2 px-6 py-2 rounded font-semibold w-full ${
    puedeNuevaOrden
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : 'bg-gray-400 text-gray-700 cursor-not-allowed'
  }`}
>
  Nueva Orden
</button>



    </div>
  );
  
}  