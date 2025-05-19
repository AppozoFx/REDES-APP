// functions/dataManagement/exportarLiquidacionesSheets.js
const functions = require("firebase-functions");
const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");
const { db } = require("../utils/firebaseAdmin"); // Asumiendo firebaseAdmin.js

// --- CONFIGURACIÓN --- (Considera mover a variables de entorno de Functions)
const SPREADSHEET_ID = "1pCNR30_UTvmwUUNpqi5tSeuU38Qugt6OfNMA0ZtYSVo";
const SHEET_NAME = "Instalaciones-Liquidadas";
const TIME_ZONE = "America/Lima";
const LOCALE = "es-PE";
// --------------------

function formatFechaInstalacion(fecha) {
  // ... (tu lógica de formateo de fecha)
  if (!fecha) return "";
  let dateToFormat;

  if (fecha instanceof db.Timestamp) { // Usar admin.firestore.Timestamp si usas firebaseAdmin
    dateToFormat = fecha.toDate();
  } else if (typeof fecha === "object" && fecha && typeof fecha._seconds === "number") {
    dateToFormat = new Date(fecha._seconds * 1000);
  } else if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}T/.test(fecha)) {
    dateToFormat = new Date(fecha);
  } else if (fecha instanceof Date) {
    dateToFormat = fecha;
  } else {
    return fecha.toString();
  }

  return dateToFormat.toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

const parseDateString = (dateStr) => {
    // ... (tu lógica de parseo)
    if (!dateStr || typeof dateStr !== "string") return null;
    const parts = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})$/);
    if (!parts) return null;
    return new Date(
        parseInt(parts[3], 10), parseInt(parts[2], 10) - 1, parseInt(parts[1], 10),
        parseInt(parts[4], 10), parseInt(parts[5], 10), parseInt(parts[6], 10),
    );
};

// La función en sí
// Renombra la función exportada para evitar conflictos de nombres si es necesario.
exports.exportarLiquidacionesASheetsLogic = functions.https.onCall(async (data, context) => {
    // Verificación de autenticación (opcional, pero recomendado para onCall)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'La función debe ser llamada mientras se está autenticado.');
    // }
    // // Verificación de roles (opcional)
    // const userRecord = await admin.auth().getUser(context.auth.uid);
    // const userRoles = userRecord.customClaims && userRecord.customClaims.rol;
    // if (!userRoles || !userRoles.includes('TI')) { // Ejemplo de rol
    //   throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para ejecutar esta acción.');
    // }

    const authClient = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        // Podrías necesitar configurar las credenciales aquí si no usas el service account por defecto de Functions
    });
    const client = await authClient.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    functions.logger.info(`Iniciando exportación a Spreadsheet ID: <span class="math-inline">\{SPREADSHEET\_ID\}, Hoja\: "</span>{SHEET_NAME}"`);

    try {
        functions.logger.info("Leyendo documentos de 'liquidacion_instalaciones'...");
        const snapshot = await db.collection("liquidacion_instalaciones").get();

        if (snapshot.empty) {
            functions.logger.warn("No se encontraron documentos en la colección.");
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A1:ZZ`,
            });
            functions.logger.info(`Hoja "${SHEET_NAME}" limpiada.`);
            return { success: true, message: "No se encontraron documentos para exportar. Hoja limpiada.", count: 0 };
        }
        functions.logger.info(`Se encontraron ${snapshot.size} documentos.`);

        const headers = [/* ... tus headers ... */];
        const dataRows = [];
        snapshot.forEach((doc) => { /* ... tu lógica para poblar dataRows ... */ });
        // ... (resto de tu lógica de ordenamiento y escritura en Sheets) ...

        functions.logger.info("Ordenando datos...");
        const customOrderCuadrillas = [ /* ... tu array de orden ... */ ];
        const cuadrillaOrderMap = new Map(customOrderCuadrillas.map((item, index) => [item, index]));

        dataRows.sort((a, b) => { /* ... tu lógica de ordenamiento ... */ });
        functions.logger.info("Datos ordenados.");

        const finalRowsToWrite = [headers, ...dataRows];
        const maxRowsExpected = dataRows.length + 50;
        const clearRange = `<span class="math-inline">\{SHEET\_NAME\}\!A1\:AA</span>{maxRowsExpected > 1 ? maxRowsExpected : 1000}`;

        functions.logger.info(`Limpiando rango "<span class="math-inline">\{clearRange\}" en hoja "</span>{SHEET_NAME}"...`);
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID, range: clearRange,
        });
        functions.logger.info("Hoja limpiada.");

        functions.logger.info(`Escribiendo <span class="math-inline">\{finalRowsToWrite\.length\} filas en "</span>{SHEET_NAME}"...`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A1`,
            valueInputOption: "USER_ENTERED", resource: { values: finalRowsToWrite },
        });

        functions.logger.info(`Exportación completada. ${dataRows.length} filas de datos escritas.`);
        return {
            success: true,
            message: `Exportación completada exitosamente. Se procesaron ${dataRows.length} registros.`,
            count: dataRows.length,
        };
    } catch (error) {
        functions.logger.error("Error durante la exportación y ordenación:", error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError(
            "internal", `Error interno del servidor: ${error.message}`, { originalError: error.toString() },
        );
    }
});