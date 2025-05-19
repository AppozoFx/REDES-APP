// functions/whatsappAgent/geminiProcessor.js
const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin"); // Tu instancia de Firestore Admin
const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAIInstance;
let geminiModelInstance;

// Función para inicializar Gemini
function initializeGemini() {
  if (geminiModelInstance) return true;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (GEMINI_API_KEY) {
    try {
      genAIInstance = new GoogleGenerativeAI(GEMINI_API_KEY);
      geminiModelInstance = genAIInstance.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      functions.logger.info("Modelo Gemini inicializado correctamente en geminiProcessor.");
      return true;
    } catch (error) {
      functions.logger.error("Error inicializando el SDK de Gemini en geminiProcessor:", error);
      geminiModelInstance = null;
      return false;
    }
  } else {
    functions.logger.warn("GEMINI_PROCESSOR: GEMINI_API_KEY no configurada en variables de entorno.");
    geminiModelInstance = null;
    return false;
  }
}

/**
 * Busca datos en Firestore basado en el tipo de consulta y parámetros.
 * @param {string} tipoConsulta - El tipo de consulta (ej. "estado_cuadrilla", "ultimas_liquidaciones").
 * @param {object} parametros - Parámetros para la consulta (ej. { nombreCuadrilla: "K5" }).
 * @returns {Promise<object>} Un objeto con { datos, consultaRealizadaDesc, error }.
 */
async function buscarDatosEnFirestore(tipoConsulta, parametros) {
  functions.logger.info("Buscando en Firestore:", tipoConsulta, JSON.stringify(parametros));
  let datosEncontrados = null;
  let consultaRealizadaDesc = `Consulta Firestore: ${tipoConsulta}`;

  try {
    if (tipoConsulta === "consultar_estado_cuadrilla" && parametros.nombre_cuadrilla) {
      const nombreCuadrillaNorm = parametros.nombre_cuadrilla.toUpperCase();
      consultaRealizadaDesc = `Buscando estado para cuadrilla: ${nombreCuadrillaNorm}`;
      const hoy = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD

      const asistenciaRef = db.collection("asistencia_cuadrillas");
      let q = asistenciaRef.where("nombre", "==", nombreCuadrillaNorm)
                           .where("fecha", "==", hoy)
                           .limit(1);
      let snapshot = await q.get();

      if (!snapshot.empty) {
        datosEncontrados = snapshot.docs[0].data();
        // Podrías añadir campos para clarificar la fuente, ej. datosEncontrados.fuente = "asistencia_hoy";
      } else {
        const cuadrillaRef = db.collection("cuadrillas").where("nombre", "==", nombreCuadrillaNorm).limit(1);
        snapshot = await cuadrillaRef.get();
        if (!snapshot.empty) {
          const cuadrillaData = snapshot.docs[0].data();
          datosEncontrados = {
            nombre: cuadrillaData.nombre,
            estado_general_cuadrilla: cuadrillaData.estado,
            mensaje_adicional: `La cuadrilla ${cuadrillaData.nombre} está ${cuadrillaData.estado}. No se encontró registro de asistencia específico para hoy.`
          };
        }
      }
    } else if (tipoConsulta === "solicitar_informe_liquidaciones_cuadrilla" && parametros.nombre_cuadrilla) {
      const nombreCuadrillaNorm = parametros.nombre_cuadrilla.toUpperCase();
      const limite = Number(parametros.cantidad_liquidaciones) || 3;
      consultaRealizadaDesc = `Buscando últimas ${limite} liquidaciones para ${nombreCuadrillaNorm}`;

      const liquidacionesSnap = await db.collection("liquidacion_instalaciones")
        .where("cuadrillaNombre", "==", nombreCuadrillaNorm)
        .orderBy("fechaLiquidacion", "desc")
        .limit(limite)
        .get();

      if (!liquidacionesSnap.empty) {
        datosEncontrados = liquidacionesSnap.docs.map(doc => {
          const data = doc.data();
          return {
            cliente: data.cliente,
            fechaLiquidacion: data.fechaLiquidacion ? data.fechaLiquidacion.toDate().toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : 'N/A',
            codigoCliente: data.codigoCliente,
            estadoLiquidacion: data.estadoLiquidacion || "No especificado"
          };
        });
      }
    } else if (tipoConsulta === "consultar_info_tecnico_dni" && parametros.dni_tecnico) {
      consultaRealizadaDesc = `Buscando técnico con DNI/CE: ${parametros.dni_tecnico}`;
      const usuariosRef = db.collection("usuarios");
      const q = usuariosRef.where("dni_ce", "==", parametros.dni_tecnico)
                           .where("rol", "array-contains", "Técnico")
                           .limit(1);
      const snapshot = await q.get();
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        datosEncontrados = {
            nombres: data.nombres,
            apellidos: data.apellidos,
            celular: data.celular, // Considera la privacidad de este dato
            estado_usuario: data.estado_usuario
        };
      }
    }
    // --- AÑADE MÁS TIPOS DE CONSULTA AQUÍ ---

    functions.logger.info("Datos encontrados en Firestore para la consulta:", JSON.stringify(datosEncontrados));
    return { datos: datosEncontrados, consultaRealizadaDesc };

  } catch (error) {
    functions.logger.error(`Error consultando Firestore para ${tipoConsulta} con params ${JSON.stringify(parametros)}:`, error);
    return { error: `Hubo un error al consultar la base de datos para ${tipoConsulta}.`, consultaRealizadaDesc };
  }
}

async function procesarConGemini(userQuery, userId) {
  if (!initializeGemini() || !geminiModelInstance) {
    return "Lo siento, la función de IA no está disponible en este momento (error de config de Gemini).";
  }

  functions.logger.info(`Procesando consulta para ${userId}: "${userQuery}" con Gemini.`);
  let respuestaFinal = `No he podido procesar tu solicitud: "${userQuery}". Puedo ayudarte con información general sobre RedesMYD o intentar buscar datos específicos si me das más detalles.`;

  // 1. Interpretar la intención y extraer entidades
  const promptInterpretacion = `
    Analiza la siguiente consulta de usuario y determina la intención principal y las entidades relevantes.
    Intenciones posibles: "consultar_estado_cuadrilla", "solicitar_informe_liquidaciones_cuadrilla", "consultar_info_tecnico_dni", "pregunta_general_redesmyd".
    Entidades a extraer: "nombre_cuadrilla" (ej: K5, K1 MOTO, K10 RESIDENCIAL), "cantidad_liquidaciones" (ej: 3, 5), "dni_tecnico" (ej: 12345678).
    La consulta es: "${userQuery}"
    Responde SOLAMENTE en formato JSON. Ejemplos:
    {"intencion": "consultar_estado_cuadrilla", "entidades": {"nombre_cuadrilla": "K5 RESIDENCIAL"}}
    {"intencion": "solicitar_informe_liquidaciones_cuadrilla", "entidades": {"nombre_cuadrilla": "K1 MOTO", "cantidad_liquidaciones": 5}}
    {"intencion": "consultar_info_tecnico_dni", "entidades": {"dni_tecnico": "12345678"}}
    {"intencion": "pregunta_general_redesmyd", "entidades": {}}
    Si no puedes identificar una intención clara o faltan entidades cruciales para una consulta específica (como el nombre de la cuadrilla si se pregunta por su estado), clasifícalo como "pregunta_general_redesmyd".
    Si la consulta es un saludo o despedida simple, clasifícalo como "pregunta_general_redesmyd".
  `;

  let interpretacion = { intencion: "pregunta_general_redesmyd", entidades: {} };
  let textInterpretacion = "";
  try {
    const resultInterpretacion = await geminiModelInstance.generateContent(promptInterpretacion);
    // Intenta obtener el texto de la respuesta. Puede estar en response.text() o en response.candidates
    if (resultInterpretacion.response && typeof resultInterpretacion.response.text === 'function') {
        textInterpretacion = resultInterpretacion.response.text();
    } else if (resultInterpretacion.response && resultInterpretacion.response.candidates && resultInterpretacion.response.candidates[0].content.parts[0].text) {
        textInterpretacion = resultInterpretacion.response.candidates[0].content.parts[0].text;
    } else {
        throw new Error("Formato de respuesta de Gemini inesperado para NLU.");
    }

    functions.logger.info("Interpretación de Gemini (NLU) Texto Crudo:", textInterpretacion);
    // Limpiar ```json y parsear
    const jsonStringLimpio = textInterpretacion.trim().replace(/^```json\s*|\s*```\s*$/g, '');
    interpretacion = JSON.parse(jsonStringLimpio);
    functions.logger.info("Interpretación de Gemini (NLU) Parseada:", JSON.stringify(interpretacion));

  } catch (error) {
    functions.logger.error("Error interpretando la consulta con Gemini (NLU):", error, "Texto original de Gemini:", textInterpretacion);
    interpretacion = { intencion: "pregunta_general_redesmyd", entidades: {} };
  }

  // 2. Actuar según la intención
  let datosFirestore = null;
  let consultaRealizadaDesc = "";
  let errorFirestore = null;

  if (interpretacion.intencion === "consultar_estado_cuadrilla" && interpretacion.entidades.nombre_cuadrilla) {
    const resultadoBusqueda = await buscarDatosEnFirestore("consultar_estado_cuadrilla", { nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla });
    datosFirestore = resultadoBusqueda.datos;
    consultaRealizadaDesc = resultadoBusqueda.consultaRealizadaDesc;
    errorFirestore = resultadoBusqueda.error;
    if (errorFirestore) return errorFirestore;
    if (!datosFirestore) respuestaFinal = `No encontré información de asistencia para la cuadrilla ${interpretacion.entidades.nombre_cuadrilla} para hoy. Por favor, verifica el nombre.`;

  } else if (interpretacion.intencion === "solicitar_informe_liquidaciones_cuadrilla" && interpretacion.entidades.nombre_cuadrilla) {
    const resultadoBusqueda = await buscarDatosEnFirestore("solicitar_informe_liquidaciones_cuadrilla", {
      nombre_cuadrilla: interpretacion.entidades.nombre_cuadrilla,
      cantidad_liquidaciones: interpretacion.entidades.cantidad_liquidaciones || 3
    });
    datosFirestore = resultadoBusqueda.datos;
    consultaRealizadaDesc = resultadoBusqueda.consultaRealizadaDesc;
    errorFirestore = resultadoBusqueda.error;
    if (errorFirestore) return errorFirestore;
    if (!datosFirestore || datosFirestore.length === 0) respuestaFinal = `No hay liquidaciones recientes para la cuadrilla ${interpretacion.entidades.nombre_cuadrilla}.`;

  } else if (interpretacion.intencion === "consultar_info_tecnico_dni" && interpretacion.entidades.dni_tecnico) {
    const resultadoBusqueda = await buscarDatosEnFirestore("consultar_info_tecnico_dni", { dni_tecnico: interpretacion.entidades.dni_tecnico });
    datosFirestore = resultadoBusqueda.datos;
    consultaRealizadaDesc = resultadoBusqueda.consultaRealizadaDesc;
    errorFirestore = resultadoBusqueda.error;
    if (errorFirestore) return errorFirestore;
    if (!datosFirestore) respuestaFinal = `No encontré información para el técnico con DNI/CE ${interpretacion.entidades.dni_tecnico}.`;
  }
  // ... puedes añadir más 'else if' para otras intenciones que consulten Firestore ...

  // 3. Generar respuesta con Gemini, usando datos de Firestore si existen
  let promptFinalParaGemini;

  if (datosFirestore) { // Si se encontraron datos específicos de Firestore
    promptFinalParaGemini = `
      Eres un asistente virtual amigable y eficiente de RedesMYD.
      El usuario (${userId}) preguntó: "${userQuery}".
      Información relevante obtenida de la base de datos fue: ${JSON.stringify(datosFirestore)}.
      Basándote EXCLUSIVAMENTE en esta información, responde la pregunta del usuario de forma clara, concisa y en español.
      Si los datos son una lista, preséntalos de forma ordenada y fácil de leer (por ejemplo, usando guiones o viñetas si es apropiado).
      Si los datos indican que no se encontró información específica (ej. "No hay registro de asistencia para hoy"), reformula eso amigablemente.
      No inventes información. No ofrezcas opiniones. Limítate a los datos proporcionados.
      Si la información es un estado, indícalo claramente (ej. "El estado de la cuadrilla X es Y").
    `;
  } else if (interpretacion.intencion !== "pregunta_general_redesmyd" && respuestaFinal.startsWith("No he podido")) {
    // Si se esperaba una consulta específica pero no se pudo concretar por falta de entidades, etc.
    // y respuestaFinal no fue actualizada por un "no encontrado" específico de la búsqueda.
    respuestaFinal = `Para poder ayudarte con tu consulta sobre "${interpretacion.intencion.replace(/_/g, ' ')}", necesito más detalles. Por ejemplo, si buscas el estado de una cuadrilla, ¿podrías decirme el nombre de la cuadrilla? Si buscas liquidaciones, ¿de qué cuadrilla?`;
    promptFinalParaGemini = null; // No necesitamos llamar a Gemini para esto, ya tenemos la respuesta.
  } else if (interpretacion.intencion === "pregunta_general_redesmyd" || respuestaFinal.startsWith("No encontré") || respuestaFinal.startsWith("No hay")) {
    // Si es una pregunta general, o si la búsqueda en Firestore no arrojó resultados y ya tenemos un mensaje para eso.
    if(respuestaFinal.startsWith("No he podido")){ // Si es una pregunta general sin datos de FS
         promptFinalParaGemini = `
          Eres el asistente virtual de RedesMYD. Responde de manera amigable y concisa a la siguiente pregunta del usuario (${userId}): "${userQuery}".
          Puedo ayudarte con información general sobre nuestros servicios de instalación y mantenimiento de redes.
          Si la pregunta es sobre datos específicos de la empresa que no puedes acceder directamente, indica que la información es general o dirige al usuario a contactar a soporte a través de [[www.redesmyd.com](https://www.redesmyd.com) o al correo soporte@redesmyd.com].
          No inventes información. Si no sabes la respuesta, dilo amablemente.
          Contexto de RedesMYD: empresa de instalaciones y mantenimiento de redes.
        `;
    } else {
        // Ya tenemos una respuesta específica de "no encontrado" de Firestore, no es necesario llamar a Gemini.
        promptFinalParaGemini = null;
    }
  }


  if (promptFinalParaGemini) {
    try {
      const result = await geminiModelInstance.generateContent(promptFinalParaGemini);
      let textResponseFromGemini = "No pude obtener una respuesta de la IA en este momento.";
      if (result.response && typeof result.response.text === 'function') {
          textResponseFromGemini = result.response.text();
      } else if (result.response && result.response.candidates && result.response.candidates[0].content.parts[0].text) {
          textResponseFromGemini = result.response.candidates[0].content.parts[0].text;
      }
      respuestaFinal = textResponseFromGemini || "No pude procesar tu solicitud con la IA en este momento (respuesta vacía).";

    } catch (error) {
      functions.logger.error("Error al contactar a Gemini para la respuesta final:", error);
      respuestaFinal = "Hubo un problema conectando con el servicio de IA para generar la respuesta. Por favor, intenta más tarde.";
    }
  }
  // Si promptFinalParaGemini fue null, respuestaFinal ya tiene el mensaje adecuado (ej. "No encontré...")

  functions.logger.info("Respuesta final a enviar:", respuestaFinal);
  return respuestaFinal;
}

module.exports = { procesarConGemini };