const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const cors = require("../utils/cors");

exports.exportarInstalacionesBI = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const snapshot = await db.collection("instalaciones").get();
      const datos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.status(200).json(datos);
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});
