// /src/app/components/LayoutApp.js
"use client";

import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/firebaseConfig";
import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Menu, X, LayoutDashboard, Users, HardDrive, CalendarPlus, ClipboardList, Settings, Truck,
  ContactRound, PhoneCall, MapPinned, Building2, HandCoins, PackageSearch, Archive, ShoppingCart,
  Package, PackageOpen, FileStack, UserRoundSearch, UserPlus, TrafficCone, CheckCircle,
  FileChartColumn, ChevronDown, Archive as IconoGrupoAlmacen, UsersRound as IconoGrupoAdministracion,
  DollarSign as IconoGrupoLiquidacion, Building as IconoGrupoInstalaciones, ListChecks as IconoGrupoAsistencia,
  Wrench as IconoGrupoConfiguracion, UploadCloud, Home
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Notificaciones from "@/app/components/Notificaciones";
import NotificacionFlotante from "@/app/components/NotificacionFlotante";
const I = (Comp, size = 16) => <Comp size={size} strokeWidth={1.75} />;

/* ----------------- helpers ----------------- */
const cn = (...arr) => arr.filter(Boolean).join(" ");

/* ----------------- Sidebar Link ----------------- */
function SidebarLink({ href, icon, label, open, isSubItem = false }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 transition-all",
        isSubItem ? "py-1.5 pl-2 text-[12px] font-medium" : "py-2.5 text-sm font-medium",
        isActive
          ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] font-semibold shadow-[inset_0_0_0_1px_rgba(48,81,140,.15)]"
          : "text-[color:var(--muted-ink)] hover:text-[color:var(--brand)] hover:bg-white/70 dark:hover:bg-white/10"
      )}
    >
      {/* indicador lateral */}
      <span
        className={cn(
          "absolute left-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full transition",
          isActive ? "bg-[color:var(--brand)] shadow-[0_0_10px_rgba(48,81,140,.55)]" : "bg-transparent"
        )}
        aria-hidden="true"
      />
      <span className={isSubItem ? "h-4 w-4" : "h-5 w-5"}>{icon}</span>

      {open ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="pointer-events-none absolute left-full top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100">
          {label}
        </span>
      )}
    </Link>
  );
}

/* ----------------- Sidebar Group ----------------- */
function SidebarItem({ item, open, currentPathname, activeGroup, setActiveGroup }) {
  const isSubItemActive = item.subItems && item.subItems.some((sub) => currentPathname === sub.href);
  const isActive = currentPathname === item.href || isSubItemActive;
  const isSubmenuOpen = item.subItems ? activeGroup === item.id : false;

  useEffect(() => {
    if (isSubItemActive && activeGroup !== item.id) setActiveGroup(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubItemActive, item.id, setActiveGroup, currentPathname]);

  if (!item.subItems?.length) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setActiveGroup(isSubmenuOpen ? null : item.id)}
        aria-expanded={isSubmenuOpen}
        aria-controls={`submenu-${item.id}`}
        className={cn(
          "group relative mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
          "transition-colors hover:bg-white/70 dark:hover:bg-white/10",
          isActive ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)] font-semibold" : "text-[color:var(--muted-ink)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/35"
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-[18px]">{item.icon}</span>
          {open && <span className="truncate">{item.label}</span>}
        </div>
        {open && (
          <span className={cn("transform transition-transform", isSubmenuOpen ? "rotate-180" : "rotate-0")}>
            <ChevronDown size={16} />
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && isSubmenuOpen && (
          <motion.div
            id={`submenu-${item.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="ml-3 mt-1 flex flex-col space-y-0.5 border-l border-[color:var(--line)] pl-3"
          >
            {item.subItems.map((subItem) => (
              <SidebarLink
                key={subItem.href}
                href={subItem.href}
                icon={subItem.icon}
                label={subItem.label}
                open={open}
                isSubItem
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ----------------- Layout principal ----------------- */
export default function LayoutApp({ children }) {
  const { userData, initializing } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeGroup, setActiveGroup] = useState(null);
  const router = useRouter();
  const pathname = usePathname();

  // persistencia sidebar
  useEffect(() => {
    const saved = localStorage.getItem("sidebarOpen");
    if (saved !== null) setSidebarOpen(saved === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem("sidebarOpen", String(sidebarOpen));
    if (!sidebarOpen) setActiveGroup(null);
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await signOut(auth);
    router.replace("/login");
  };

  const hasAnyRole = (roles) => {
    if (!userData?.rol) return false;
    return Array.isArray(userData.rol)
      ? roles.some((r) => userData.rol.includes(r))
      : roles.includes(userData.rol);
  };

  const allSidebarItems = [
  {
    id: "general",
    label: "Principal",
    icon: I(Home, 20),
    roles: ["Gestor","Gerencia","Almacén","TI","Supervisor","RRHH","Seguridad"],
    subItems: [
      { href: "/dashboard", label: "Dashboard", icon: I(LayoutDashboard), roles: ["Gestor","Gerencia","Almacén","TI","Supervisor","RRHH","Seguridad"] },
      { href: "/cuadrillas", label: "Cuadrillas", icon: I(Truck), roles: ["Gestor","Gerencia","Almacén","TI"] },
      { href: "/tecnicos", label: "Técnicos", icon: I(ContactRound), roles: ["Gestor","Gerencia","Almacén","TI"] },
    ]
  },
  {
    id: "instalaciones",
    label: "Instalaciones",
    icon: I(IconoGrupoInstalaciones, 20),
    roles: ["Gestor","Gerencia","Almacén","TI"],
    subItems: [
      { href: "/instalaciones/mapa", label: "Mapa Instalaciones", icon: I(MapPinned), roles: ["Gestor","Gerencia","Almacén","TI"] },
      { href: "/instalaciones/gerencia", label: "Vista Gerencia", icon: I(Building2), roles: ["Gerencia","Almacén","TI"] },
      { href: "/instalaciones/gestor", label: "Llamadas INCONCERT", icon: I(PhoneCall), roles: ["Gestor"] }
    ]
  },
  {
    id: "asistencia",
    label: "Asistencia",
    icon: I(IconoGrupoAsistencia, 20),
    roles: ["RRHH","Seguridad","Supervisor","Gestor","Gerencia","Almacén","TI"],
    subItems: [
      { href: "/asistencia/visualizar", label: "Visualizar Asistencia", icon: I(ClipboardList), roles: ["RRHH","Seguridad","Supervisor","Gestor","Gerencia","Almacén","TI"] },
      { href: "/asistencia/registrar", label: "Registrar Asistencia", icon: I(CalendarPlus), roles: ["Gerencia","Almacén","TI","RRHH","Seguridad","Supervisor"] },
    ]
  },
  {
    id: "liquidacion",
    label: "Liquidación",
    icon: I(IconoGrupoLiquidacion, 20),
    roles: ["Almacén","TI","Gerencia"],
    subItems: [
      { href: "/liquidacion/liquidacion-almacen", label: "Liquidación Almacén", icon: I(HandCoins), roles: ["Almacén","TI"] },
      { href: "/liquidacion/liquidacion", label: "Instalaciones Liquidadas", icon: I(CheckCircle), roles: ["Almacén","TI","Gerencia"] },
    ]
  },
  {
    id: "almacen",
    label: "Almacén",
    icon: I(IconoGrupoAlmacen, 20),
    roles: ["Almacén","Gerencia","TI"],
    subItems: [
      { href: "/almacen/stock", label: "Stock General Equipos", icon: I(PackageSearch), roles: ["Almacén","TI","Gerencia"] },
      { href: "/almacen/carga-equipos", label: "Ingreso Equipos", icon: I(HardDrive), roles: ["Almacén","TI"] },
      { href: "/almacen/despacho", label: "Despacho Equipos", icon: I(Package), roles: ["Almacén","TI"] },
      { href: "/almacen/ingreso-materiales-venta", label: "Ingreso Materiales", icon: I(Archive), roles: ["Almacén","Gerencia","TI"] },
      { href: "/almacen/venta-materiales", label: "Venta/Despacho Materiales", icon: I(ShoppingCart), roles: ["Almacén","Gerencia","TI"] },
      { href: "/almacen/equipos", label: "Inventario Equipos", icon: I(PackageSearch), roles: ["Almacén","TI"] },
      { href: "/almacen/devolucion", label: "Devolución Equipos", icon: I(PackageOpen), roles: ["Almacén","TI"] },
      { href: "/almacen/recepcion-actas", label: "Recepción Actas", icon: I(FileStack), roles: ["Almacén","TI"] }
    ]
  },
  {
    id: "administracion",
    label: "Administración",
    icon: I(IconoGrupoAdministracion, 20),
    roles: ["Gerencia","TI","Gestor"],
    subItems: [
      { href: "/admin/usuarios/usuarios", label: "Gestión Usuarios", icon: I(UserRoundSearch), roles: ["Gerencia","TI"] },
      { href: "/admin/usuarios/nuevo", label: "Nuevo Usuario", icon: I(UserPlus), roles: ["Gerencia","TI"] },
      { href: "/admin/importar-instalaciones", label: "Importar Instalaciones", icon: I(TrafficCone), roles: ["Gerencia","TI","Gestor"] },
      { href: "/gerencia/orden_compra", label: "Órden de Compra", icon: I(FileChartColumn), roles: ["Gerencia","TI"] }
    ]
  },
  {
    id: "herramientas_ti",
    label: "Herramientas TI",
    icon: I(Home, 20),
    roles: ["TI"],
    subItems: [
      { href: "/admin/exportar-sheets", label: "Exportar Liquid. a Sheets", icon: I(UploadCloud), roles: ["TI"] },
    ]
  },
  {
    id: "configuracion",
    label: "Configuración",
    icon: I(IconoGrupoConfiguracion, 20),
    roles: ["TI"],
    subItems: [
      { href: "/configuraciones", label: "Ajustes Generales", icon: I(Settings), roles: ["TI"] },
    ]
  },
];


  useEffect(() => {
    const currentActiveGroup = allSidebarItems.find(
      (group) => group.subItems && group.subItems.some((sub) => sub.href === pathname)
    );
    if (currentActiveGroup) setActiveGroup(currentActiveGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const accessibleSidebarStructure = allSidebarItems
    .map((group) => ({ ...group, subItems: group.subItems.filter((item) => hasAnyRole(item.roles)) }))
    .filter((group) => hasAnyRole(group.roles) && group.subItems.length > 0);

  // loader
  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-white dark:from-[#0b0f19] dark:to-black">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-[color:var(--brand)]" />
          <p className="text-slate-600 dark:text-slate-300">Cargando aplicación...</p>
        </div>
      </div>
    );
  }

  // datos usuario
  const name = userData?.nombres || "Usuario";
  const roles = Array.isArray(userData?.rol) ? userData.rol : userData?.rol ? [userData.rol] : ["Sin rol"];
  const initials = name.trim().split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[color:var(--ink)]">
      {/* HEADER */}
      <header
        className={cn(
          "sticky top-0 z-50 flex items-center justify-between px-3 py-3 sm:px-5",
          "border-b border-[color:var(--line)] bg-white/85 backdrop-blur-md",
          "shadow-[0_8px_24px_var(--shadow)] dark:bg-[#0b0f19]/70"
        )}
        style={{ height: "var(--header-height, 65px)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-lg p-1.5 hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/35 dark:hover:bg-white/10"
            aria-label={sidebarOpen ? "Colapsar menú" : "Expandir menú"}
            type="button"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <Link href="/dashboard" className="flex items-center gap-2" aria-label="Ir al dashboard">
  {/* Contenedor controlado del logo */}
  <div
    className="relative h-9 w-[112px] overflow-hidden rounded-md bg-transparent"
    style={{ contain: "content" }}  // evita repaints innecesarios
  >
    <Image
      src="/image/logo.png"
      alt="REDES M&D"
      fill                 // la imagen se ajusta al contenedor
      sizes="112px"
      className="object-contain select-none pointer-events-none"
      priority
    />
  </div>

  <span className="hidden text-sm font-semibold text-[color:var(--brand)] sm:block">
    REDES M&D
  </span>
</Link>

        </div>

        {/* Tarjeta de usuario (más visible y elegante) */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Notificaciones />
          <NotificacionFlotante />

          <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--line)] bg-white/90 px-3 py-2 shadow-[0_4px_14px_var(--shadow)] backdrop-blur dark:bg-white/5">
            {/* avatar */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[color:var(--brand)] to-[color:var(--accent)] text-xs font-bold text-white shadow-[0_6px_16px_rgba(48,81,140,.25)]">
              {initials}
            </div>

            {/* nombre + roles */}
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold">{name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <span
                    key={r}
                    className="rounded-full border border-[color:var(--line)] bg-[color:var(--brand-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--brand-ink)]"
                    title={r}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>

            {/* salir */}
            <button
              onClick={handleLogout}
              type="button"
              className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
              title="Cerrar sesión"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* SIDEBAR */}
        <aside
          className={cn(
            "sticky top-0 flex max-h-[calc(100vh-var(--header-height,65px))] min-h-0 flex-col transition-[width] duration-300 ease-in-out",
            "border-r border-[color:var(--line)] bg-gradient-to-b from-white to-slate-50/70 dark:from-[#0b0f19] dark:to-[#0b0f19]",
            "shadow-[inset_0_1px_0_rgba(255,255,255,.6),0_8px_24px_var(--shadow)]",
            sidebarOpen ? "w-64" : "w-20"
          )}
          aria-label="Navegación principal"
        >
          <nav className={cn("flex flex-1 flex-col gap-1 p-2", sidebarOpen ? "custom-scrollbar overflow-y-auto" : "overflow-hidden")}>
            {accessibleSidebarStructure.map((groupItem) => (
              <SidebarItem
                key={groupItem.id}
                item={groupItem}
                open={sidebarOpen}
                currentPathname={pathname}
                activeGroup={activeGroup}
                setActiveGroup={setActiveGroup}
              />
            ))}
          </nav>
        </aside>

        {/* MAIN (autoajuste) */}
        <motion.main
          key={pathname}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="min-h-0 h-[calc(100vh-var(--header-height,65px))] flex-1 overflow-auto bg-[color:var(--canvas)] p-3 sm:p-6"
        >
          {/* contenedor elegante para vistas */}
          <div className="card card--gradient min-h-full p-3 sm:p-5">
            
            {children}
          </div>
        </motion.main>
      </div>

      {/* THEME */}
      <style jsx global>{`
        :root {
          --header-height: 65px;

          /* paleta corporativa */
          --brand: #30518c;              /* azul institucional */
          --accent: #ff6413;             /* naranja acento */
          --brand-ink: #2b3f66;          /* texto sobre brand-soft */
          --brand-soft: rgba(48,81,140,.09);

          --ink: #0f172a;
          --muted-ink: #475569;
          --line: rgba(15,23,42,.08);
          --shadow: rgba(2,6,23,.06);

          --canvas: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
        }
        .dark :root {
          --ink: #e5e7eb;
          --muted-ink: #9ca3af;
          --line: rgba(255,255,255,.12);
          --brand-soft: rgba(48,81,140,.18);
          --canvas: radial-gradient(1200px 600px at 10% -10%, rgba(48,81,140,.18) 0%, transparent 55%), #0b0f19;
          --shadow: rgba(0,0,0,.35);
        }

        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(48,81,140,0.35), rgba(48,81,140,0.2));
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(48,81,140,0.6), rgba(48,81,140,0.35));
        }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(48,81,140,0.45) transparent; }
      `}</style>
    </div>
  );
}
