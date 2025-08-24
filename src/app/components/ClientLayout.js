"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import LayoutApp from "./LayoutApp";

// rutas públicas (normalizadas sin trailing slash)
const isPublicRoute = (pathname) => {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, "");
  // agrega aquí otras públicas si las tienes (p. ej. "/recuperar")
  return p === "" || p === "/login";
};

export default function ClientLayout({ children }) {
  const { user, initializing } = useAuth();
  const pathname = usePathname() || "/";
  const router = useRouter();

  const publicRoute = isPublicRoute(pathname);

  // evita replace en bucle
  const lastRedirect = useRef(null);
  const safeReplace = (to) => {
    if (!to) return;
    if (to === pathname) return;                 // ya estoy ahí
    if (lastRedirect.current === to) return;     // mismo destino previo
    lastRedirect.current = to;
    router.replace(to);
  };

  useEffect(() => {
    if (initializing) return;

    // SIN sesión → rutas privadas van a /login
    if (!user && !publicRoute) {
      safeReplace("/login");
      return;
    }

    // CON sesión → rutas públicas van a /dashboard
    if (user && publicRoute) {
      safeReplace("/dashboard");
      return;
    }

    // si no redirige, libera memo del último destino
    lastRedirect.current = null;
  }, [initializing, user, publicRoute, pathname]);

  // splash durante onAuthStateChanged
  if (initializing) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
          </svg>
          <span>Cargando…</span>
        </div>
      </div>
    );
  }

  // públicas: sin layout
  if (publicRoute) return <>{children}</>;

  // privadas: con layout
  return <LayoutApp>{children}</LayoutApp>;
}
