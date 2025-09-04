// src/app/page.js
"use client";


import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { userData, initializing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const redirected = useRef(false);

  useEffect(() => {
    if (initializing || redirected.current) return;
    // Evita redirigir si ya estamos en la ruta destino
    if ((userData && pathname === "/dashboard") || (!userData && pathname === "/login")) return;
    redirected.current = true;
    router.replace(userData ? "/dashboard" : "/login");
  }, [initializing, userData, router, pathname]);

  return null;
}
