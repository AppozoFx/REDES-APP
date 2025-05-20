// src/app/login/page.js
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { motion } from "framer-motion";
import { auth } from "@/firebaseConfig"; // Correcto, usa el alias
import { Toaster, toast } from "react-hot-toast";
import Image from "next/image";
// 👁️ Agrega arriba junto a los imports:
import { Eye, EyeOff } from "lucide-react"; // Asegúrate de tener 'lucide-react' instalado


export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false); // Para la animación de éxito
  // 👇 Agrega al comienzo del componente:
const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setSuccess(true); // Activa la animación de éxito
      toast.success("Ingreso exitoso");
      setTimeout(() => {
        router.push("/dashboard"); // Redirige después de un breve delay
      }, 1500);
    } catch (error) {
      // Manejo de errores más específico
      let errorMessage = "Correo o contraseña incorrectos.";
      if (error.code) {
        switch (error.code) {
          case "auth/user-not-found":
          case "auth/wrong-password":
          case "auth/invalid-credential": // Nuevo código de error más genérico
            errorMessage = "Credenciales inválidas. Verifica tu correo y contraseña.";
            break;
          case "auth/invalid-email":
            errorMessage = "El formato del correo electrónico no es válido.";
            break;
          case "auth/user-disabled":
            errorMessage = "Esta cuenta ha sido deshabilitada.";
            break;
          default:
            errorMessage = "Ocurrió un error inesperado. Intenta de nuevo.";
            console.error("Error de login no manejado:", error);
        }
      } else {
        console.error("Error de login (sin código):", error);
      }
      toast.error(errorMessage);
    } finally {
      setLoading(false);
      // No resetear 'success' aquí para que la animación se complete
      // Si quieres que se pueda reintentar y ver la animación de nuevo,
      // necesitarías resetear 'success' en algún otro punto (ej. al cambiar email/password)
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-[#30518c] to-[#ff6413]">
      <Toaster /> {/* Asegúrate que Toaster esté aquí o en el layout principal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md"
      >
        {/* ... (resto de tu JSX para el logo y título) ... */}
        <div className="text-center mb-6">
          <Image
            src="/image/logo.png" // Asegúrate que esta ruta sea correcta desde la carpeta 'public'
            alt="Logo RedesMyD"
            width={80}
            height={80}
            className="mx-auto"
          />
          <h2 className="text-2xl font-bold text-gray-800 mt-2">
            Bienvenido
          </h2>
          <p className="text-sm text-gray-500">Ingresa tus credenciales</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Correo electrónico
            </label>
            <input
              type="email"
              className="w-full mt-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white" // Añadido soporte dark mode
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="usuario@correo.com"
              aria-label="Correo electrónico"
              disabled={loading || success} // Deshabilitar si está cargando o si el login fue exitoso
            />
          </div>

          <div>
  <label className="block text-sm font-medium text-gray-700">Contraseña</label>
  <div className="relative">
    <input
      type={showPassword ? "text" : "password"}
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      required
      disabled={loading || success}
      placeholder="••••••••"
      aria-label="Contraseña"
      className="w-full mt-1 px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
    />
    <button
      type="button"
      onClick={() => setShowPassword(!showPassword)}
      className="absolute top-2 right-3 text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
      tabIndex={-1}
    >
      {showPassword ? "🙈" : "👁️"}

    </button>
  </div>
</div>


          <button
            type="submit"
            disabled={loading || success} // Deshabilitar también si 'success' es true para evitar doble submit
            className="w-full bg-[#30518c] text-white py-2 rounded-lg font-semibold hover:bg-[#264477] transition duration-300 disabled:opacity-50"
          >
            {loading ? "Ingresando..." : (success ? "¡Éxito!" : "Iniciar Sesión")}
          </button>
        </form>

        {/* Animación de éxito (ya la tienes) */}
        {success && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1.2, opacity: 1 }} // Podrías cambiar scale a 1 para que no sea tan grande
            transition={{ duration: 0.4, type: "spring" }}
            className="mt-4 flex items-center justify-center"
          >
            <div className="bg-green-100 text-green-700 px-4 py-2 rounded-full shadow-md flex items-center space-x-2">
              <span className="text-xl">✅</span>
              <span className="text-sm font-medium">¡Ingreso exitoso! Redirigiendo...</span>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}