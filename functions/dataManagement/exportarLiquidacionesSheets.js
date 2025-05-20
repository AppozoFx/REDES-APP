const functions = require("firebase-functions");
const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");
const { admin, db } = require("../utils/firebaseAdmin");

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = "1pCNR30_UTvmwUUNpqi5tSeuU38Qugt6OfNMA0ZtYSVo";
const SHEET_NAME = "Instalaciones-Liquidadas";
const TIME_ZONE = "America/Lima";
const LOCALE = "es-PE";

// --- Función para formatear fechas ---
function formatFechaInstalacion(fecha) {
  if (!fecha) return "";
  let dateToFormat;

  if (fecha instanceof admin.firestore.Timestamp) {
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

function parseDateString(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})$/);
  if (!parts) return null;
  return new Date(
    parseInt(parts[3], 10), parseInt(parts[2], 10) - 1, parseInt(parts[1], 10),
    parseInt(parts[4], 10), parseInt(parts[5], 10), parseInt(parts[6], 10)
  );
}

exports.exportarLiquidacionesASheetsLogic = functions.https.onCall(async (data, context) => {
  try {
    const authClient = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await authClient.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    functions.logger.info(`Iniciando exportación a Spreadsheet ID: ${SPREADSHEET_ID}, Hoja: "${SHEET_NAME}"`);

    const snapshot = await db.collection("liquidacion_instalaciones").get();

    if (snapshot.empty) {
      functions.logger.warn("No se encontraron documentos en la colección.");
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:ZZ`,
      });
      functions.logger.info(`Hoja "${SHEET_NAME}" limpiada.`);
      return { success: true, message: "No se encontraron documentos para exportar. Hoja limpiada.", count: 0 };
    }

    functions.logger.info(`Se encontraron ${snapshot.size} documentos.`);

    const headers = [
      "Tipo Servicio", "Fecha Instalación", "Tipo Cuadrilla", "R_C", "Cuadrilla",
      "Coordinador", "Código Cliente", "DNI_CE", "Cliente", "SN-ONT",
      "PROID-ONT", "SN-MESH", "SN-BOX", "SN-FONO", "Plan", "Dirección",
      "Plan Gamer", "Kit Wifi Pro", "Servicio Cableado Mesh", "Cat 5e",
      "Cat 6", "Cable UTP", "Observación",
    ];

    const dataRows = snapshot.docs.map(doc => {
      const d = doc.data();
      return [
        d.tipoServicio ?? null,
        formatFechaInstalacion(d.fechaInstalacion),
        d.tipoCuadrilla ?? null,
        d.residencialCondominio ?? null,
        d.cuadrillaNombre ?? null,
        d.coordinadorCuadrilla ?? null,
        d.codigoCliente ?? null,
        d.documento ?? null,
        d.cliente ?? null,
        Array.isArray(d.snONT) ? d.snONT.join(", ") : d.snONT ?? null,
        Array.isArray(d.proidONT) ? d.proidONT.join(", ") : d.proidONT ?? null,
        Array.isArray(d.snMESH) ? d.snMESH.join(", ") : d.snMESH ?? null,
        Array.isArray(d.snBOX) ? d.snBOX.join(", ") : d.snBOX ?? null,
        Array.isArray(d.snFONO) ? d.snFONO.join(", ") : d.snFONO ?? null,
        d.plan ?? null,
        d.direccion ?? null,
        d.planGamer ?? null,
        d.kitWifiPro ?? null,
        d.servicioCableadoMesh ?? null,
        d.cat5e ?? null,
        d.cat6 ?? null,
        d.cableUTP ?? null,
        d.observacion ?? null,
      ];
    });

    functions.logger.info(`Datos preparados. ${dataRows.length} filas de datos.`);

    // Orden personalizado
    const customOrderCuadrillas = [
      "K1 RESIDENCIAL", "K2 RESIDENCIAL", "K3 RESIDENCIAL", "K4 RESIDENCIAL", "K5 RESIDENCIAL",
      "K6 RESIDENCIAL", "K7 RESIDENCIAL", "K8 RESIDENCIAL", "K9 RESIDENCIAL", "K10 RESIDENCIAL",
      "K11 RESIDENCIAL", "K12 RESIDENCIAL", "K13 RESIDENCIAL", "K14 RESIDENCIAL", "K15 RESIDENCIAL",
      "K16 RESIDENCIAL", "K17 RESIDENCIAL", "K18 RESIDENCIAL", "K19 RESIDENCIAL", "K20 RESIDENCIAL",
      "K21 RESIDENCIAL", "K22 RESIDENCIAL", "K23 RESIDENCIAL", "K24 RESIDENCIAL", "K25 RESIDENCIAL",
      "K26 RESIDENCIAL", "K27 RESIDENCIAL", "K28 RESIDENCIAL",
      "K1 MOTO", "K2 MOTO", "K3 MOTO", "K4 MOTO", "K5 MOTO", "K6 MOTO", "K7 MOTO", "K8 MOTO",
      "K9 MOTO", "K10 MOTO", "K11 MOTO", "K12 MOTO", "K13 MOTO", "K14 MOTO", "K15 MOTO", "K16 MOTO",
      "K17 MOTO", "K18 MOTO", "K19 MOTO", "K20 MOTO", "K21 MOTO", "K22 MOTO", "K23 MOTO",
      "K24 MOTO", "K25 MOTO", "K26 MOTO", "K27 MOTO", "K28 MOTO", "K29 MOTO", "K30 MOTO",
      "K31 MOTO", "K32 MOTO", "K33 MOTO", "K34 MOTO"
    ];
    const cuadrillaOrderMap = new Map(customOrderCuadrillas.map((item, i) => [item, i]));

    dataRows.sort((a, b) => {
      const fechaA = parseDateString(a[1]);
      const fechaB = parseDateString(b[1]);

      if (!fechaA && fechaB) return 1;
      if (fechaA && !fechaB) return -1;
      if (fechaA && fechaB) {
        const diff = fechaA.getTime() - fechaB.getTime();
        if (diff !== 0) return diff;
      }

      const ordenA = cuadrillaOrderMap.get(a[4]?.trim()) ?? Infinity;
      const ordenB = cuadrillaOrderMap.get(b[4]?.trim()) ?? Infinity;
      return ordenA - ordenB;
    });

    const finalRowsToWrite = [headers, ...dataRows];
    const clearRange = `${SHEET_NAME}!A1:AA${finalRowsToWrite.length + 50}`;

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: clearRange,
    });

    functions.logger.info(`Escribiendo ${finalRowsToWrite.length} filas en "${SHEET_NAME}"...`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: finalRowsToWrite },
    });

    functions.logger.info(`Exportación completada. ${dataRows.length} filas escritas.`);

    return {
      success: true,
      message: `Exportación completada exitosamente. Se procesaron ${dataRows.length} registros.`,
      count: dataRows.length,
    };
  } catch (error) {
    functions.logger.error("Error durante la exportación y ordenación:", error);
    throw new functions.https.HttpsError(
      "internal",
      `Error interno del servidor: ${error.message}`,
      { originalError: error.toString() }
    );
  }
});
