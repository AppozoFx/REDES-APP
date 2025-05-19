// src/app/layout.js
import "./globals.css";
import { Toaster, toast } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import ClientLayout from "./components/ClientLayout";

export const metadata = {
  title: "RedesMYD App",
  description: "App de asistencia, cuadrillas y almacén",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <ClientLayout>{children}</ClientLayout>
          <Toaster position="top-right" reverseOrder={false} /> {/* ✅ Aquí lo agregamos */}
        </AuthProvider>
      </body>
    </html>
  );
}
