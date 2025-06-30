const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const cors = require("../utils/cors");

exports.exportarStockEquiposBI = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const snapshotCuadrillas = await db.collection("cuadrillas").get();
      const stockEquipos = [];

      for (const doc of snapshotCuadrillas.docs) {
        const cuadrillaId = doc.id;
        const cuadrillaData = doc.data();
        const subSnapshot = await db.collection("cuadrillas").doc(cuadrillaId).collection("stock_equipos").get();

        subSnapshot.forEach(equipo => {
          stockEquipos.push({
            cuadrillaId,
            cuadrillaNombre: cuadrillaData.nombre ?? "",
            ...equipo.data(),
          });
        });
      }

      res.status(200).json(stockEquipos);
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});
