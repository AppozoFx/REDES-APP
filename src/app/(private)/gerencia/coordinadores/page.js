"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  orderBy,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext";

const cls = (...x) => x.filter(Boolean).join(" ");

/* ========= Validaciones ========= */
const isRucValido = (v) => /^\d{11}$/.test(String(v || "").trim());

export default function CoordinadoresPage() {
  const { userData, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [coordinadores, setCoordinadores] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [saving, setSaving] = useState(false);

  /* ===== Guard de roles (solo TI y Gerencia) ===== */
  const puedeVer = useMemo(() => {
    const roles = (userData?.rol || []).map(String);
    return roles.includes("TI") || roles.includes("Gerencia");
  }, [userData]);

  /* ===== Cargar coordinadores ===== */
  const cargar = async () => {
    try {
      setLoading(true);
      const q = query(
        collection(db, "usuarios"),
        where("rol", "array-contains", "Coordinador")
        // Si tu colección es grande y quieres ordenar por nombres, debes crear un índice compuesto:
        // orderBy("nombres", "asc")
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCoordinadores(rows);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cargar coordinadores.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && puedeVer) cargar();
  }, [authLoading, puedeVer]);

  /* ===== Filtro rápido ===== */
  const listaFiltrada = useMemo(() => {
    const f = (busqueda || "").toLowerCase().trim();
    if (!f) return coordinadores;
    return coordinadores.filter((x) => {
      const campos = [
        x.nombres,
        x.apellidos,
        x.email,
        x.dni_ce,
        x.celular,
        x.razon_social,
        x.ruc,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return campos.includes(f);
    });
  }, [busqueda, coordinadores]);

  /* ===== Abrir modal de edición ===== */
  const onEdit = (row) => {
    setEditRow({
      id: row.id,
      nombres: row.nombres || "",
      apellidos: row.apellidos || "",
      email: row.email || "",
      dni_ce: row.dni_ce || "",
      celular: row.celular || "",
      razon_social: row.razon_social || "",
      ruc: row.ruc || "",
    });
    setEditOpen(true);
  };

  /* ===== Guardar edición ===== */
  const onSave = async () => {
    if (!editRow) return;
    const { id, razon_social, ruc } = editRow;

    if (ruc && !isRucValido(ruc)) {
      toast.error("El RUC debe tener 11 dígitos numéricos.");
      return;
    }
    if (!razon_social?.trim()) {
      toast.error("La razón social no puede estar vacía.");
      return;
    }

    try {
      setSaving(true);
      await updateDoc(doc(db, "usuarios", id), {
        razon_social: razon_social.trim(),
        ruc: ruc?.trim() || "",
        actualizado_en: new Date(),
      });
      toast.success("Datos guardados.");
      setEditOpen(false);
      setEditRow(null);
      await cargar();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo guardar la información.");
    } finally {
      setSaving(false);
    }
  };

  /* ===== UI ===== */
  if (authLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse h-6 w-40 bg-gray-700/30 rounded" />
      </div>
    );
  }

  if (!puedeVer) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-red-700">
            Acceso restringido
          </h2>
          <p className="text-sm text-red-700/80">
            Esta página solo está disponible para usuarios con rol <b>TI</b> o{" "}
            <b>Gerencia</b>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">
            Coordinadores
          </h1>
          <p className="text-sm text-gray-500">
            Gestión de datos de razón social y RUC de coordinadores.
          </p>
        </div>
        <button
          onClick={cargar}
          className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700"
        >
          Actualizar
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, DNI, email, RUC…"
          className="w-full md:w-96 px-3 py-2 rounded-lg border bg-white/80 dark:bg-slate-900/40 outline-none focus:ring-2 ring-slate-400"
        />
        <span className="text-xs text-gray-500">
          {listaFiltrada.length} resultados
          {loading ? " (cargando…)" : ""}
        </span>
      </div>

      <div className="overflow-auto rounded-2xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40">
            <tr className="text-left">
              <th className="px-4 py-3">Nombres</th>
              <th className="px-4 py-3">Apellidos</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">DNI/CE</th>
              <th className="px-4 py-3">Celular</th>
              <th className="px-4 py-3">Razón social</th>
              <th className="px-4 py-3">RUC</th>
              <th className="px-4 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  Cargando…
                </td>
              </tr>
            ) : listaFiltrada.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  Sin resultados.
                </td>
              </tr>
            ) : (
              listaFiltrada.map((u) => (
                <tr
                  key={u.id}
                  className="border-t hover:bg-slate-50/60 dark:hover:bg-slate-900/30"
                >
                  <td className="px-4 py-3">{u.nombres || "-"}</td>
                  <td className="px-4 py-3">{u.apellidos || "-"}</td>
                  <td className="px-4 py-3">{u.email || "-"}</td>
                  <td className="px-4 py-3">{u.dni_ce || "-"}</td>
                  <td className="px-4 py-3">{u.celular || "-"}</td>
                  <td className="px-4 py-3">{u.razon_social || <em className="text-gray-400">—</em>}</td>
                  <td className="px-4 py-3">{u.ruc || <em className="text-gray-400">—</em>}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onEdit(u)}
                      className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-500"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Modal Edición ===== */}
      {editOpen && editRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setEditOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1">Editar datos fiscales</h3>
            <p className="text-xs text-gray-500 mb-4">
              {editRow.nombres} {editRow.apellidos} — {editRow.email}
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Razón social</label>
                <input
                  value={editRow.razon_social}
                  onChange={(e) =>
                    setEditRow((r) => ({ ...r, razon_social: e.target.value }))
                  }
                  className="w-full mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-2 ring-slate-400"
                  placeholder="Ej. SERVICIOS INTEGRALES M&D S.A.C."
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">RUC (11 dígitos)</label>
                <input
                  value={editRow.ruc}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    setEditRow((r) => ({ ...r, ruc: v }));
                  }}
                  maxLength={11}
                  inputMode="numeric"
                  className={cls(
                    "w-full mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-2",
                    isRucValido(editRow.ruc) || !editRow.ruc
                      ? "ring-slate-400"
                      : "ring-red-300 border-red-300"
                  )}
                  placeholder="20XXXXXXXXX"
                />
                {!isRucValido(editRow.ruc) && editRow.ruc && (
                  <p className="text-xs text-red-600 mt-1">
                    El RUC debe tener 11 dígitos.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                disabled={saving}
                onClick={() => setEditOpen(false)}
                className="px-3 py-2 rounded-lg border hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                onClick={onSave}
                className={cls(
                  "px-3 py-2 rounded-lg text-white",
                  saving ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-500"
                )}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
