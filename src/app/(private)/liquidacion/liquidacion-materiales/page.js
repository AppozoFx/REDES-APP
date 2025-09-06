"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/es";
import toast from "react-hot-toast";
import { useAuth } from "@/app/context/AuthContext"; // ajusta la ruta si difiere
import { Input } from "@/app/components/ui/input"; // tu input tailwind/shadcn
// Si no tienes Input, reemplaza por <input ... className="..." />

dayjs.extend(customParseFormat);
dayjs.locale("es");

/* =========================
   Helpers
========================= */
const cls = (...x) => x.filter(Boolean).join(" ");
const toInt = (v) => {
  const n = parseInt(String(v ?? 0), 10);
  return Number.isNaN(n) ? 0 : n;
};
const toFloat = (v) => {
  const n = parseFloat(String(v ?? 0));
  return Number.isNaN(n) ? 0 : n;
};
const convFecha = (valor) => {
  if (!valor) return null;
  if (typeof valor?.toDate === "function") return valor.toDate();
  const p = dayjs(valor, "D [de] MMMM [de] YYYY, h:mm:ss A [UTC-5]", "es", true);
  return p.isValid() ? p.toDate() : new Date(valor);
};
const fmt = (d) => (d ? dayjs(d).format("DD/MM/YYYY") : "-");

/* =========================
   Página
========================= */
export default function LiquidacionMaterialesPage() {
  const { userData } = useAuth(); // { uid, displayName, role, ... }
  const [cargando, setCargando] = useState(false);
  const [insts, setInsts] = useState([]);
  const [cuadrillasIdx, setCuadrillasIdx] = useState({}); // nombre -> {id, categoria, r_c, ...}

  // filtros
  const [filtros, setFiltros] = useState({
    mes: dayjs().format("YYYY-MM"),
    dia: "",
    cuadrilla: "",
    busqueda: "", // código o cliente
    rc: "", // RESIDENCIAL / CONDOMINIO
  });

  // Edición / liquidación por fila
  const [formFila, setFormFila] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);

  // Focus para escanear ACTA directo
  const scanRef = useRef(null);

  /* =========================
     Cargar base
  ========================= */
  useEffect(() => {
    (async () => {
      try {
        setCargando(true);
        // 1) instalaciones candidatas
        const snap = await getDocs(collection(db, "liquidacion_instalaciones"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInsts(data);

        // 2) índice de cuadrillas (por nombre)
        const snapC = await getDocs(collection(db, "cuadrillas"));
        const idx = {};
        snapC.docs.forEach((d) => {
          const v = d.data();
          const nombre = (v?.nombre || "").trim();
          if (nombre) {
            idx[nombre] = {
              id: d.id,
              categoria: v?.categoria || v?.r_c || v?.tipo || "", // "Residencial" / "Condominio"
              r_c: v?.r_c || "",
            };
          }
        });
        setCuadrillasIdx(idx);
      } catch (e) {
        console.error(e);
        toast.error("Error cargando datos");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  /* =========================
     Filtro
  ========================= */
  const instsFiltradas = useMemo(() => {
    const mes = filtros.mes;
    const dia = filtros.dia;
    const q = (filtros.busqueda || "").toLowerCase().trim();
    const cuadrilla = (filtros.cuadrilla || "").trim();
    const rc = (filtros.rc || "").trim().toUpperCase();

    return insts.filter((l) => {
      const f = convFecha(l.fechaInstalacion);
      if (!f) return false;
      const okMes = dayjs(f).format("YYYY-MM") === mes;
      const okDia = dia ? dayjs(f).format("YYYY-MM-DD") === dia : true;
      const okCuad = cuadrilla ? (l.cuadrillaNombre || "") === cuadrilla : true;
      const okRC = rc ? (l.residencialCondominio || "").toUpperCase() === rc : true;
      const okQ = q
        ? ((l.codigoCliente || "") + (l.cliente || "") + (l.cuadrillaNombre || ""))
            .toLowerCase()
            .includes(q)
        : true;
      return okMes && okDia && okCuad && okRC && okQ;
    });
  }, [insts, filtros]);

  /* =========================
     Handlers UI
  ========================= */
  const onChangeFiltro = (e) => {
    const { name, value } = e.target;
    setFiltros((p) => ({ ...p, [name]: value }));
  };

  const setField = (rowId, campo, valor) => {
    setFormFila((p) => ({
      ...p,
      [rowId]: {
        acta: "",
        rotulo: "",
        metraje: "",
        templadores: "",
        hebillas: "",
        cinta_bandi: "",
        clevis: "",
        ...p[rowId],
        [campo]: valor,
      },
    }));
  };

  /* =========================
     Transacción de guardado
  ========================= */
  const guardarLiquidacion = async (row) => {
    const f = formFila[row.id] || {};
    // Validaciones mínimas
    const acta = String(f.acta || "").trim();
    const rotulo = String(f.rotulo || "").trim();
    const metraje = Math.max(0, toFloat(f.metraje));
    const templadores = Math.max(0, toInt(f.templadores));
    const hebillas = Math.max(0, toInt(f.hebillas));
    const cinta_bandi = Math.max(0, toInt(f.cinta_bandi));
    const clevis = Math.max(0, toInt(f.clevis));

    if (!acta) return toast.error("Ingresa/scanea el Nº de ACTA.");
    if (!rotulo) return toast.error("Ingresa el rótulo NAP/CTO.");
    if (metraje <= 0 && templadores + hebillas + cinta_bandi + clevis <= 0) {
      return toast.error("No hay cantidades para liquidar.");
    }

    // Resolver cuadrilla
    const cuadrillaNombre = row.cuadrillaNombre || "";
    const cuadrillaInfo = cuadrillasIdx[cuadrillaNombre];
    if (!cuadrillaInfo?.id) {
      return toast.error(`No encuentro el ID de la cuadrilla "${cuadrillaNombre}".`);
    }
    const cuadId = cuadrillaInfo.id;

    setGuardandoId(row.id);
    try {
      await runTransaction(db, async (tx) => {
        // a) leer stock actual por material que descontaremos
        const matRefs = {
          bobina: doc(db, "cuadrillas", cuadId, "stock_materiales", "bobina"),
          templadores: doc(db, "cuadrillas", cuadId, "stock_materiales", "templadores"),
          hebillas: doc(db, "cuadrillas", cuadId, "stock_materiales", "hebillas"),
          cinta_bandi: doc(db, "cuadrillas", cuadId, "stock_materiales", "cinta_bandi"),
          clevis: doc(db, "cuadrillas", cuadId, "stock_materiales", "clevis"),
        };

        const toRead = [];
        if (metraje > 0) toRead.push(matRefs.bobina);
        if (templadores > 0) toRead.push(matRefs.templadores);
        if (hebillas > 0) toRead.push(matRefs.hebillas);
        if (cinta_bandi > 0) toRead.push(matRefs.cinta_bandi);
        if (clevis > 0) toRead.push(matRefs.clevis);

        const snaps = await Promise.all(toRead.map((r) => tx.get(r)));
        // mapa ref->cantidadActual
        const cant = {};
        snaps.forEach((s) => {
          cant[s.ref.id] = toFloat(s.data()?.cantidad || 0);
        });

        // b) validar stock suficiente (no ir a negativo)
        const falta = [];

        if (metraje > 0) {
          const actual = cant["bobina"] ?? 0;
          if (actual - metraje < 0) falta.push(`bobina (tienes ${actual} m, pides ${metraje} m)`);
        }
        for (const [key, val] of [
          ["templadores", templadores],
          ["hebillas", hebillas],
          ["cinta_bandi", cinta_bandi],
          ["clevis", clevis],
        ]) {
          if (val > 0) {
            const actual = cant[key] ?? 0;
            if (actual - val < 0) falta.push(`${key} (tienes ${actual}, pides ${val})`);
          }
        }

        if (falta.length) {
          throw new Error(
            "Stock insuficiente: " + falta.join(" | ")
          );
        }

        // c) descuentos
        if (metraje > 0) {
          const sBob = snaps.find((s) => s?.ref?.id === "bobina");
          const cur = toFloat(sBob?.data()?.cantidad || 0);
          tx.update(matRefs.bobina, { cantidad: cur - metraje, actualizadoEn: serverTimestamp(), actualizadoPor: userData?.displayName || userData?.email || "Sistema" });
        }
        if (templadores > 0) {
          const s = snaps.find((x) => x?.ref?.id === "templadores");
          const cur = toFloat(s?.data()?.cantidad || 0);
          tx.update(matRefs.templadores, { cantidad: cur - templadores, actualizadoEn: serverTimestamp(), actualizadoPor: userData?.displayName || userData?.email || "Sistema" });
        }
        if (hebillas > 0) {
          const s = snaps.find((x) => x?.ref?.id === "hebillas");
          const cur = toFloat(s?.data()?.cantidad || 0);
          tx.update(matRefs.hebillas, { cantidad: cur - hebillas, actualizadoEn: serverTimestamp(), actualizadoPor: userData?.displayName || userData?.email || "Sistema" });
        }
        if (cinta_bandi > 0) {
          const s = snaps.find((x) => x?.ref?.id === "cinta_bandi");
          const cur = toFloat(s?.data()?.cantidad || 0);
          tx.update(matRefs.cinta_bandi, { cantidad: cur - cinta_bandi, actualizadoEn: serverTimestamp(), actualizadoPor: userData?.displayName || userData?.email || "Sistema" });
        }
        if (clevis > 0) {
          const s = snaps.find((x) => x?.ref?.id === "clevis");
          const cur = toFloat(s?.data()?.cantidad || 0);
          tx.update(matRefs.clevis, { cantidad: cur - clevis, actualizadoEn: serverTimestamp(), actualizadoPor: userData?.displayName || userData?.email || "Sistema" });
        }

        // d) registrar liquidación (colección central)
        const regRef = doc(collection(db, "liquidacion_materiales"));
        tx.set(regRef, {
          createdAt: serverTimestamp(),
          createdBy: userData?.displayName || userData?.email || "Sistema",
          userId: userData?.uid || null,

          // vínculo instalación básica
          instalacionId: row.id,
          fechaInstalacion: row.fechaInstalacion || null,
          codigoCliente: row.codigoCliente || "",
          cliente: row.cliente || "",
          cuadrillaNombre: cuadrillaNombre,
          cuadrillaId: cuadId,
          rc: row.residencialCondominio || cuadrillaInfo?.r_c || "",
          snONT: row.snONT || null,
          snMESH: Array.isArray(row.snMESH) ? row.snMESH.filter(Boolean) : [],
          snBOX: Array.isArray(row.snBOX) ? row.snBOX.filter(Boolean) : [],
          snFONO: row.snFONO || null,

          // captura de liquidación
          acta,
          rotulo,
          metraje, // metros descontados
          templadores,
          hebillas,
          cinta_bandi,
          clevis,
        });
      });

      toast.success("✅ Liquidación realizada y stock actualizado.");
      // limpiar mini-formulario de la fila
      setFormFila((p) => {
        const cp = { ...p };
        delete cp[row.id];
        return cp;
      });
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "No se pudo liquidar.");
    } finally {
      setGuardandoId(null);
    }
  };

  /* =========================
     Render
  ========================= */
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Liquidación de Materiales por Instalación</h1>
        <button
          onClick={() => scanRef.current?.focus()}
          className="text-sm px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-900"
          title="Ir al campo de escaneo"
        >
          ⌾ Foco en ACTA
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Mes</label>
          <Input type="month" name="mes" value={filtros.mes} onChange={onChangeFiltro} />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Día</label>
          <Input type="date" name="dia" value={filtros.dia} onChange={onChangeFiltro} />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Cuadrilla</label>
          <Input
            type="text"
            name="cuadrilla"
            placeholder="K11 RESIDENCIAL…"
            value={filtros.cuadrilla}
            onChange={onChangeFiltro}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">R/C</label>
          <select
            name="rc"
            value={filtros.rc}
            onChange={onChangeFiltro}
            className="border px-2 py-1 rounded"
          >
            <option value="">Todos</option>
            <option value="RESIDENCIAL">Residencial</option>
            <option value="CONDOMINIO">Condominio</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="text-sm font-medium text-gray-700">Código o Cliente</label>
          <Input
            type="text"
            name="busqueda"
            placeholder="Buscar por código o cliente…"
            value={filtros.busqueda}
            onChange={onChangeFiltro}
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr className="text-center text-gray-700 font-semibold">
              <th className="p-2 border w-36">Fecha</th>
              <th className="p-2 border w-48">Cuadrilla</th>
              <th className="p-2 border w-28">Código</th>
              <th className="p-2 border w-56">Cliente</th>
              <th className="p-2 border w-40">SN ONT</th>
              <th className="p-2 border w-60">SN MESH</th>
              <th className="p-2 border w-60">SN BOX</th>
              <th className="p-2 border w-40">SN FONO</th>
              <th className="p-2 border min-w-[520px]">Liquidar</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">Cargando…</td>
              </tr>
            ) : instsFiltradas.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No hay registros con los filtros actuales.
                </td>
              </tr>
            ) : (
              instsFiltradas.map((l) => {
                const f = convFecha(l.fechaInstalacion);
                const v = formFila[l.id] || {};
                const mesh = Array.isArray(l.snMESH) ? l.snMESH.filter(Boolean) : [];
                const box = Array.isArray(l.snBOX) ? l.snBOX.filter(Boolean) : [];
                const saving = guardandoId === l.id;

                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="border p-2 text-center">{fmt(f)}</td>
                    <td className="border p-2 text-center">{l.cuadrillaNombre || "-"}</td>
                    <td className="border p-2 text-center">{l.codigoCliente || "-"}</td>
                    <td className="border p-2">{l.cliente || "-"}</td>
                    <td className="border p-2 text-center">{l.snONT || "-"}</td>
                    <td className="border p-2">
                      {mesh.length ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {mesh.map((sn, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-800 border">
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="border p-2">
                      {box.length ? (
                        <div className="flex flex-wrap gap-1 justify-center">
                          {box.map((sn, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 border">
                              {sn}
                            </span>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="border p-2 text-center">{l.snFONO || "-"}</td>

                    {/* Bloque de liquidación */}
                    <td className="border p-2">
                      <div className="grid gap-2 md:grid-cols-6">
                        <input
                          ref={scanRef}
                          type="text"
                          inputMode="numeric"
                          placeholder="Nº ACTA (scan)"
                          className="border rounded px-2 py-1"
                          value={v.acta || ""}
                          onChange={(e) => setField(l.id, "acta", e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Rótulo NAP/CTO"
                          className="border rounded px-2 py-1"
                          value={v.rotulo || ""}
                          onChange={(e) => setField(l.id, "rotulo", e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Metros"
                          className="border rounded px-2 py-1"
                          value={v.metraje ?? ""}
                          onChange={(e) => setField(l.id, "metraje", e.target.value)}
                          title="Metraje instalado (descuenta bobina)"
                        />
                        <input
                          type="number"
                          min={0}
                          placeholder="Templadores"
                          className="border rounded px-2 py-1"
                          value={v.templadores ?? ""}
                          onChange={(e) => setField(l.id, "templadores", e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          placeholder="Hebillas"
                          className="border rounded px-2 py-1"
                          value={v.hebillas ?? ""}
                          onChange={(e) => setField(l.id, "hebillas", e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          placeholder="Cinta bandi"
                          className="border rounded px-2 py-1"
                          value={v.cinta_bandi ?? ""}
                          onChange={(e) => setField(l.id, "cinta_bandi", e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          placeholder="Clevis"
                          className="border rounded px-2 py-1"
                          value={v.clevis ?? ""}
                          onChange={(e) => setField(l.id, "clevis", e.target.value)}
                        />

                        <div className="md:col-span-6 flex justify-end">
                          <button
                            disabled={saving}
                            onClick={() => guardarLiquidacion(l)}
                            className={cls(
                              "px-4 py-1.5 rounded text-white",
                              saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-700"
                            )}
                          >
                            {saving ? "Guardando…" : "Liquidar"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        * La liquidación descuenta del stock de la cuadrilla (subcolección <code>stock_materiales</code>) y registra
        el movimiento en <code>liquidacion_materiales</code> con vínculo a la instalación.
      </p>
    </div>
  );
}
