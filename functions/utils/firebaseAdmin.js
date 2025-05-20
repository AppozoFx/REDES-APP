const admin = require("firebase-admin");

// Inicialización única (evita error en entornos donde se recarga el código)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Servicios que usarás
const auth = admin.auth();               // 🔐 Autenticación
const db = admin.firestore();           // 📄 Firestore
const storage = admin.storage();        // 🗂️  Almacenamiento
const messaging = admin.messaging();    // 🔔 Notificaciones (si aplica)

// Exporte limpio y modular
module.exports = {
  admin,
  auth,
  db,
  storage,
  messaging,
};
