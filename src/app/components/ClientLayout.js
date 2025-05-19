"use client";

import { usePathname } from "next/navigation";
import LayoutApp from "./LayoutApp";
import RutaProtegida from "./RutaProtegida";


export default function ClientLayout({ children }) {
  const pathname = usePathname();

  const sinLayout = ["/login"];
  const isSinLayout = sinLayout.some((r) => pathname.startsWith(r));

  if (isSinLayout) {
    return (
      <RutaProtegida>
        {children}
      </RutaProtegida>
    );
  }

  return (
    <RutaProtegida>
      <LayoutApp>{children}</LayoutApp>
    </RutaProtegida>
  );
}
