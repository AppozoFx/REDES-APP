const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAIInstance;
let geminiModelInstance;

function initializeGemini() {
  if (geminiModelInstance) return true;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (GEMINI_API_KEY) {
    try {
      genAIInstance = new GoogleGenerativeAI(GEMINI_API_KEY);
      geminiModelInstance = genAIInstance.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      functions.logger.info("✅ Gemini inicializado correctamente.");
      return true;
    } catch (error) {
      functions.logger.error("❌ Error inicializando Gemini:", error);
      geminiModelInstance = null;
      return false;
    }
  } else {
    functions.logger.warn("⚠️ GEMINI_API_KEY no configurado.");
    geminiModelInstance = null;
    return false;
  }
}

function obtenerNombreAutorizado(numeroWhatsapp) {
  const mapa = {
    "51913637815": "ARTURO",
    "51942455307": "MIGUEL",
    "51987334044": "JESUS",
    "51932491185": "SUSAN",
    "51992938625": "FRANK"
  };
  return mapa[numeroWhatsapp] || null;
}

async function buscarDatosEnFirestore(tipoConsulta, parametros) {
  functions.logger.info("🧠 Consulta Firestore:", tipoConsulta, JSON.stringify(parametros));
  let datosEncontrados = null;
  try {
    if (tipoConsulta === "consultar_stock_detallado_cuadrilla") {
      const snap = await db.collection("cuadrillas").where("nombre", "==", parametros.nombre_cuadrilla.toUpperCase()).limit(1).get();
      if (!snap.empty) {
        const cuadrillaId = snap.docs[0].id;
        const stockEquipos = await db.collection(`cuadrillas/${cuadrillaId}/stock_equipos`).get();
        datosEncontrados = stockEquipos.docs.map(doc => doc.data());
      }
    } else if (tipoConsulta === "contar_instalaciones_liquidadas_por_mes") {
      const nombre = parametros.nombre_cuadrilla.toUpperCase();
      const mes = parseInt(parametros.mes);
      const anio = parseInt(parametros.anio);
      const primerDia = new Date(anio, mes - 1, 1);
      const ultimoDia = new Date(anio, mes, 0, 23, 59, 59);
      const snapshot = await db
        .collection("liquidacion_instalaciones")
        .where("cuadrillaNombre", "==", nombre)
        .where("fechaInstalacion", ">=", primerDia)
        .where("fechaInstalacion", "<=", ultimoDia)
        .get();
      datosEncontrados = {
        cuadrilla: nombre,
        mes,
        anio,
        cantidad: snapshot.size
      };
    } else if (tipoConsulta === "consultar_instalaciones_por_sn") {
      const sn = parametros.sn;
      const snapshot = await db
        .collection("liquidacion_instalaciones")
        .where("snONT", "array-contains", sn)
        .get();
      if (!snapshot.empty) {
        datosEncontrados = snapshot.docs.map(doc => doc.data());
      } else {
        datosEncontrados = null;
      }
    } else if (tipoConsulta === "consultar_asistencia_cuadrilla") {
      const snap = await db.collection("asistencia_cuadrillas")
        .where("nombre", "==", parametros.nombre_cuadrilla.toUpperCase())
        .where("fecha", "==", parametros.fecha)
        .limit(1).get();
      if (!snap.empty) datosEncontrados = snap.docs[0].data();
    } else if (tipoConsulta === "consultar_asistencia_tecnico") {
      const snap = await db.collection("asistencia_tecnicos")
        .where("tecnicoId", "==", parametros.tecnico_id)
        .where("fecha", "==", parametros.fecha)
        .limit(1).get();
      if (!snap.empty) datosEncontrados = snap.docs[0].data();
    }
    functions.logger.info("✅ Resultado Firestore:", JSON.stringify(datosEncontrados));
    return { datos: datosEncontrados };
  } catch (error) {
    functions.logger.error(`❌ Error en consulta Firestore [${tipoConsulta}]:`, error);
    return { error: `Error al consultar Firestore (${tipoConsulta})` };
  }
}

async function procesarConGemini(userQuery, userId) {
  const nombreUsuario = obtenerNombreAutorizado(userId);
  if (!nombreUsuario) return "🚫 No tienes acceso autorizado al asistente de RedesMYD.";
  if (!initializeGemini() || !geminiModelInstance) return "⚠️ El asistente IA no está disponible en este momento.";

  const promptInterpretacion = `
Eres un sistema experto en instalaciones FTTH para WIN. Interpreta la intención de esta consulta:
"${userQuery}"
Identifica la intención y entidades relevantes: nombre_cuadrilla, mes, anio, sn, fecha, tecnico_id.
Opciones de intención:
- consultar_stock_detallado_cuadrilla
- contar_instalaciones_liquidadas_por_mes
- consultar_instalaciones_por_sn
- consultar_asistencia_cuadrilla
- consultar_asistencia_tecnico
Retorna en JSON. Ejemplo:
{"intencion": "...", "entidades": { ... }}
  `.trim();

  let interpretacion = { intencion: "pregunta_general_redesmyd", entidades: {} };
  try {
    const result = await geminiModelInstance.generateContent(promptInterpretacion);
    const raw = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    interpretacion = JSON.parse(raw.trim().replace(/^```json|```$/g, ""));
  } catch (err) {
    functions.logger.error("❌ Error interpretando intención:", err);
  }

  let datosFirestore = null;
  if (interpretacion.intencion === "consultar_stock_detallado_cuadrilla") {
    const r = await buscarDatosEnFirestore("consultar_stock_detallado_cuadrilla", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla
    });
    datosFirestore = r.datos;
    if (!datosFirestore) return "No se encontró stock detallado para esa cuadrilla.";
  } else if (interpretacion.intencion === "contar_instalaciones_liquidadas_por_mes") {
    const r = await buscarDatosEnFirestore("contar_instalaciones_liquidadas_por_mes", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla,
      mes: interpretacion.entidades.mes,
      anio: interpretacion.entidades.anio
    });
    datosFirestore = r.datos;
    if (!datosFirestore) return "No se encontraron instalaciones liquidadas para ese periodo.";
  } else if (interpretacion.intencion === "consultar_instalaciones_por_sn") {
    const r = await buscarDatosEnFirestore("consultar_instalaciones_por_sn", {
      sn: interpretacion.entidades.sn
    });
    datosFirestore = r.datos;
    if (!datosFirestore) return "No se encontró información de liquidación para ese número de serie.";
  } else if (interpretacion.intencion === "consultar_asistencia_cuadrilla") {
    const r = await buscarDatosEnFirestore("consultar_asistencia_cuadrilla", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla,
      fecha: interpretacion.entidades.fecha
    });
    datosFirestore = r.datos;
    if (!datosFirestore) return "No se encontró asistencia para esa cuadrilla en esa fecha.";
  } else if (interpretacion.intencion === "consultar_asistencia_tecnico") {
    const r = await buscarDatosEnFirestore("consultar_asistencia_tecnico", {
      tecnico_id: interpretacion.entidades.tecnico_id,
      fecha: interpretacion.entidades.fecha
    });
    datosFirestore = r.datos;
    if (!datosFirestore) return "No se encontró asistencia registrada para ese técnico.";
  }

  const promptFinal = `
Eres un asistente profesional de RedesMYD, empresa especializada en instalaciones FTTH para WIN.
Usuario: ${nombreUsuario}
Consulta: "${userQuery}"
Datos disponibles: ${JSON.stringify(datosFirestore)}
Responde de forma clara, profesional y sin inventar información. Si es un equipo, incluye SN, tipo, ubicación y fecha de despacho si aplica.
  `.trim();

  try {
    const result = await geminiModelInstance.generateContent(promptFinal);
    const response = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    return response || "❓ No se pudo generar una respuesta.";
  } catch (err) {
    functions.logger.error("❌ Error generando respuesta IA:", err);
    return "⚠️ No pude generar una respuesta por IA en este momento.";
  }
}

module.exports = { procesarConGemini };
