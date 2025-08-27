"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/firebaseConfig";
import {
  collection, getDocs, query, where, orderBy, startAt, endAt
} from "firebase/firestore";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ====== UI ====== */
const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
);
const H3 = ({ children }) => <h3 className="text-sm font-semibold text-gray-700">{children}</h3>;
const StatNum = ({ children }) => <span className="text-xl font-bold tabular-nums">{children}</span>;
const Pill = ({ children, tone = "default" }) => {
  const map = {
    default: "bg-gray-100 text-gray-700 ring-gray-200",
    warn: "bg-yellow-100 text-yellow-800 ring-yellow-200",
    error: "bg-red-100 text-red-800 ring-red-200",
    ok: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${map[tone]}`}>{children}</span>;
};

/* ===== Botones ===== */
const Button = ({ children, className = "", ...props }) => (
  <button
    className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium 
      bg-[#30518c] text-white hover:opacity-90 disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const ButtonSecondary = ({ children, className = "", ...props }) => (
  <button
    className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium 
      bg-white text-gray-700 border border-gray-300 shadow-sm 
      hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 
      disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);


/* ====== Constantes & utils ====== */
const EQUIP = ["ONT", "MESH", "FONO", "BOX"];
const emptyCounts = () => ({ ONT: 0, MESH: 0, FONO: 0, BOX: 0 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ymdToday = () => dayjs().format("YYYYMMDD");
const toneByStockDiff = (diff) => (diff > 0 ? "warn" : diff < 0 ? "error" : "ok");

/* palabras que invalidan la ubicación para el KPI de almacén */
const EXCLUDE_UBIC = [
  "robo","robado",
  "pérdida","perdida",
  "avería","averia",
  "garantía","garantia"
];
const isExcludedUbicacion = (u) => {
  const s = String(u || "").toLowerCase();
  return EXCLUDE_UBIC.some(w => s.includes(w));
};

function wednesdayAnchors(anchorYMD) {
  let d = dayjs(anchorYMD).startOf("day");
  let curWed = d.day(3);
  if (curWed.isAfter(d)) curWed = curWed.subtract(7, "day");
  const prevWed = curWed.subtract(7, "day");
  const nextWed = curWed.add(7, "day");
  return { prevWed, curWed, nextWed };
}

/* ====== MultiSelect ====== */
function MultiSelect({ options, value = [], onChange, placeholder = "Elegir..." }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => (o.nombre || "").toLowerCase().includes(t));
  }, [options, term]);
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(Array.from(next));
  };
  return (
    <div className="relative">
      <div className="flex gap-2">
        <Button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50" onClick={() => setOpen(o => !o)}>
          {value.length ? `${value.length} seleccionados` : placeholder}
          <svg className="ml-2 h-4 w-4 opacity-60" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.085l3.71-3.855a.75.75 0 111.08 1.04l-4.24 4.4a.75.75 0 01-1.08 0l-4.24-4.4a.75.75 0 01.02-1.06z"/></svg>
        </Button>
        {value.length > 0 && (
  <ButtonSecondary type="button" onClick={() => onChange([])}>
    Limpiar filtros
  </ButtonSecondary>
)}

      </div>
      {open && (
        <div className="absolute z-30 mt-2 w-80 max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg p-2">
          <input className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm mb-2" placeholder="Buscar..." value={term} onChange={e => setTerm(e.target.value)} />
          <div className="space-y-1">
            {filtered.map(o => (
              <label key={o.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                <span className="text-sm">{o.nombre}</span>
              </label>
            ))}
            {filtered.length === 0 && <div className="text-xs text-gray-500 px-2 py-1">Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== Página ====================== */
export default function AbastecimientoPage() {
  /* Filtros */
  const [anchor, setAnchor] = useState(dayjs().format("YYYY-MM-DD"));
  const { prevWed, curWed, nextWed } = useMemo(() => wednesdayAnchors(anchor), [anchor]);

  const [coors, setCoors] = useState([]);        // {id, nombre}
  const [selCoors, setSelCoors] = useState([]);  // IDs seleccionados
  const [textoCuadrilla, setTextoCuadrilla] = useState("");

  const [objetivo, setObjetivo] = useState({ ONT: 15, MESH: 5, FONO: 2, BOX: 1 });

  /* Datos */
  const [cuadrillas, setCuadrillas] = useState([]);
  const [stockAlmacen, setStockAlmacen] = useState(emptyCounts());
  const [stockCuadrilla, setStockCuadrilla] = useState({});
  const [consumoPorCuadrilla, setConsumoPorCuadrilla] = useState({});
  const [consumoTotal, setConsumoTotal] = useState(emptyCounts());

  /* UI */
  const [calculando, setCalculando] = useState(false);
  const [sugeridos, setSugeridos] = useState({});
  const [manual, setManual] = useState({});
  const [bobina, setBobina] = useState({});
  const [rollo, setRollo] = useState({});

  /* ==== Coordinadores ==== */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "usuarios"), where("rol", "array-contains", "Coordinador")));
      const arr = snap.docs.map(d => {
        const x = d.data();
        const nombre = `${x.nombres || ""} ${x.apellidos || ""}`.trim() || x.displayName || x.email || d.id;
        return { id: d.id, nombre };
      }).sort((a,b) => a.nombre.localeCompare(b.nombre));
      setCoors(arr);
    })();
  }, []);

  const coorMap = useMemo(() => {
    const m = {}; for (const c of coors) m[c.id] = c.nombre; return m;
  }, [coors]);

  function coordCandidates(cu) {
    const out = new Set();
    for (const k of ["coordinadorId","coordinadorUid","coordinadorUID","coordinador","coordinadorNombre"]) {
      if (cu[k]) out.add(String(cu[k]));
    }
    return out;
  }
  function prettyCoordName(cu) {
    const cands = coordCandidates(cu);
    for (const v of cands) { if (coorMap[v]) return coorMap[v]; }
    for (const v of cands) { if (!coorMap[v]) return v; }
    return "";
  }

  /* ==== Solo cuadrillas activas + filtro por coordinador/texto ==== */
  function isActiveCuadrilla(cu) {
    const raw = cu.estado ?? cu.estado_cuadrilla ?? cu.estadoCuadrilla ?? cu.activo ?? cu.isActive;
    if (typeof raw === "boolean") return raw;
    const s = String(raw || "").toLowerCase().trim();
    return s === "activo" || s === "activa";
  }

  useEffect(() => {
    (async () => {
      const hasCoors = selCoors.length > 0;
      const hasText  = textoCuadrilla.trim().length >= 2;

      if (!hasCoors && !hasText) {
        setCuadrillas([]); setStockCuadrilla({}); setConsumoPorCuadrilla({}); setSugeridos({});
        return;
      }

      const snap = await getDocs(collection(db, "cuadrillas"));
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      list = list.filter(isActiveCuadrilla);

      if (hasCoors) {
        const selectedNames = selCoors.map(id => coorMap[id]).filter(Boolean);
        list = list.filter(cu => {
          const cands = coordCandidates(cu);
          for (const id of selCoors) if (cands.has(id)) return true;
          const txt = (cu.coordinador || cu.coordinadorNombre || "").toString().toLowerCase();
          return selectedNames.some(n => txt === (n || "").toLowerCase());
        });
      }

      if (hasText) {
        const t = textoCuadrilla.trim().toLowerCase();
        list = list.filter(cu => (cu.nombre || cu.id).toLowerCase().includes(t));
      }

      list.sort((a,b) => (a.nombre || a.id).localeCompare(b.nombre || b.id));
      setCuadrillas(list);
    })();
  }, [selCoors, textoCuadrilla, coorMap]);

  /* ==== Stock en Almacén (criterio por UBICACIÓN excluida) ==== */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "equipos"), where("estado", "==", "almacen")));
      const acc = emptyCounts();
      snap.forEach(d => {
        const x = d.data();
        const eq = String(x.equipo || "").toUpperCase();
        if (!EQUIP.includes(eq)) return;
        // EXCLUSIÓN por UBICACIÓN (robo/perdida/averia/garantia)
        if (isExcludedUbicacion(x.ubicacion)) return;
        acc[eq] += 1;
      });
      setStockAlmacen(acc);
    })();
  }, []);

  /* ==== Stock por cuadrilla ==== */
  useEffect(() => {
    (async () => {
      if (!cuadrillas.length) { setStockCuadrilla({}); return; }
      const out = {};
      for (const cu of cuadrillas) {
        const ubic = cu.nombre || cu.id;
        const snap = await getDocs(query(collection(db, "equipos"), where("estado", "==", "campo"), where("ubicacion", "==", ubic)));
        const acc = emptyCounts();
        snap.forEach(d => {
          const x = d.data();
          const eq = String(x.equipo || "").toUpperCase();
          if (!EQUIP.includes(eq)) return;
          acc[eq] += 1;
        });
        out[cu.id] = acc;
      }
      setStockCuadrilla(out);
    })();
  }, [cuadrillas]);

  /* ==== Parseo fecha liquidaciones ==== */
  function parseMaybeTimestampOrString(v) {
    if (v && typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
    try {
      const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
      const s = String(v || "").toLowerCase();
      const mIdx = meses.findIndex(m => s.includes(m));
      if (mIdx >= 0) {
        const dia = Number((s.match(/\b(\d{1,2})\b/)||[])[1]);
        const año = Number((s.match(/\b(20\d{2})\b/)||[])[1]);
        if (dia && año) return new Date(año, mIdx, dia);
      }
    } catch {}
    return null;
  }

  /* ==== Liquidadas prevWed → curWed para cuadrillas visibles ==== */
  async function cargarConsumos() {
    const ref = collection(db, "liquidacion_instalaciones");

    let docs = [];
    try {
      const snap = await getDocs(
        query(
          ref,
          orderBy("fechaLiquidacion"),
          startAt(prevWed.toDate()),
          endAt(curWed.endOf("day").toDate())
        )
      );
      docs = snap.docs;
    } catch {
      const snap = await getDocs(ref);
      docs = snap.docs.filter(d => {
        const x = d.data();
        const dt = parseMaybeTimestampOrString(x.fechaLiquidacion || x.fecha_liquidacion || x.fecha || x.createdAt);
        return dt && dt >= prevWed.toDate() && dt <= curWed.endOf("day").toDate();
      });
    }

    const visibles = new Set(cuadrillas.map(c => c.nombre || c.id));
    const porCu = {};
    let total = emptyCounts();

    for (const d of docs) {
      const x = d.data();
      const cuNombre = x.cuadrillaNombre || x.gestorCuadrilla || x.cuadrilla || "";
      if (!visibles.has(cuNombre)) continue;

      const c = { ONT: 0, MESH: 0, FONO: 0, BOX: 0 };
      const hasONT  = !!x.proidONT || !!x.snONT || !!x.proid ||
                      (x.snMESH && (x.snMESH.snONT || x.snMESH.ont || x.snMESH.serieONT));
      const hasMESH = !!x.snMESH || (x.cantidadMesh && Number(x.cantidadMesh) > 0) ||
                      (x.kitWifiPro && String(x.kitWifiPro).toLowerCase().includes("kit"));
      const hasFONO = !!x.snFONO || (x.cantidadFono && Number(x.cantidadFono) > 0);
      const hasBOX  = !!x.snBOX || (x.cantidadBox && Number(x.cantidadBox) > 0);

      if (hasONT)  c.ONT  = 1;
      if (hasMESH) c.MESH = 1;
      if (hasFONO) c.FONO = 1;
      if (hasBOX)  c.BOX  = 1;

      porCu[cuNombre] = {
        ONT: (porCu[cuNombre]?.ONT || 0) + c.ONT,
        MESH: (porCu[cuNombre]?.MESH || 0) + c.MESH,
        FONO: (porCu[cuNombre]?.FONO || 0) + c.FONO,
        BOX: (porCu[cuNombre]?.BOX || 0) + c.BOX,
      };
      total = {
        ONT: total.ONT + c.ONT,
        MESH: total.MESH + c.MESH,
        FONO: total.FONO + c.FONO,
        BOX: total.BOX + c.BOX,
      };
    }

    setConsumoPorCuadrilla(porCu);
    setConsumoTotal(total);
  }

  /* ==== Sugeridos ==== */
  function recalcularSugeridos() {
    const ideal = {};
    for (const cu of cuadrillas) {
      const st = stockCuadrilla[cu.id] || emptyCounts();
      ideal[cu.id] = {
        ONT:  Math.max(0, (objetivo.ONT  || 0) - (st.ONT  || 0)),
        MESH: Math.max(0, (objetivo.MESH || 0) - (st.MESH || 0)),
        FONO: Math.max(0, (objetivo.FONO || 0) - (st.FONO || 0)),
        BOX:  Math.max(0, (objetivo.BOX  || 0) - (st.BOX  || 0)),
      };
    }

    const tot = { ONT:0, MESH:0, FONO:0, BOX:0 };
    for (const cu of cuadrillas) for (const k of EQUIP) tot[k] += ideal[cu.id][k];
    const final = {}; for (const cu of cuadrillas) final[cu.id] = { ...ideal[cu.id] };

    for (const k of EQUIP) {
      const pedir = tot[k], disp = stockAlmacen[k];
      if (pedir <= 0 || disp >= pedir) continue;
      const propor = cuadrillas.map(cu => ({ id: cu.id, need: ideal[cu.id][k] }));
      let asignados = 0;
      for (const p of propor) { const cuota = Math.floor((p.need / pedir) * disp); final[p.id][k] = cuota; asignados += cuota; }
      let residuo = disp - asignados;
      for (const p of propor) { if (!residuo) break; if (final[p.id][k] < p.need) { final[p.id][k] += 1; residuo -= 1; } }
    }
    setSugeridos(final);
    setManual(prev => { const next = {}; for (const cu of cuadrillas) next[cu.id] = { ...(prev[cu.id] || {}) }; return next; });
  }

  async function handleCalcular() {
    setCalculando(true);
    try {
      await cargarConsumos();
      recalcularSugeridos();
    } finally { setCalculando(false); }
  }

  function valorFinal(cuId, k) {
    const sug = sugeridos[cuId]?.[k] || 0;
    const man = manual[cuId]?.[k];
    const v = Number.isFinite(Number(man)) ? Number(man) : sug;
    return clamp(v, 0, stockAlmacen[k]);
  }

  /* ==== Exportar ==== */
  function buildExportRows() {
    return cuadrillas.map(cu => ({
      Coordinador: prettyCoordName(cu),
      Cuadrilla: cu.nombre || cu.id,
      "Sug ONT":  valorFinal(cu.id, "ONT"),
      "Sug MESH": valorFinal(cu.id, "MESH"),
      "Sug FONO": valorFinal(cu.id, "FONO"),
      "Sug BOX":  valorFinal(cu.id, "BOX"),
    }));
  }
  function onExportExcel() {
    if (!cuadrillas.length) return;
    const ws = XLSX.utils.json_to_sheet(buildExportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Abastecimiento");
    XLSX.writeFile(wb, `DESPACHO-${ymdToday()}.xlsx`);
  }
  function onExportPDF() {
    if (!cuadrillas.length) return;
    const data = buildExportRows();
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text(`DESPACHO ${dayjs().format("DD/MM/YYYY")}  •  Sugeridos`, 14, 12);
    autoTable(doc, {
      startY: 16,
      head: [[ "Coordinador","Cuadrilla","Sug ONT","Sug MESH","Sug FONO","Sug BOX" ]],
      body: data.map(r => [ r["Coordinador"], r["Cuadrilla"], r["Sug ONT"], r["Sug MESH"], r["Sug FONO"], r["Sug BOX"] ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [48, 81, 140] },
    });
    doc.save(`DESPACHO-${ymdToday()}.pdf`);
  }

  /* KPI (semáforo) */
  const kpiCritico = useMemo(() => {
    const crit = {}; for (const k of EQUIP) crit[k] = stockAlmacen[k] < 10; return crit;
  }, [stockAlmacen]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Filtros */}
      <div className="grid lg:grid-cols-4 gap-4">
        <Card>
          <H3>Miércoles ancla</H3>
          <div className="mt-2">
            <input type="date" className="w-full rounded-xl border px-2 py-1" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
            <p className="mt-2 text-xs text-gray-500">
              Consumo: {prevWed.format("DD/MM")} → {curWed.format("DD/MM")} • Abastecer: {curWed.format("DD/MM")} → {nextWed.format("DD/MM")}
            </p>
          </div>
        </Card>

        <Card>
          <H3>Coordinadores</H3>
          <div className="mt-2">
            <MultiSelect options={coors} value={selCoors} onChange={setSelCoors} placeholder="Elegir uno o varios…" />
          </div>
        </Card>

        <Card>
          <H3>Buscar cuadrilla</H3>
          <input className="mt-2 w-full rounded-xl border px-2 py-1" placeholder="Escribe al menos 2 letras…" value={textoCuadrilla} onChange={(e) => setTextoCuadrilla(e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-500">La tabla se mostrará cuando selecciones coordinador(es) y/o escribas 2+ letras.</p>
        </Card>

        <Card>
          <H3>Objetivo por cuadrilla</H3>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {EQUIP.map(k => (
              <div key={k}>
                <label className="text-[11px] text-gray-500">{k}</label>
                <input type="number" min={0} className="mt-1 w-full rounded-xl border px-2 py-1 text-right"
                  value={objetivo[k]} onChange={(e) => setObjetivo(o => ({ ...o, [k]: Number(e.target.value || 0) }))} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button onClick={handleCalcular} disabled={calculando || !cuadrillas.length}>{calculando ? "Calculando..." : "Calcular sugerencias"}</Button>
        <Button onClick={onExportExcel} disabled={!cuadrillas.length} className="bg-emerald-600">Exportar Excel</Button>
        <Button onClick={onExportPDF}   disabled={!cuadrillas.length} className="bg-rose-600">Exportar PDF</Button>
      </div>

      {/* KPIs */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <H3>Stock en Almacén</H3>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {EQUIP.map(k => (
              <div key={k} className="text-center">
                <div className="text-[11px] text-gray-500">{k}</div>
                <StatNum>{stockAlmacen[k]}</StatNum>
                <div className="mt-1"><Pill tone={kpiCritico[k] ? "warn" : "ok"}>{kpiCritico[k] ? "Bajo" : "OK"}</Pill></div>
                <div className="text-[11px] text-gray-400">En almacén</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="md:col-span-2">
          <H3>Consumo semanal (liquidadas)</H3>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {EQUIP.map(k => (
              <div key={k} className="text-center">
                <div className="text-[11px] text-gray-500">{k}</div>
                <StatNum>{consumoTotal[k]}</StatNum>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500">{prevWed.format("YYYY-MM-DD")} → {curWed.format("YYYY-MM-DD")}</div>
        </Card>

        <Card>
          <H3>Totales sugeridos</H3>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {EQUIP.map(k => {
              let total = 0; for (const cu of cuadrillas) total += valorFinal(cu.id, k);
              return (<div key={k} className="text-center"><div className="text-[11px] text-gray-500">{k}</div><StatNum>{total}</StatNum></div>);
            })}
          </div>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <H3>Abastecimiento por Cuadrilla</H3>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left">
                <th className="py-2 px-3">Coordinador</th>
                <th className="py-2 px-3">Cuadrilla</th>
                <th className="py-2 px-3">Liquidadas (ONT/MESH/FONO/BOX)</th>
                <th className="py-2 px-3">Stock Actual</th>
                <th className="py-2 px-3">Objetivo</th>
                <th className="py-2 px-3">Sugerido</th>
                <th className="py-2 px-3">Ajuste manual</th>
                <th className="py-2 px-3">Resi (bobina)</th>
                <th className="py-2 px-3">Condo (rollo)</th>
                <th className="py-2 px-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuadrillas.length === 0 && (
                <tr><td className="py-6 px-3 text-center text-gray-500" colSpan={10}>Usa los filtros para cargar cuadrillas.</td></tr>
              )}
              {cuadrillas.map(cu => {
                const nombre = cu.nombre || cu.id;
                const cons = consumoPorCuadrilla[nombre] || emptyCounts();
                const st   = stockCuadrilla[cu.id] || emptyCounts();
                const diffTotal = EQUIP.reduce((acc, k) => acc + ((objetivo[k] || 0) - (st[k] || 0)), 0);
                const tone = toneByStockDiff(diffTotal);
                return (
                  <tr key={cu.id} className="border-t border-gray-100">
                    <td className="py-2 px-3">{prettyCoordName(cu)}</td>
                    <td className="py-2 px-3">
                      <div className="font-medium">{nombre}</div>
                      <div className="text-xs text-gray-500">{cu.tipo || ""}</div>
                    </td>
                    <td className="py-2 px-3 tabular-nums">
                      {EQUIP.map(k => <span key={k} className="inline-block w-10 text-center">{cons[k] || 0}</span>)}
                    </td>
                    <td className="py-2 px-3 tabular-nums">
                      {EQUIP.map(k => <span key={k} className="inline-block w-10 text-center">{st[k] || 0}</span>)}
                    </td>
                    <td className="py-2 px-3 tabular-nums">
                      {EQUIP.map(k => <span key={k} className="inline-block w-10 text-center">{objetivo[k] || 0}</span>)}
                    </td>
                    <td className="py-2 px-3 tabular-nums">
                      {EQUIP.map(k => <span key={k} className="inline-block w-10 text-center">{valorFinal(cu.id, k)}</span>)}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        {EQUIP.map(k => (
                          <input key={k} type="number" min={0} className="w-14 rounded-lg border px-1 py-0.5 text-right"
                            value={manual[cu.id]?.[k] ?? ""} placeholder="-"
                            onChange={(e) => setManual(m => ({ ...m, [cu.id]: { ...(m[cu.id] || {}), [k]: e.target.value === "" ? "" : Number(e.target.value) } }))} />
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={!!bobina[cu.id]} onChange={(e)=>setBobina(b=>({...b,[cu.id]:e.target.checked}))}/>
                    </td>
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={!!rollo[cu.id]} onChange={(e)=>setRollo(r=>({...r,[cu.id]:e.target.checked}))}/>
                    </td>
                    <td className="py-2 px-3"><Pill tone={tone}>{tone === "ok" ? "OK" : tone === "warn" ? "Bajo stock" : "Sobre-stock"}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
