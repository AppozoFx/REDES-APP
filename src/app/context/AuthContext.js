"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/firebaseConfig";

// Estado del contexto
const AuthContext = createContext({
  user: null,
  userData: null,
  initializing: true,
});

// Hook
export const useAuth = () => useContext(AuthContext);

// Provider
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          const snap = await getDoc(doc(db, "usuarios", firebaseUser.uid));
          setUserData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        } catch (err) {
          console.warn("Error al obtener datos del usuario:", err?.code || err?.message);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }

      setInitializing(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, userData, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}
