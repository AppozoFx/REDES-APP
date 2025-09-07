// src/app/almacen/stock-materiales/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  increment,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";
import toast from "react-hot-toast";
import {
  PackageSearch,
  Plus,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Search,
  ArrowUpDown,
  PencilLine,
} from "lucide-react";

/* =========================
   Config & Helpers
========================= */

// Materiales con tratamiento especial de unidad (visual & almacenamiento)
const SPECIAL_UNITS = {
  bobina: { factor: 1000, unitLabel: "m" }, // 1 bobina = 1000 metros
};

// Normaliza: quita acentos y baja a minúsculas
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Extrae roles desde userData con tolerancia de forma (string u objeto)
const extractRoles = (userData) => {
  const cand =
    userData?.roles ??
    userData?.rol ??
    userData?.role ??
    userData?.perfiles ??
    [];
  const arr = Array.isArray(cand) ? cand : [cand];

  return arr
    .map((r) => {
      if (typeof r === "string") return r;
      if (r && typeof r === "object") {
        return (
          r.rol ??
          r.role ??
          r.label ??
          r.name ??
          r.id ??
          r.value ??
          ""
        );
      }
      return "";
    })
    .filter(Boolean);
};

const hasAnyRole = (userData, wanted = []) => {
  const roles = extractRoles(userData).map(norm);
  const wantedNorm = wanted.map(norm);
  return roles.some((r) => wantedNorm.includes(r));
};

// Permisos: puede editar si TI o Almacén (con o sin acento)
const canEdit = (userData) => hasAnyRole(userData, ["TI", "Almacén", "Almacen"]);

// Clase helper css
const cls = (...x) => x.filter(Boolean).join(" ");

// Convierte timestamp Firestore a string legible
const formatTs = (ts) =>
  ts?.toDate?.()
    ? new Date(ts.toDate()).toLocaleString()
    : typeof ts === "number"
    ? new Date(ts).toLocaleString()
    : "-";

// Formato de cantidad (ej. “9,000 m” para bobina)
const formatCantidad = (mat) => {
  const id = String(mat.id || "").toLowerCase();
  const n = Number(mat.cantidad || 0);
  if (SPECIAL_UNITS[id]?.unitLabel) {
    return `${n.toLocaleString()} ${SPECIAL_UNITS[id].unitLabel}`;
  }
  return n.toLocaleString();
};

/* =========================
   Página
========================= */
export default function StockMaterialesPage() {
  const { userData } = useAuth();

  // Evita falsos negativos antes de que cargue userData
  const [authReady, setAuthReady] = useState(false);
  const [currentUserName, setCurrentUserName] = useState(""); // nombre que se guardará en actualizadoPor

  useEffect(() => {
    if (userData) {
      setAuthReady(true);
      // Intentar armar nombre completo desde userData; si falta, leer doc usuarios/{uid}
      const fromUserData =
        (userData?.nombres && userData?.apellidos
          ? `${userData.nombres} ${userData.apellidos}`
          : userData?.nombreCompleto ||
            userData?.fullName ||
            userData?.displayName ||
            userData?.nombre) || "";

      if (fromUserData?.trim()) {
        setCurrentUserName(fromUserData.trim().toUpperCase());
      } else if (userData?.uid) {
        (async () => {
          try {
            const snap = await getDoc(doc(db, "usuarios", userData.uid));
            const d = snap.exists() ? snap.data() : null;
            const name =
              (d?.nombres && d?.apellidos
                ? `${d.nombres} ${d.apellidos}`
                : d?.nombre ||
                  d?.displayName ||
                  d?.nombreCompleto) || userData?.email || "Sistema";
            setCurrentUserName(String(name).trim().toUpperCase());
          } catch {
            setCurrentUserName((userData?.email || "Sistema").toUpperCase());
          }
        })();
      } else {
        setCurrentUserName((userData?.email || "Sistema").toUpperCase());
      }
    }
  }, [userData]);

  const editable = authReady ? canEdit(userData) : false;

  const [materiales, setMateriales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState({ key: "id", dir: "asc" });
  const [modalAdd, setModalAdd] = useState({ open: false, id: "", nombre: "" });
  const [modalMin, setModalMin] = useState({ open: false, id: "", nombre: "", min: "" });

  const fetchMateriales = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, "materiales_stock"));
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      setMateriales(
        data.map((m) => ({
          ...m,
          cantidad: Number(m.cantidad || 0),
          min: Number(m.min || 0), // si el doc define mínimo, lo usamos para alerta
        }))
      );
    } catch (e) {
      console.error(e);
      toast.error("No se pudo obtener el stock de materiales");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMateriales();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? materiales.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            String(m.descripcion || "").toLowerCase().includes(q)
        )
      : materiales;

    const sorted = [...base].sort((a, b) => {
      const k = sortBy.key;
      const dir = sortBy.dir === "asc" ? 1 : -1;
      const av = a[k] ?? "";
      const bv = b[k] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [materiales, query, sortBy]);

  const kpis = useMemo(() => {
    const totalItems = materiales.length;
    const totalUnidades = materiales.reduce((acc, m) => acc + (Number(m.cantidad) || 0), 0);
    const low = materiales.filter((m) => m.min && m.cantidad <= m.min).length;
    const lastUpdated = materiales.reduce((acc, m) => {
      const t =
        m.actualizadoEn?.toDate?.()?.getTime?.() ??
        (typeof m.actualizadoEn === "number" ? m.actualizadoEn : 0);
      return Math.max(acc, t || 0);
    }, 0);
    return { totalItems, totalUnidades, low, lastUpdated };
  }, [materiales]);

  const toggleSort = (key) => {
    setSortBy((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  };

  const openAddModal = (mat) => {
    if (!editable) return;
    setModalAdd({ open: true, id: mat.id, nombre: mat.id });
  };

  const openMinModal = (mat) => {
    if (!editable) return;
    setModalMin({ open: true, id: mat.id, nombre: mat.id, min: String(mat.min || "") });
  };

  const closeAddModal = () => setModalAdd({ open: false, id: "", nombre: "" });
  const closeMinModal = () => setModalMin({ open: false, id: "", nombre: "", min: "" });

  // Agregar cantidad (con regla especial para bobina => metros)
  const handleAgregar = async (cantidadInput) => {
    const num = Number(cantidadInput);
    if (!modalAdd.id || Number.isNaN(num)) {
      toast.error("Ingrese una cantidad válida");
      return;
    }
    if (num === 0) {
      toast("No se registraron cambios");
      return;
    }

    try {
      const ref = doc(db, "materiales_stock", modalAdd.id);
      const idLower = modalAdd.id.toLowerCase();

      // Si es bobina, guardamos en METROS (num * 1000)
      const valor = SPECIAL_UNITS[idLower]?.factor ? num * SPECIAL_UNITS[idLower].factor : num;

      await updateDoc(ref, {
        cantidad: increment(valor),
        actualizadoPor: currentUserName || (userData?.email || "SISTEMA"),
        actualizadoEn: serverTimestamp(),
      });

      if (SPECIAL_UNITS[idLower]?.factor) {
        toast.success(
          `Se agregaron ${num} bobinas (${valor.toLocaleString()} ${SPECIAL_UNITS[idLower].unitLabel}) a "${modalAdd.nombre}"`
        );
      } else {
        toast.success(`Stock de "${modalAdd.nombre}" actualizado (+${num.toLocaleString()})`);
      }

      closeAddModal();
      fetchMateriales();
    } catch (e) {
      console.error(e);
      toast.error("Error al actualizar el stock");
    }
  };

  // Guardar mínimo de alerta
  const handleGuardarMin = async (minInput) => {
    const val = Number(minInput);
    if (!modalMin.id || Number.isNaN(val) || val < 0) {
      toast.error("Ingrese un mínimo válido");
      return;
    }
    try {
      const ref = doc(db, "materiales_stock", modalMin.id);
      await updateDoc(ref, {
        min: val,
        actualizadoPor: currentUserName || (userData?.email || "SISTEMA"),
        actualizadoEn: serverTimestamp(),
      });
      toast.success(`Mínimo actualizado para "${modalMin.nombre}"`);
      closeMinModal();
      fetchMateriales();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo actualizar el mínimo");
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">📦 Stock de Materiales</h1>
          <p className="text-sm text-muted-foreground">
            Consulta y administra el inventario general de materiales del almacén.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchMateriales}
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            title="Recargar"
          >
            <RefreshCw className="h-4 w-4" />
            Recargar
          </button>

          {editable ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              Permisos de edición
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
              Solo lectura
            </span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<PackageSearch className="h-5 w-5" />}
          label="Materiales distintos"
          value={kpis.totalItems}
        />
        <KpiCard label="Unidades totales" value={kpis.totalUnidades.toLocaleString()} />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Con stock bajo"
          value={kpis.low}
          tone={kpis.low > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Última actualización"
          value={kpis.lastUpdated ? new Date(kpis.lastUpdated).toLocaleString() : "-"}
        />
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-xl border px-9 py-2 text-sm outline-none ring-0 placeholder:text-gray-400 focus:border-gray-300"
            placeholder="Buscar material…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border">
        <div className="max-h-[65vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr className="text-left text-gray-600">
                <Th onClick={() => toggleSort("id")} active={sortBy.key === "id"} dir={sortBy.dir}>
                  Material
                </Th>
                <Th
                  className="w-32 text-right"
                  onClick={() => toggleSort("cantidad")}
                  active={sortBy.key === "cantidad"}
                  dir={sortBy.dir}
                >
                  Cantidad
                </Th>
                <Th className="w-32 text-right">Mínimo</Th>
                <Th className="w-56">Última actualización</Th>
                <Th className="w-56">Actualizado por</Th>
                <th className="w-56 p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-500">
                    No se encontraron materiales.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const low = m.min && m.cantidad <= m.min;
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">
                            {m.id.replaceAll("_", " ")}
                          </span>
                          {m.min ? (
                            <span
                              className={cls(
                                "rounded-full px-2 py-0.5 text-[11px] ring-1",
                                low
                                  ? "bg-red-50 text-red-700 ring-red-200"
                                  : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              )}
                              title={`Mínimo: ${m.min}`}
                            >
                              {low ? "Bajo" : "OK"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatCantidad(m)}</td>
                      <td className="p-3 text-right tabular-nums">{(m.min || 0).toLocaleString()}</td>
                      <td className="p-3">{formatTs(m.actualizadoEn)}</td>
                      <td className="p-3">{m.actualizadoPor || "-"}</td>
                      <td className="p-3">
                        {editable ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => openAddModal(m)}
                              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700"
                            >
                              <Plus className="h-4 w-4" /> Agregar stock
                            </button>
                            <button
                              onClick={() => openMinModal(m)}
                              className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 hover:bg-gray-50"
                              title="Editar mínimo de alerta"
                            >
                              <PencilLine className="h-4 w-4" /> Editar mínimo
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Agregar */}
      {modalAdd.open && (
        <AddStockModal
          nombre={modalAdd.nombre}
          matId={modalAdd.id}
          onClose={closeAddModal}
          onConfirm={handleAgregar}
        />
      )}

      {/* Modal Editar Mínimo */}
      {modalMin.open && (
        <EditMinModal
          nombre={modalMin.nombre}
          currentMin={modalMin.min}
          onClose={closeMinModal}
          onConfirm={handleGuardarMin}
        />
      )}
    </div>
  );
}

/* =========================
   Componentes auxiliares
========================= */

function KpiCard({ icon, label, value, tone }) {
  const toneCls =
    tone === "warn"
      ? "bg-amber-50 ring-amber-200 text-amber-800"
      : tone === "ok"
      ? "bg-emerald-50 ring-emerald-200 text-emerald-800"
      : "bg-white ring-gray-200";
  return (
    <div className={cls("rounded-2xl border p-4 ring-1", toneCls)}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        {icon}
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Th({ children, className = "", onClick, active, dir }) {
  return (
    <th className={cls("p-3 font-medium", className)}>
      <button
        onClick={onClick}
        className={cls(
          "inline-flex items-center gap-1 hover:underline",
          onClick ? "cursor-pointer" : "cursor-default"
        )}
      >
        {children}
        {onClick && <ArrowUpDown className={cls("h-3.5 w-3.5", active ? "opacity-100" : "opacity-40")} />}
        {active ? (
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            {dir === "asc" ? "asc" : "desc"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

function SkeletonRows({ rows = 8 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-t animate-pulse">
          <td className="p-3">
            <div className="h-3 w-40 rounded bg-gray-100" />
          </td>
          <td className="p-3 text-right">
            <div className="ml-auto h-3 w-10 rounded bg-gray-100" />
          </td>
          <td className="p-3 text-right">
            <div className="ml-auto h-3 w-10 rounded bg-gray-100" />
          </td>
          <td className="p-3">
            <div className="h-3 w-52 rounded bg-gray-100" />
          </td>
          <td className="p-3">
            <div className="h-3 w-40 rounded bg-gray-100" />
          </td>
          <td className="p-3">
            <div className="h-8 w-40 rounded bg-gray-100" />
          </td>
        </tr>
      ))}
    </>
  );
}

function AddStockModal({ nombre, matId, onClose, onConfirm }) {
  const [cantidad, setCantidad] = useState("");
  const [step, setStep] = useState(1);
  const idLower = String(matId || "").toLowerCase();
  const special = SPECIAL_UNITS[idLower];
  const num = Number(cantidad);
  const disabled = Number.isNaN(num) || !cantidad || cantidad === "0";

  const previewText = () => {
    if (special?.factor) {
      const conv = num * special.factor;
      return `Se sumarán ${num} ${idLower} ${num === 1 ? "unidad" : "unidades"} equivalentes a ${conv.toLocaleString()} ${special.unitLabel}.`;
    }
    return `Se sumarán ${num} unidades.`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        {step === 1 ? (
          <>
            <h3 className="text-lg font-semibold">Agregar stock</h3>
            <p className="mt-1 text-sm text-gray-600">
              Material: <span className="font-medium capitalize">{nombre.replaceAll("_", " ")}</span>
            </p>

            <div className="mt-4">
              <label className="text-sm text-gray-600">Cantidad a sumar</label>
              <input
                type="number"
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:border-gray-300"
                placeholder={special?.factor ? "Ej. 3 (bobinas → metros)" : "Ej. 10"}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                min={1}
              />
              <p className="mt-1 text-xs text-gray-500">
                {special?.factor
                  ? `Este material usa conversión automática: 1 ${idLower} = ${special.factor} ${special.unitLabel}.`
                  : "Solo números positivos. Para correcciones, use ajustes controlados."}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                disabled={disabled}
                onClick={() => setStep(2)}
                className={cls(
                  "rounded-xl px-3 py-1.5 text-sm text-white",
                  disabled ? "bg-gray-300" : "bg-indigo-600 hover:bg-indigo-700"
                )}
              >
                Continuar
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Confirmar actualización</h3>
            <p className="mt-2 text-sm text-gray-700">{previewText()}</p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Volver
              </button>
              <button
                onClick={() => onConfirm(num)}
                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
              >
                Confirmar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditMinModal({ nombre, currentMin, onClose, onConfirm }) {
  const [minimo, setMinimo] = useState(currentMin ?? "");
  const val = Number(minimo);
  const disabled = Number.isNaN(val) || val < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">Editar mínimo de alerta</h3>
        <p className="mt-1 text-sm text-gray-600">
          Material: <span className="font-medium capitalize">{nombre.replaceAll("_", " ")}</span>
        </p>

        <div className="mt-4">
          <label className="text-sm text-gray-600">Nuevo mínimo</label>
          <input
            type="number"
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:border-gray-300"
            placeholder="Ej. 100"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            min={0}
          />
          <p className="mt-1 text-xs text-gray-500">
            Se usará para calcular la alerta de stock bajo (cantidad ≤ mínimo).
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            disabled={disabled}
            onClick={() => onConfirm(val)}
            className={cls(
              "rounded-xl px-3 py-1.5 text-sm text-white",
              disabled ? "bg-gray-300" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
