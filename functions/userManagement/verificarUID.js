const functions = require("firebase-functions");
const { auth } = require("../utils/firebaseAdmin");
const corsHandler = require("../utils/cors");

exports.verificarUIDLogic = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: "UID y Email son obligatorios" });
    }

    try {
      const user = await auth.getUser(uid);

      if (user.email !== email) {
        return res.status(400).json({ error: "El correo no coincide con el UID" });
      }

      return res.status(200).json({ exists: true });
    } catch (error) {
      functions.logger.warn(`Verificación de UID fallida para ${uid}:`, error.message);
      return res.status(404).json({ exists: false, error: "UID no válido o no existe" });
    }
  });
});
