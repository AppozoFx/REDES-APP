const functions = require("firebase-functions");
const { auth, db } = require("../utils/firebaseAdmin");
const corsHandler = require("../utils/cors");

exports.actualizarCorreoLogic = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    try {
      await auth.updateUser(uid, { email }); // 🔐 Firebase Auth
      await db.collection("usuarios").doc(uid).update({ email }); // 📄 Firestore

      functions.logger.info(`Correo actualizado para UID ${uid}.`);
      return res.status(200).json({ success: true });
    } catch (error) {
      functions.logger.error(`Error al actualizar correo para UID ${uid}:`, error);
      return res.status(500).json({
        error: "Error al actualizar el correo",
        details: error.message,
      });
    }
  });
});
