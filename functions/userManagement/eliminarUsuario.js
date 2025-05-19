const functions = require("firebase-functions");
const { auth, db } = require("../utils/firebaseAdmin"); // Asumiendo que creaste firebaseAdmin.js
const corsHandler = require("../utils/cors"); // Asumiendo que creaste cors.js

exports.eliminarUsuarioLogic = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "Falta el UID" });
    }
    try {
      await auth.deleteUser(uid);
      await db.collection("usuarios").doc(uid).delete();
      functions.logger.info(`Usuario ${uid} eliminado correctamente.`);
      return res.status(200).json({ success: true });
    } catch (error) {
      functions.logger.error(`Error al eliminar usuario ${uid}:`, error);
      return res.status(500).json({
        error: "No se pudo eliminar el usuario",
        details: error.message,
      });
    }
  });
});