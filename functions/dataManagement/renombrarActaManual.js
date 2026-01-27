const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const bucket = admin.storage().bucket();

const json = (res, code, body) => {
  res.set("Content-Type", "application/json");
  res.status(code).send(JSON.stringify(body));
};

const allowCors = (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
};

exports.renombrarActaManual = onRequest(async (req, res) => {
  try {
    if (allowCors(req, res)) return;

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, message: "Método no permitido" });
    }

    const { dateFolder, fromName, newName } = req.body || {};

    if (!dateFolder || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateFolder))) {
      return json(res, 400, { ok: false, message: "dateFolder inválido (YYYY-MM-DD)" });
    }

    if (!fromName || !String(fromName).toLowerCase().endsWith(".pdf")) {
      return json(res, 400, { ok: false, message: "fromName inválido (debe ser .pdf)" });
    }

    if (!newName || !String(newName).trim()) {
      return json(res, 400, { ok: false, message: "newName requerido" });
    }

    let finalNewName = String(newName).trim();
    if (!finalNewName.toLowerCase().endsWith(".pdf")) finalNewName += ".pdf";

    const srcPath = `guias_actas/actas_servicio/error/${dateFolder}/${fromName}`;
    const dstPath = `guias_actas/actas_servicio/ok/${dateFolder}/${finalNewName}`;

    const srcFile = bucket.file(srcPath);
    const [exists] = await srcFile.exists();
    if (!exists) {
      return json(res, 404, { ok: false, message: `No existe: ${srcPath}` });
    }

    // Mover dentro del mismo bucket
    await srcFile.move(dstPath);

    return json(res, 200, {
      ok: true,
      message: "Movido a OK",
      srcPath,
      dstPath,
    });
  } catch (e) {
    return json(res, 500, { ok: false, message: String(e?.message || e) });
  }
});
