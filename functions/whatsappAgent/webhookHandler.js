// functions/whatsappAgent/webhookHandler.js
const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const { procesarConGemini } = require("./geminiProcessor");
const { sendWhatsappMessage } = require("./messageSender");

exports.procesarMensajeWhatsappLogic = functions
  .https.onRequest(async (req, res) => {
    // LEER LA CONFIGURACIÓN USANDO process.env
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN; // <--- CAMBIO CRUCIAL

    functions.logger.info("VERIFY_TOKEN leído desde process.env:", VERIFY_TOKEN);
    functions.logger.info("Token recibido de Meta (si es GET):", req.query["hub.verify_token"]);

    if (!VERIFY_TOKEN) {
      functions.logger.error("WEBHOOK_HANDLER: WHATSAPP_VERIFY_TOKEN no encontrado en las variables de entorno de la función.");
      if (req.method === "GET") {
        res.sendStatus(500);
        return;
      }
    }

    // Verificación del Webhook (GET request)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode && token) {
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
          functions.logger.info("WEBHOOK_VERIFIED_SUCCESSFULLY");
          res.status(200).send(challenge);
        } else {
          functions.logger.error("Failed webhook verification. Token mismatch.", { receivedToken: token, expectedToken: VERIFY_TOKEN });
          res.sendStatus(403);
        }
      } else {
        functions.logger.warn("GET al webhook sin parámetros mode/token requeridos.");
        res.sendStatus(400);
      }
      return;
    }

    // Procesar mensajes entrantes (POST request)
    if (req.method === "POST") {
      const body = req.body;
      functions.logger.info("Mensaje de WhatsApp recibido:", JSON.stringify(body, null, 2));

      if (body.object === "whatsapp_business_account") {
        try {
          for (const entry of body.entry) {
            for (const change of entry.changes) {
              if (change.value.messages) {
                for (const message of change.value.messages) {
                  const from = message.from;
                  const messageType = message.type;
                  let userQuery = "";

                  if (messageType === "text") {
                    userQuery = message.text.body;
                  } else if (messageType === "interactive" && message.interactive) {
                    userQuery = message.interactive.button_reply?.title || message.interactive.list_reply?.title || "Acción interactiva";
                  } else {
                    functions.logger.info(`Tipo de mensaje no procesado: ${messageType}`);
                    await sendWhatsappMessage(from, "Lo siento, solo puedo procesar mensajes de texto por ahora.");
                    continue;
                  }

                  functions.logger.info(`Desde: ${from}, Tipo: ${messageType}, Consulta: ${userQuery}`);

                  if (userQuery) {
                    const geminiResponse = await procesarConGemini(userQuery, from);
                    await sendWhatsappMessage(from, geminiResponse);
                  }
                }
              }
            }
          }
          res.status(200).send("EVENT_RECEIVED");
        } catch (error) {
          functions.logger.error("Error procesando el webhook de WhatsApp:", error);
          res.status(500).send("INTERNAL_SERVER_ERROR");
        }
      } else {
        functions.logger.info("POST no es de 'whatsapp_business_account'. Body object:", body.object);
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(405); // Método no permitido si no es GET o POST
    }
  });