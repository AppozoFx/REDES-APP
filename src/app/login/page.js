// src/app/login/page.js
"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from "firebase/auth";
import { motion } from "framer-motion";
import Image from "next/image";
import { toast } from "react-hot-toast";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { auth } from "@/firebaseConfig";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const safeEmail = email.trim().toLowerCase();
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, safeEmail, password);
      setSuccess(true);
      toast.success("Ingreso exitoso");
      // ⛔️ no redirigimos aquí; / (page.js) decidirá /login o /dashboard
    } catch (error) {
      let msg = "Ocurrió un error inesperado. Intenta de nuevo.";
      switch (error?.code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          msg = "Credenciales inválidas. Verifica tu correo y contraseña.";
          break;
        case "auth/invalid-email":
          msg = "El formato del correo electrónico no es válido.";
          break;
        case "auth/user-disabled":
          msg = "Esta cuenta ha sido deshabilitada.";
          break;
        case "auth/too-many-requests":
          msg = "Demasiados intentos. Intenta de nuevo en unos minutos.";
          break;
        case "auth/network-request-failed":
          msg = "Sin conexión o red inestable. Revisa tu internet.";
          break;
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Fondo degradado con acentos */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f1a2e] via-[#1e3a8a] to-[#ff6413]" />
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-orange-300/20 blur-3xl" />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Tarjeta “glass” */}
          <div className="rounded-2xl border border-white/15 bg-white/80 p-8 shadow-2xl backdrop-blur-xl dark:bg-white/10">
            {/* Header */}
            <div className="mb-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/70 shadow dark:bg-white/20">
                <Image src="/image/logo.png" alt="Logo RedesMyD" width={40} height={40} priority />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
                Bienvenido a <span className="text-[#ff6413]">RedesMYD</span>
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Ingresa tus credenciales para continuar
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-5" aria-busy={loading}>
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                  Correo electrónico
                </label>
                <div className="relative mt-1">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (success) setSuccess(false); }}
                    required
                    disabled={loading || success}
                    placeholder="usuario@correo.com"
                    aria-label="Correo electrónico"
                    className="w-full rounded-xl border border-gray-300 bg-white/90 px-4 py-2.5 text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400 dark:border-white/20 dark:bg-white/10 dark:text-white"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Usa tu correo corporativo.</p>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                  Contraseña
                </label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (success) setSuccess(false); }}
                    required
                    disabled={loading || success}
                    placeholder="••••••••"
                    aria-label="Contraseña"
                    aria-describedby="password-hint"
                    className="w-full rounded-xl border border-gray-300 bg-white/90 px-4 py-2.5 pr-11 text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400 dark:border-white/20 dark:bg-white/10 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 mr-3 flex items-center text-gray-500 transition hover:scale-110 hover:text-gray-700 disabled:opacity-50 dark:text-gray-300 dark:hover:text-white"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    tabIndex={0}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <p id="password-hint" className="mt-1 text-xs text-gray-500 dark:text-gray-400">Mínimo 8 caracteres.</p>
              </div>

              {/* Botón */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading || success}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#30518c] px-4 py-2.5 font-semibold text-white shadow-lg transition hover:bg-[#264477] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                    </svg>
                    Ingresando…
                  </>
                ) : success ? (
                  <>✅ ¡Éxito!</>
                ) : (
                  <>
                    <LogIn size={18} className="transition group-hover:translate-x-0.5" />
                    Iniciar Sesión
                  </>
                )}
              </motion.button>
            </form>

            {/* Éxito */}
            {success && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4 flex items-center justify-center"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700 shadow dark:bg-green-900/30 dark:text-green-300">
                  <span>Ingreso exitoso. Redirigiendo…</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-white/80">
            © {new Date().getFullYear()} RedesMYD • Desarrollado por Arturo Pozo
          </div>
        </motion.div>
      </div>
    </div>
  );
}
