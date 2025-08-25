// src/app/components/RutaProtegida.js
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function RutaProtegida({ children }) {
  const { userData, initializing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const redirected = useRef(false);
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    if (initializing) return;

    // Si NO hay sesión y no estamos ya en /login, redirige una sola vez
    if (!userData) {
      if (!redirected.current && pathname !== "/login") {
        redirected.current = true;
        router.replace("/login");
      }
      setCanRender(false);
      return;
    }

    // Con sesión: permite renderizar
    setCanRender(true);
  }, [initializing, userData, pathname, router]);

  if (initializing) return null;
  if (!canRender) return null;

  return <>{children}</>;
}
