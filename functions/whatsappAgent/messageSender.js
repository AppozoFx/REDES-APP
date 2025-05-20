const functions = require("firebase-functions");
const axios = require("axios");

/**
 * Envía un mensaje de texto vía WhatsApp utilizando la API de Meta.
 * Divide el mensaje en partes si supera el límite de 4096 caracteres.
 * 
 * @param {string} to - Número de teléfono en formato internacional (ej: "51999999999").
 * @param {string} text - Texto a enviar.
 * @returns {Promise<{ success: boolean, messageCount?: number, error?: string }>}
 */
async function sendWhatsappMessage(to, text) {
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0";

  if (!WHATSAPP_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    functions.logger.error("❌ Configuración de WhatsApp incompleta: falta WHATSAPP_ACCESS_TOKEN o PHONE_NUMBER_ID.");
    return {
      success: false,
      error: "Faltan variables de entorno WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.",
    };
  }

  if (typeof text !== "string" || text.trim() === "") {
    functions.logger.error("❌ El texto del mensaje es inválido.", { text });
    return {
      success: false,
      error: "El texto del mensaje debe ser una cadena no vacía.",
    };
  }

  const MAX_LENGTH = 4096;
  const chunks = [];

  // 🧩 Dividir mensaje en partes si es necesario
  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    chunks.push(text.substring(i, i + MAX_LENGTH));
  }

  try {
    for (const [index, chunk] of chunks.entries()) {
      const response = await axios({
        method: "POST",
        url: `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: chunk },
        },
      });

      functions.logger.info(`✅ Mensaje ${index + 1}/${chunks.length} enviado correctamente a ${to}:`, response.data);
    }

    return { success: true, messageCount: chunks.length };

  } catch (error) {
    const errorData = error.response?.data || error.message;
    functions.logger.error("❌ Error al enviar mensaje de WhatsApp:", errorData);

    return {
      success: false,
      error: typeof errorData === "string" ? errorData : JSON.stringify(errorData),
    };
  }
}

module.exports = { sendWhatsappMessage };
