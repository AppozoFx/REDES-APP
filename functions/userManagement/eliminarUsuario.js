const functions = require("firebase-functions");
const { auth, db } = require("../utils/firebaseAdmin");
const corsHandler = require("../utils/cors");

exports.eliminarUsuarioLogic = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ error: "UID obligatorio" });
    }

    try {
      await auth.deleteUser(uid);
      await db.collection("usuarios").doc(uid).delete();

      functions.logger.info(`✅ Usuario eliminado: UID ${uid}`);
      return res.status(200).json({ success: true });
    } catch (error) {
      functions.logger.error(`❌ Error al eliminar usuario UID ${uid}:`, error);
      return res.status(500).json({
        error: "Error al eliminar el usuario",
        details: error.message,
      });
    }
  });
});
