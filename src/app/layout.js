// src/app/layout.js
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/context/AuthContext";     // ✅ usa alias si ya lo definiste
import ClientLayout from "@/components/ClientLayout";      // ✅ usa alias
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";


const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
  weight: ["300","400","500","600","700","800"],
});

const jetmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-ui",
  display: "swap",
});

export const metadata = { title: "Redes M&D", description: "App" };

// (Opcional) ayuda a PWA/tema
export const viewport = {
  themeColor: "#30518c",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <AuthProvider>
          <ClientLayout>{children}</ClientLayout>
          {/* Toaster global: no lo dupliques en páginas */}
          <Toaster position="top-right" reverseOrder={false} />
        </AuthProvider>
      </body>
    </html>
  );
}
