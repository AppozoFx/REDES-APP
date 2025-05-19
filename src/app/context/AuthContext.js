// src/app/context/AuthContext.js
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/firebaseConfig"; // ¡Verifica esta ruta!

// ... (resto de tu código de AuthContext)// Crear el contexto
const AuthContext = createContext();

// Hook para acceder al contexto desde cualquier componente
export const useAuth = () => useContext(AuthContext);

// Proveedor del contexto
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);          // Usuario autenticado
  const [userData, setUserData] = useState(null);  // Datos desde Firestore
  const [loading, setLoading] = useState(true);    // Estado de carga

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          const docRef = doc(db, "usuarios", firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          setUserData(docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null);
        } catch (error) {
          console.error("Error al obtener datos del usuario:", error);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, userData, loading }}>
      {children}
    </AuthContext.Provider>
  );
}