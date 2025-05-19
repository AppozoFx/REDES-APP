// src/firebaseConfig.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 🚨 Leemos las variables de entorno
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Inicializar Firebase
// Comprobamos si ya existe una instancia para evitar errores de reinicialización en HMR (Hot Module Replacement)
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp(); // Si ya existe, usamos la instancia existente
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Opcional: Verificar si las variables se cargaron (útil para depuración)
// console.log("Firebase Config Loaded:", {
//   apiKeyLoaded: !!firebaseConfig.apiKey,
//   projectIdLoaded: !!firebaseConfig.projectId,
// });