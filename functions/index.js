// functions/index.js
const functions = require("firebase-functions");

// -----------------------------------------------------------------------------
// Inicialización de Firebase Admin (si no usas utils/firebaseAdmin.js)
// const admin = require("firebase-admin");
// admin.initializeApp();
// export const db = admin.firestore(); // Exportar db y auth si es necesario globalmente
// export const authAdmin = admin.auth();
// -----------------------------------------------------------------------------


// Servidor Next.js
const nextServer = require("./nextServer");
exports.next = functions.https.onRequest(nextServer.handleNextRequest);

// Gestión de Usuarios
const userManagement = require("./userManagement/eliminarUsuario");
exports.eliminarUsuario = userManagement.eliminarUsuarioLogic;
const userManagementActualizarCorreo = require("./userManagement/actualizarCorreo");exports.actualizarCorreo = userManagementActualizarCorreo.actualizarCorreoLogic;

const userManagementVerificarUID = require("./userManagement/verificarUID");
exports.verificarUID = userManagementVerificarUID.verificarUIDLogic;

// Gestión de Datos
const dataManagementImportar = require("./dataManagement/importarInstalaciones");
exports.importarInstalaciones = dataManagementImportar.importarInstalacionesLogic;


// --- Agente de WhatsApp ---
const { procesarMensajeWhatsappLogic } = require("./whatsappAgent/webhookHandler");
exports.procesarMensajeWhatsapp = procesarMensajeWhatsappLogic;

// --- Exportar para Power BI ---
const {
  exportarLiquidacionesBI,
} = require("./dataManagement/exportarLiquidacionesBI");
exports.exportarLiquidacionesBI = exportarLiquidacionesBI;

const {
  exportarInstalacionesBI,
} = require("./dataManagement/exportarInstalacionesBI");
exports.exportarInstalacionesBI = exportarInstalacionesBI;

const {
  exportarStockEquiposBI,
} = require("./dataManagement/exportarStockEquiposBI");
exports.exportarStockEquiposBI = exportarStockEquiposBI;






// Si tienes otras funciones, impórtalas y expórtalas de manera similar
// Ejemplo:
// const otraFuncion = require("./otraCarpeta/otraFuncion");
// exports.miOtraFuncion = otraFuncion.miOtraFuncionLogic;