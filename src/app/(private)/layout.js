// src/app/(private)/layout.js
"use client";
import RutaProtegida from "@/components/RutaProtegida";

export default function PrivateLayout({ children }) {
  return <RutaProtegida>{children}</RutaProtegida>;
}
