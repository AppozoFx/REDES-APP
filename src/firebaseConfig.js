// src/firebaseConfig.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, setPersistence, browserSessionPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 🚨 Variables de entorno
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Inicializar Firebase con HMR-safe
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ⚠️ Auth primero (necesario para setPersistence)
export const auth = getAuth(app);

// ✅ Persistencia por pestaña: mantiene sesión en refresh, la pierde al cerrar pestaña/ventana
if (typeof window !== "undefined") {
  setPersistence(auth, browserSessionPersistence).catch((err) => {
    // No rompe la app si falla; solo loguea
    console.error("No se pudo aplicar browserSessionPersistence:", err);
  });
}

export const db = getFirestore(app);
export const storage = getStorage(app);

// export default app; // opcional si lo usas en otros módulos
