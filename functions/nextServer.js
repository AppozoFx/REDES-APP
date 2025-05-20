const next = require("next");

const app = next({
  dev: false,
  conf: {
    distDir: ".next",
  },
});

const handle = app.getRequestHandler();

// Exportamos la función que maneja la request de Next.js
// para que pueda ser llamada desde index.js
module.exports.handleNextRequest = async (req, res) => {
  try {
    await app.prepare();
    return handle(req, res);
  } catch (err) {
    console.error("❌ Error al preparar Next.js:", err);
    res.status(500).send("Internal Server Error: " + err.message);
  }
};

