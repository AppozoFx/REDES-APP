// src/app/page.js
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { userData, initializing } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (initializing || redirected.current) return;
    redirected.current = true; // evita múltiples replace en montajes/re-renders
    router.replace(userData ? "/dashboard" : "/login");
  }, [initializing, userData, router]);

  return null;
}
