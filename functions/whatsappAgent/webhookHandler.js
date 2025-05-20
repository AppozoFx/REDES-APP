const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const { procesarConGemini } = require("./geminiProcessor");
const { sendWhatsappMessage } = require("./messageSender");

exports.procesarMensajeWhatsappLogic = functions.https.onRequest(async (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  functions.logger.info("VERIFY_TOKEN leído desde process.env:", VERIFY_TOKEN);

  // ✅ VERIFICACIÓN DE TOKEN - GET
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!VERIFY_TOKEN) {
      functions.logger.error("WHATSAPP_VERIFY_TOKEN no está configurado en las variables de entorno.");
      return res.sendStatus(500);
    }

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      functions.logger.info("WEBHOOK_VERIFIED_SUCCESSFULLY");
      return res.status(200).send(challenge);
    } else {
      functions.logger.warn("Fallo en la verificación del Webhook. Token incorrecto.");
      return res.sendStatus(403);
    }
  }

  // ✅ PROCESAMIENTO DE MENSAJES - POST
  if (req.method === "POST") {
    const body = req.body;
    functions.logger.info("Mensaje recibido de WhatsApp:", JSON.stringify(body, null, 2));

    if (body.object === "whatsapp_business_account") {
      try {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const messages = change.value?.messages;
            if (!messages) continue;

            for (const message of messages) {
              const from = message.from;
              const messageType = message.type;
              let userQuery = "";

              // 🧠 Extraer texto del mensaje según su tipo
              if (messageType === "text") {
                userQuery = message.text.body;
              } else if (messageType === "interactive") {
                const interactive = message.interactive;
                userQuery =
                  interactive?.button_reply?.title ||
                  interactive?.list_reply?.title ||
                  "Interacción recibida";
              } else {
                functions.logger.info(`Tipo de mensaje no procesado: ${messageType}`);
                await sendWhatsappMessage(from, "🛑 Solo puedo procesar mensajes de texto por ahora.");
                continue;
              }

              functions.logger.info(`Desde: ${from} | Tipo: ${messageType} | Texto: "${userQuery}"`);

              if (userQuery) {
                const geminiResponse = await procesarConGemini(userQuery, from);
                await sendWhatsappMessage(from, geminiResponse);
              }
            }
          }
        }

        return res.status(200).send("EVENT_RECEIVED");
      } catch (error) {
        functions.logger.error("❌ Error al procesar mensaje de WhatsApp:", error);
        return res.status(500).send("INTERNAL_SERVER_ERROR");
      }
    } else {
      functions.logger.info("🔍 No es evento de 'whatsapp_business_account'.");
      return res.sendStatus(404);
    }
  }

  // ⚠️ Método no permitido
  return res.sendStatus(405);
});
