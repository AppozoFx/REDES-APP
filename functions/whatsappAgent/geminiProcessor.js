const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAIInstance;
let geminiModelInstance;

// 🔁 Inicializar Gemini si no está iniciado
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

// 🔎 Consulta Firestore según intención
async function buscarDatosEnFirestore(tipoConsulta, parametros) {
  functions.logger.info("🧠 Consulta Firestore:", tipoConsulta, JSON.stringify(parametros));
  let datosEncontrados = null;
  let consultaRealizadaDesc = `Consulta Firestore: ${tipoConsulta}`;

  try {
    if (tipoConsulta === "consultar_estado_cuadrilla" && parametros.nombre_cuadrilla) {
      const nombreCuadrilla = parametros.nombre_cuadrilla.toUpperCase();
      consultaRealizadaDesc = `Estado de cuadrilla: ${nombreCuadrilla}`;
      const hoy = new Date().toISOString().split("T")[0];

      const snapshot = await db
        .collection("asistencia_cuadrillas")
        .where("nombre", "==", nombreCuadrilla)
        .where("fecha", "==", hoy)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        datosEncontrados = snapshot.docs[0].data();
      } else {
        const snapCuad = await db
          .collection("cuadrillas")
          .where("nombre", "==", nombreCuadrilla)
          .limit(1)
          .get();
        if (!snapCuad.empty) {
          const data = snapCuad.docs[0].data();
          datosEncontrados = {
            nombre: data.nombre,
            estado_general_cuadrilla: data.estado,
            mensaje_adicional: `No se encontró asistencia hoy para ${data.nombre}, pero su estado general es: ${data.estado}.`,
          };
        }
      }

    } else if (tipoConsulta === "solicitar_informe_liquidaciones_cuadrilla" && parametros.nombre_cuadrilla) {
      const nombre = parametros.nombre_cuadrilla.toUpperCase();
      const limite = Number(parametros.cantidad_liquidaciones) || 3;
      consultaRealizadaDesc = `Últimas ${limite} liquidaciones de ${nombre}`;

      const snapshot = await db
        .collection("liquidacion_instalaciones")
        .where("cuadrillaNombre", "==", nombre)
        .orderBy("fechaLiquidacion", "desc")
        .limit(limite)
        .get();

      if (!snapshot.empty) {
        datosEncontrados = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            cliente: d.cliente,
            fechaLiquidacion: d.fechaLiquidacion?.toDate().toLocaleDateString("es-PE", { timeZone: "America/Lima" }),
            codigoCliente: d.codigoCliente,
            estadoLiquidacion: d.estadoLiquidacion || "No especificado",
          };
        });
      }

    } else if (tipoConsulta === "consultar_info_tecnico_dni" && parametros.dni_tecnico) {
      const snapshot = await db
        .collection("usuarios")
        .where("dni_ce", "==", parametros.dni_tecnico)
        .where("rol", "array-contains", "Técnico")
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        datosEncontrados = {
          nombres: data.nombres,
          apellidos: data.apellidos,
          celular: data.celular,
          estado_usuario: data.estado_usuario,
        };
      }
    }

    functions.logger.info("✅ Resultado Firestore:", JSON.stringify(datosEncontrados));
    return { datos: datosEncontrados, consultaRealizadaDesc };

  } catch (error) {
    functions.logger.error(`❌ Error consultando Firestore para ${tipoConsulta}:`, error);
    return {
      error: `Error interno al consultar la base de datos para ${tipoConsulta}.`,
      consultaRealizadaDesc,
    };
  }
}

// 🤖 Procesamiento principal con Gemini
async function procesarConGemini(userQuery, userId) {
  if (!initializeGemini() || !geminiModelInstance) {
    return "⚠️ El asistente IA no está disponible en este momento.";
  }

  functions.logger.info(`🧠 Consulta recibida de ${userId}: "${userQuery}"`);

  // 1. Interpretación de intención
  const promptInterpretacion = `
Analiza la siguiente consulta del usuario y clasifícala en una de estas intenciones:
- "consultar_estado_cuadrilla"
- "solicitar_informe_liquidaciones_cuadrilla"
- "consultar_info_tecnico_dni"
- "pregunta_general_redesmyd"

Extrae las entidades relevantes:
- "nombre_cuadrilla" (ej: K5)
- "dni_tecnico" (ej: 12345678)
- "cantidad_liquidaciones" (número)

Consulta: "${userQuery}"

Formato JSON:
{"intencion": "...", "entidades": { ... }}
  `.trim();

  let interpretacion = { intencion: "pregunta_general_redesmyd", entidades: {} };
  try {
    const result = await geminiModelInstance.generateContent(promptInterpretacion);
    const raw = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const clean = raw.trim().replace(/^```json|```$/g, "");
    interpretacion = JSON.parse(clean);
    functions.logger.info("🧠 Interpretación:", JSON.stringify(interpretacion));
  } catch (err) {
    functions.logger.error("❌ Error interpretando intención:", err);
  }

  // 2. Ejecutar acción basada en intención
  let respuestaFinal = `Lo siento, no entendí completamente tu solicitud: "${userQuery}"`;
  let datosFirestore = null;
  let errorFirestore = null;

  if (interpretacion.intencion === "consultar_estado_cuadrilla" && interpretacion.entidades.nombre_cuadrilla) {
    const r = await buscarDatosEnFirestore("consultar_estado_cuadrilla", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla,
    });
    datosFirestore = r.datos;
    errorFirestore = r.error;
    if (!datosFirestore) return errorFirestore || "No se encontró asistencia para esa cuadrilla.";

  } else if (interpretacion.intencion === "solicitar_informe_liquidaciones_cuadrilla") {
    const r = await buscarDatosEnFirestore("solicitar_informe_liquidaciones_cuadrilla", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla,
      cantidad_liquidaciones: interpretacion.entidades.cantidad_liquidaciones || 3,
    });
    datosFirestore = r.datos;
    errorFirestore = r.error;
    if (!datosFirestore || datosFirestore.length === 0) return "No se encontraron liquidaciones recientes para esa cuadrilla.";

  } else if (interpretacion.intencion === "consultar_info_tecnico_dni") {
    const r = await buscarDatosEnFirestore("consultar_info_tecnico_dni", {
      dni_tecnico: interpretacion.entidades.dni_tecnico,
    });
    datosFirestore = r.datos;
    errorFirestore = r.error;
    if (!datosFirestore) return "No se encontró información para el técnico solicitado.";
  }

  // 3. Generar respuesta final con Gemini
  let promptFinal = "";

  if (datosFirestore) {
    promptFinal = `
Eres el asistente de RedesMYD. El usuario (${userId}) preguntó: "${userQuery}".
Basándote SOLO en los datos: ${JSON.stringify(datosFirestore)},
responde en español, claramente, sin inventar información. No especules.
    `.trim();
  } else {
    promptFinal = `
Eres un asistente de RedesMYD. El usuario (${userId}) preguntó: "${userQuery}".
Brinda una respuesta general o solicita más detalles si es necesario.
    `.trim();
  }

  try {
    const result = await geminiModelInstance.generateContent(promptFinal);
    const response = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    respuestaFinal = response || respuestaFinal;
  } catch (err) {
    functions.logger.error("❌ Error generando respuesta final:", err);
    respuestaFinal = "⚠️ No pude generar una respuesta por IA en este momento.";
  }

  functions.logger.info("📤 Respuesta final:", respuestaFinal);
  return respuestaFinal;
}

module.exports = { procesarConGemini };
