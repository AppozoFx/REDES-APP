"use client";

import { useEffect, useState, Fragment } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/firebaseConfig";
import { useAuth } from "@/app/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Menu,
  X,
  LayoutDashboard,
  Users,
  HardDrive, 
  CalendarPlus,
  ClipboardList,
  Settings,
  Truck,
  ContactRound,
  PhoneCall,
  MapPinned,
  Building2,
  HandCoins,
  PackageSearch, 
  Archive, // Usaremos Archive en lugar de ArchiveBox si no existe
  ShoppingCart, 
  Package, 
  PackageOpen, 
  FileStack, 
  UserRoundSearch,
  UserPlus,
  TrafficCone,
  CheckCircle,
  FileChartColumn,
  ChevronDown, 
  Archive as IconoGrupoAlmacen, 
  UsersRound as IconoGrupoAdministracion, 
  DollarSign as IconoGrupoLiquidacion, 
  Building as IconoGrupoInstalaciones, 
  ListChecks as IconoGrupoAsistencia, 
  Wrench as IconoGrupoConfiguracion, 
  UploadCloud, // Icono para Exportar a Sheets
  Home
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Notificaciones from "@/app/components/Notificaciones"; // Asegúrate que la ruta sea correcta
import NotificacionFlotante from "@/app/components/NotificacionFlotante"; // Asegúrate que la ruta sea correcta

// Componente para los ítems del Sidebar (puede ser un enlace o un grupo desplegable)
function SidebarItem({ item, open, currentPathname, activeGroup, setActiveGroup }) {
  const isSubItemActive = item.subItems && item.subItems.some(sub => currentPathname === sub.href);
  const isActive = currentPathname === item.href || isSubItemActive;
  
  const isSubmenuOpen = item.subItems ? activeGroup === item.id : false;

  // Efecto para abrir el grupo si un subitem está activo al cargar la página o navegar.
  useEffect(() => {
    if (isSubItemActive && activeGroup !== item.id) {
      setActiveGroup(item.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubItemActive, item.id, setActiveGroup, currentPathname]);


  if (item.subItems && item.subItems.length > 0) {
    // Es un grupo con submenú
    return (
      <div className="w-full">
        <button
          onClick={() => setActiveGroup(isSubmenuOpen ? null : item.id)} 
          className={`group relative flex items-center justify-between w-full gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${
            isActive ? "text-[#ff6413] font-semibold bg-orange-50 dark:bg-gray-700" : "text-gray-700 dark:text-gray-300"
          }`}
          aria-expanded={isSubmenuOpen} 
          aria-controls={`submenu-${item.id}`}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg flex-shrink-0 w-5 h-5">{item.icon}</span>
            {open && <span className="truncate">{item.label}</span>}
          </div>
          {open && ( 
            <span className={`transform transition-transform duration-200 ${isSubmenuOpen ? "rotate-180" : "rotate-0"}`}>
              <ChevronDown size={16} />
            </span>
          )}
        </button>
        <AnimatePresence>
          {open && isSubmenuOpen && ( 
            <motion.div
              id={`submenu-${item.id}`}
              initial={{ height: 0, opacity: 0, marginTop: 0 }}
              animate={{ height: "auto", opacity: 1, marginTop: "0.25rem" }} 
              exit={{ height: 0, opacity: 0, marginTop: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="ml-3 mt-1 pl-3 border-l border-gray-200 dark:border-gray-600 flex flex-col space-y-0.5" 
            >
              {item.subItems.map(subItem => (
                <SidebarLink
                  key={subItem.href}
                  href={subItem.href}
                  icon={subItem.icon} 
                  label={subItem.label}
                  open={open}
                  isSubItem={true}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Es un enlace simple (no tiene subItems o es un subItem que se renderiza directamente)
  // Este caso no debería darse si todos los elementos de primer nivel son grupos.
  // Si un grupo no tiene subitems accesibles, no se renderizará en absoluto.
  return null; 
}

// Componente para un enlace individual del Sidebar
function SidebarLink({ href, icon, label, open, isSubItem = false }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 px-3 rounded-md text-sm transition-all duration-200 hover:text-[#ff6413] dark:hover:text-orange-400 ${
        isActive ? "text-[#ff6413] font-semibold bg-orange-50 dark:bg-gray-700" : "text-gray-700 dark:text-gray-300"
      } ${isSubItem ? "py-1.5 text-xs pl-1" : "py-2.5"}`}
    >
      <span className={`flex-shrink-0 ${isSubItem ? "w-4 h-4 text-base" : "w-5 h-5 text-lg"}`}>{icon}</span>
      {open ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-800 dark:bg-black px-2.5 py-1.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          {label}
        </span>
      )}
    </Link>
  );
}


export default function LayoutApp({ children }) {
  const { userData, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeGroup, setActiveGroup] = useState(null); 
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const savedSidebar = localStorage.getItem("sidebarOpen");
    if (savedSidebar !== null) {
      setSidebarOpen(savedSidebar === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", sidebarOpen);
    if (!sidebarOpen) {
      setActiveGroup(null); 
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (!loading && !userData) {
      router.push("/login");
    }
  }, [loading, userData, router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const hasAnyRole = (roles) => {
    if (!userData?.rol) return false;
    return Array.isArray(userData.rol)
      ? roles.some((r) => userData.rol.includes(r))
      : roles.includes(userData.rol);
  };
  
  // Definición de la estructura del sidebar con submenús
  const allSidebarItems = [
    { 
      id: "general", 
      label: "Principal", 
      icon: <Home size={20}/>, 
      roles: ["Gestor", "Gerencia", "Almacén", "TI", "Supervisor", "RRHH", "Seguridad"],
      subItems: [
        { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16}/>, roles: ["Gestor", "Gerencia", "Almacén", "TI", "Supervisor", "RRHH", "Seguridad"] },
        { href: "/cuadrillas", label: "Cuadrillas", icon: <Truck size={16}/>, roles: ["Gestor", "Gerencia", "Almacén", "TI"] },
        { href: "/tecnicos", label: "Técnicos", icon: <ContactRound size={16}/>, roles: ["Gestor", "Gerencia", "Almacén", "TI"] },
      ]
    },
    {
      id: "instalaciones",
      label: "Instalaciones",
      icon: <IconoGrupoInstalaciones size={20}/>,
      roles: ["Gestor", "Gerencia", "Almacén", "TI"],
      subItems: [
        { href: "/instalaciones/mapa", label: "Mapa Instalaciones", icon: <MapPinned size={16}/>, roles: ["Gestor", "Gerencia", "Almacén", "TI"] },
        { href: "/instalaciones/gerencia", label: "Vista Gerencia", icon: <Building2 size={16}/>, roles: ["Gerencia", "Almacén", "TI"] },
        { href: "/instalaciones/gestor", label: "Llamadas INCONCERT", icon: <PhoneCall size={16}/>, roles: ["Gestor"] }
      ]
    },
    {
      id: "asistencia",
      label: "Asistencia",
      icon: <IconoGrupoAsistencia size={20}/>,
      roles: ["RRHH", "Seguridad", "Supervisor", "Gestor", "Gerencia", "Almacén", "TI"],
      subItems: [
        { href: "/asistencia/visualizar", label: "Visualizar Asistencia", icon: <ClipboardList size={16}/>, roles: ["RRHH", "Seguridad", "Supervisor", "Gestor", "Gerencia", "Almacén", "TI"] },
        { href: "/asistencia/registrar", label: "Registrar Asistencia", icon: <CalendarPlus size={16}/>, roles: ["Gerencia", "Almacén", "TI", "RRHH", "Seguridad", "Supervisor"] },
      ]
    },
    {
      id: "liquidacion",
      label: "Liquidación",
      icon: <IconoGrupoLiquidacion size={20}/>,
      roles: ["Almacén", "TI", "Gerencia"],
      subItems: [
        { href: "/liquidacion/liquidacion-almacen", label: "Liquidación Almacén", icon: <HandCoins size={16}/>, roles: ["Almacén", "TI"] },
        { href: "/liquidacion/liquidacion", label: "Instalaciones Liquidadas", icon: <CheckCircle size={16}/>, roles: ["Almacén", "TI", "Gerencia"] },
      ]
    },
    {
      id: "almacen",
      label: "Almacén",
      icon: <IconoGrupoAlmacen size={20}/>,
      roles: ["Almacén", "Gerencia", "TI"],
      subItems: [
        { href: "/almacen/stock", label: "Stock General Equipos", icon: <PackageSearch size={16}/>, roles: ["Almacén", "TI", "Gerencia"] },
        { href: "/almacen/carga-equipos", label: "Ingreso Equipos", icon: <HardDrive size={16}/>, roles: ["Almacén", "TI"] },
        { href: "/almacen/despacho", label: "Despacho Equipos", icon: <Package size={16}/>, roles: ["Almacén", "TI"] },
        // --- NUEVAS RUTAS AÑADIDAS ---
        { href: "/almacen/ingreso-materiales-venta", label: "Ingreso Materiales", icon: <Archive size={16}/>, roles: ["Almacén", "Gerencia", "TI"] }, // Usando Archive
        { href: "/almacen/venta-materiales", label: "Venta/Despacho Materiales", icon: <ShoppingCart size={16}/>, roles: ["Almacén", "Gerencia", "TI"] },
        // --- FIN NUEVAS RUTAS ---
        // { href: "/almacen/materiales", label: "Registro Materiales (Ant.)", icon: <FileStack size={16}/>, roles: ["Almacén", "TI"] }, // Comentado si es obsoleto
        { href: "/almacen/equipos", label: "Inventario Equipos", icon: <PackageSearch size={16}/>, roles: ["Almacén", "TI"] },
        { href: "/almacen/devolucion", label: "Devolución Equipos", icon: <PackageOpen size={16}/>, roles: ["Almacén", "TI"] },
        { href: "/almacen/recepcion-actas", label: "Recepción Actas", icon: <FileStack size={16}/>, roles: ["Almacén", "TI"] }
      ]
    },
    {
      id: "administracion",
      label: "Administración",
      icon: <IconoGrupoAdministracion size={20}/>,
      roles: ["Gerencia", "TI", "Gestor"],
      subItems: [
        { href: "/admin/usuarios/usuarios", label: "Gestión Usuarios", icon: <UserRoundSearch size={16}/>, roles: ["Gerencia", "TI"] },
        { href: "/admin/usuarios/nuevo", label: "Nuevo Usuario", icon: <UserPlus size={16}/>, roles: ["Gerencia", "TI"] },
        { href: "/admin/importar-instalaciones", label: "Importar Instalaciones", icon: <TrafficCone size={16}/>, roles: ["Gerencia", "TI", "Gestor"] },
        { href: "/gerencia/orden_compra", label: "Órden de Compra", icon: <FileChartColumn size={16}/>, roles: ["Gerencia", "TI"] }  
      ]
    },
    // --- NUEVO GRUPO PARA HERRAMIENTAS TI ---
    {
      id: "herramientas_ti",
      label: "Herramientas TI",
      icon: <Home size={20} />, // Icono para el grupo
      roles: ["TI"], // Solo visible para TI
      subItems: [
        { 
          href: "/admin/exportar-sheets", 
          label: "Exportar Liquid. a Sheets", 
          icon: <UploadCloud size={16} />, 
          roles: ["TI"] 
        },
        // Aquí puedes añadir más herramientas específicas para TI
      ]
    },
    // --- FIN NUEVO GRUPO ---
    {
      id: "configuracion",
      label: "Configuración",
      icon: <IconoGrupoConfiguracion size={20}/>,
      roles: ["TI"],
      subItems: [
        { href: "/configuraciones", label: "Ajustes Generales", icon: <Settings size={16}/>, roles: ["TI"] },
      ]
    },
    
  ];

  

  useEffect(() => {
    const currentActiveGroup = allSidebarItems.find(group => 
      group.subItems && group.subItems.some(sub => sub.href === pathname)
    );
    if (currentActiveGroup) {
      setActiveGroup(currentActiveGroup.id);
    }
  // No incluir allSidebarItems en las dependencias para evitar re-cálculos innecesarios
  // si la estructura de allSidebarItems no cambia durante el ciclo de vida del componente.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); 

  const accessibleSidebarStructure = allSidebarItems
    .map(group => ({
      ...group,
      subItems: group.subItems.filter(item => hasAnyRole(item.roles))
    }))
    .filter(group => hasAnyRole(group.roles) && group.subItems.length > 0);


  if (loading || !userData) { 
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 dark:bg-black">
        <div className="flex flex-col items-center">
          <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Cargando aplicación...</p>
        </div>
        <style jsx>{`
          .loader {
            border-top-color: #ff6413;
            animation: spinner 1.2s linear infinite;
          }
          @keyframes spinner {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
   }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-gray-100 dark:bg-black text-gray-900 dark:text-white">
      <header className="sticky top-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-white dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm z-50" style={{height: 'var(--header-height, 65px)'}}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href="/dashboard" className="flex-shrink-0">
            <Image
              src="/image/logo.png" 
              alt="Logo de la Empresa"
              width={70} 
              height={35} 
              className="object-contain"
              priority
            />
          </Link>
        </div>

        {userData && (
          <div className="flex items-center gap-3 sm:gap-4">
            <Notificaciones />
            <NotificacionFlotante/>
            
            <div className="text-right">
              <p className="text-sm font-semibold truncate max-w-[150px] sm:max-w-xs">{userData.nombres || "Usuario"}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px] sm:max-w-xs">
                {Array.isArray(userData.rol) ? userData.rol.join(", ") : userData.rol || "Sin rol"}
              </p>
              <button
                onClick={handleLogout}
                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 mt-0.5"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
      <aside className={`sticky top-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700 shadow-lg transition-all duration-300 ease-in-out flex flex-col ${sidebarOpen ? "w-64" : "w-20"} max-h-[calc(100vh-var(--header-height,65px))]`}>
          <nav className={`flex-grow flex flex-col gap-1 p-3 ${sidebarOpen ? 'overflow-y-auto custom-scrollbar' : 'overflow-hidden items-center'}`}>
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

        <motion.main
          key={pathname} 
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          transition={{ duration: 0.2 }}
          className="flex-1 h-[calc(100vh-var(--header-height,65px))] overflow-auto bg-gray-100 dark:bg-black p-4 sm:p-6"
        >
          {children}
        </motion.main>
      </div>
       <style jsx global>{`
        :root {
          --header-height: 65px; /* Ajusta esto a la altura real de tu header */
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #aaa;
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #ccc transparent;
        }
      `}</style>
    </div>
  );
}
