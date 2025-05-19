// functions/whatsappAgent/messageSender.js
const functions = require("firebase-functions");
const axios = require('axios');

async function sendWhatsappMessage(to, text) {
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // <--- CAMBIO
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;   // <--- CAMBIO
  const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0"; // <--- CAMBIO (o default)

  if (!WHATSAPP_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    functions.logger.error("MESSAGE_SENDER: Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en variables de entorno.");
    return { success: false, error: "Configuración de WhatsApp incompleta en el servidor para messageSender." };
  }

  //const WHATSAPP_ACCESS_TOKEN = config.whatsapp.access_token;
  //const PHONE_NUMBER_ID = config.whatsapp.phone_number_id;
  //const WHATSAPP_API_VERSION = config.whatsapp.api_version || "v19.0";

  const MAX_LENGTH = 4096;
  const chunks = [];
  if (typeof text !== 'string') {
      functions.logger.error("MESSAGE_SENDER: El texto del mensaje es inválido.", {text});
      return { success: false, error: "El texto del mensaje es inválido."};
  }
  for (let i = 0; i < text.length; i += MAX_LENGTH) {
      chunks.push(text.substring(i, i + MAX_LENGTH));
  }

  try {
    for (const chunk of chunks) {
      const response = await axios({
        method: "POST",
        url: `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: chunk },
        },
      });
      functions.logger.info("Mensaje de WhatsApp enviado:", response.data, "a", to);
    }
    return { success: true, messageCount: chunks.length };
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    functions.logger.error("Error enviando mensaje de WhatsApp:", errorData);
    return { success: false, error: errorData };
  }
}

module.exports = { sendWhatsappMessage };