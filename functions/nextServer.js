// functions/nextServer.js
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
module.exports.handleNextRequest = (req, res) => {
  return app.prepare().then(() => handle(req, res));
};