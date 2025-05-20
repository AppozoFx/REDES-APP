"use client";

import { useAuth } from "@/app/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";


export default function RutaProtegida({ children }) {
  const { userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const rutasPublicas = ["/login"];
  const isRutaPublica = rutasPublicas.some((r) => pathname.startsWith(r));

  const [puedeRenderizar, setPuedeRenderizar] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!userData && !isRutaPublica) {
        router.push("/login");
      } else {
        setPuedeRenderizar(true);
      }
    }
  }, [loading, userData, isRutaPublica, router]);

  if (loading || !puedeRenderizar) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  return children;
}
