const functions = require("firebase-functions");
const { db } = require("../utils/firebaseAdmin");
const corsHandler = require("../utils/cors");

// La lógica interna de tu función importarInstalaciones
// Asegúrate de usar functions.logger.info/error
// y de retornar las respuestas como en los ejemplos anteriores.

exports.importarInstalacionesLogic = functions.https.onRequest(
  { memory: "512MiB", timeoutSeconds: 120 },
  (req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Método no permitido" });
      }
      try {
        const { instalaciones, usuario } = req.body;
        if (!Array.isArray(instalaciones)) {
          return res.status(400).json({ success: false, message: "Formato inválido" });
        }

        let nuevos = 0;
        let actualizados = 0;
        let duplicadosSinCambios = 0;

        for (const item of instalaciones) {
          const ref = db.collection("instalaciones").doc(item.id); // Asegúrate que item.id exista y sea el correcto
          const snap = await ref.get();

          const campos = {
            tipoServicio: item.tipoServicio,
            fechaInstalacion: item.fechaInstalacion,
            dia: item.dia,
            tramo: item.tramo,
            cliente: item.cliente,
            tipoInstalacion: item.tipoInstalacion,
            residencialCondominio: item.residencialCondominio,
            cuadrilla: item.cuadrilla,
            cuadrillaId: item.cuadrillaId || "",
            cuadrillaNombre: item.cuadrillaNombre || "",
            tipoCuadrilla: item.tipoCuadrilla || "",
            zonaCuadrilla: item.zonaCuadrilla || "",
            gestorCuadrilla: item.gestorCuadrilla || "",
            coordinadorCuadrilla: item.coordinadorCuadrilla || "",
            estado: item.estado,
            direccion: item.direccion,
            plan: item.plan,
            region: item.region,
            zona: item.zona,
            codigoCliente: item.codigoCliente,
            documento: item.documento,
            telefono: item.telefono,
            horaFin: item.horaFin,
            horaInicio: item.horaInicio,
            motivoCancelacion: item.motivoCancelacion,
            coordenadas: item.coordenadas || null,
            fSoliOriginal: item.fSoliOriginal || "",
            horaEnCamino: item.horaEnCamino,
            ...(item.planGamer ? { planGamer: item.planGamer } : {}),
            ...(item.cat6 ? { cat6: item.cat6 } : {}),
            ...(item.kitWifiPro ? { kitWifiPro: item.kitWifiPro } : {}),
            ...(item.servicioCableadoMesh ? { servicioCableadoMesh: item.servicioCableadoMesh } : {}),
            ...(item.cantMESHwin ? { cantMESHwin: item.cantMESHwin } : {}),
            ...(item.cantFONOwin ? { cantFONOwin: item.cantFONOwin } : {}),
            ...(item.cantBOXwin ? { cantBOXwin: item.cantBOXwin } : {}),
          };

          if (snap.exists) {
            const prev = snap.data();
            const sinCambios = Object.entries(campos).every(([k, v]) => {
              return (prev[k] || "") === (v || "");
            });

            if (sinCambios) {
              duplicadosSinCambios++;
            } else {
              await ref.update({
                ...campos,
                modificadoEn: new Date().toISOString(), // O admin.firestore.FieldValue.serverTimestamp() si lo prefieres
                modificadoPor: usuario || "Desconocido",
              });
              actualizados++;
            }
          } else {
            await ref.set({
              id: item.id, // Asegúrate que el ID se guarde si es necesario
              ...campos,
              creadoEn: new Date().toISOString(), // O admin.firestore.FieldValue.serverTimestamp()
              creadoPor: usuario || "Desconocido",
            });
            nuevos++;
          }
        }
        functions.logger.info("Importación de instalaciones completada.", {nuevos, actualizados, duplicadosSinCambios});
        return res.status(200).json({
          success: true,
          nuevos,
          actualizados,
          duplicadosSinCambios,
          usuario,
          fecha: new Date().toISOString(),
        });
      } catch (err) {
        functions.logger.error("Error al importar instalaciones:", err);
        return res.status(500).json({ success: false, message: "Error interno del servidor", details: err.message });
      }
    });
  }
);