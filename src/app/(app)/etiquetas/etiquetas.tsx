"use client";
// Etiquetas con código de barras y precios para la impresora de etiquetas (40×20 o 50×30 mm).
import JsBarcode from "jsbarcode";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buscar, type ProductoCaja } from "@/lib/caja";
import { guardar, leer } from "@/lib/caja-local";

type Tamanio = "40x20" | "50x30";
const FORMATOS: { id: Tamanio; nombre: string; ancho: number; alto: number }[] = [
  { id: "40x20", nombre: "40 × 20 mm", ancho: 40, alto: 20 },
  { id: "50x30", nombre: "50 × 30 mm", ancho: 50, alto: 30 },
];
interface Linea { id: string; cantidad: number }
interface Carga { clave: string; local_id: number; nota: string | null; creado_en: string; items: { producto_id: string; cantidad: number }[] }
const CLAVE = "magnolia-etiquetas";
const precio = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
/** Como en Precios Deco: el nombre lleva el SKU adelante si no lo tiene ya. */
const nombreConSku = (p: ProductoCaja) => (p[3].toLowerCase().includes(p[2].toLowerCase()) ? p[3] : `${p[2]} ${p[3]}`);
const pctEfectivo = (p: ProductoCaja) => (p[4] > 0 && p[5] > 0 && p[5] < p[4] ? Math.round((1 - p[5] / p[4]) * 100) : 0);

function Barras({ valor, alto }: { valor: string; alto: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    try { if (ref.current) JsBarcode(ref.current, valor, { format: "CODE128", width: 2, height: alto, displayValue: false, margin: 0 }); } catch {}
  }, [valor, alto]);
  return <svg ref={ref} className="etq-barras" preserveAspectRatio="none" />;
}

/** Mismo diseño que la última etiqueta de Precios Deco: nombre en una línea, código de punta a punta y los dos precios. */
export function Etiqueta({ p, tamanio }: { p: ProductoCaja; tamanio: Tamanio }) {
  const pct = pctEfectivo(p);
  return (
    <div className={`etq etq-${tamanio}`}>
      <div className="etq-nombre"><span>{nombreConSku(p)}</span></div>
      <Barras valor={p[1] || p[2]} alto={40} />
      <div className="etq-rotulos"><span>{pct ? `Efectivo ${pct}%` : "Efectivo"}</span><span>Precio lista</span></div>
      <div className="etq-precios"><b>{precio(p[5] || p[4])}</b><span>{precio(p[4])}</span></div>
    </div>
  );
}

export function Etiquetas() {
  const [catalogo, setCatalogo] = useState<ProductoCaja[] | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [tamanio, setTamanio] = useState<Tamanio>("40x20");
  const [busqueda, setBusqueda] = useState("");
  const [cargas, setCargas] = useState<Carga[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [montado, setMontado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const listo = useRef(false);

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (g?.lineas) setLineas(g.lineas);
      if (FORMATOS.some((f) => f.id === g?.tamanio)) setTamanio(g.tamanio);
    } catch {}
    listo.current = true;
    setMontado(true);
    (async () => {
      try { const c = await leer<{ productos: ProductoCaja[] }>("catalogo"); if (c) setCatalogo(c.productos); } catch {}
      try {
        const r = await fetch("/api/catalogo", { cache: "no-store" });
        if (r.ok) { const d = await r.json(); setCatalogo(d.productos); await guardar("catalogo", { ...d, guardado: new Date().toISOString() }); }
      } catch {}
      try { const r = await fetch("/api/stock/cargas", { cache: "no-store" }); if (r.ok) setCargas((await r.json()).cargas); } catch {}
    })();
  }, []);
  useEffect(() => {
    if (!listo.current) return;
    try { localStorage.setItem(CLAVE, JSON.stringify({ lineas, tamanio })); } catch {}
  }, [lineas, tamanio]);

  const porId = useMemo(() => new Map((catalogo ?? []).map((p) => [p[0], p])), [catalogo]);
  const m = busqueda.match(/^\s*(\d{1,3})\s*[*x]\s*(.+)$/i);
  const cant = m ? Number(m[1]) : 1;
  const texto = m ? m[2] : busqueda;
  const resultado = useMemo(() => (catalogo && texto.trim().length >= 2 ? buscar(catalogo, texto) : { exacto: null, resultados: [] }), [catalogo, texto]);

  const sumar = (items: Linea[]) => {
    setLineas((ls) => {
      const copia = [...ls];
      for (const it of items) {
        const i = copia.findIndex((l) => l.id === it.id);
        if (i >= 0) copia[i] = { ...copia[i], cantidad: copia[i].cantidad + it.cantidad };
        else copia.unshift(it);
      }
      return copia;
    });
    setBusqueda("");
    entrada.current?.focus();
  };
  const alEnter = () => {
    const p = resultado.exacto ?? (resultado.resultados.length === 1 ? resultado.resultados[0] : null);
    if (p) sumar([{ id: p[0], cantidad: cant }]);
    else if (texto.trim() && resultado.resultados.length === 0) { setAviso(`"${texto.trim()}" no está en el catálogo.`); setBusqueda(""); }
  };

  const impresas = lineas.flatMap((l) => { const p = porId.get(l.id); return p ? Array.from({ length: l.cantidad }, () => p) : []; });
  const total = impresas.length;
  const muestra = lineas.map((l) => porId.get(l.id)).find(Boolean);
  const formato = FORMATOS.find((f) => f.id === tamanio)!;
  const { ancho, alto } = formato;

  return (
    <div className="space-y-5">
      <style>{`@page { size: ${ancho}mm ${alto}mm; margin: 0; }`}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-suave">← Stock</Link>
          <h1 className="text-2xl font-semibold">Etiquetas</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {FORMATOS.map((f) => (
            <button key={f.id} onClick={() => setTamanio(f.id)}
              className={`rounded-full border px-3 py-1.5 ${tamanio === f.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{f.nombre}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="relative">
            <input ref={entrada} autoFocus value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setAviso(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); alEnter(); } if (e.key === "Escape") setBusqueda(""); }}
              placeholder={catalogo ? "Escaneá o buscá el producto (6*código = 6 etiquetas)" : "Cargando productos…"} className="campo !py-3 !text-lg" autoComplete="off" />
            {busqueda.trim().length >= 2 && resultado.resultados.length > 0 && !resultado.exacto && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-auto rounded-xl border border-linea bg-white shadow-lg">
                {resultado.resultados.map((p) => (
                  <li key={p[0]}><button onClick={() => sumar([{ id: p[0], cantidad: cant }])} className="block w-full px-4 py-2.5 text-left hover:bg-marca-claro">
                    <span className="block truncate">{p[3]}</span><span className="text-xs text-suave">{p[2]} · {precio(p[4])}</span></button></li>
                ))}
              </ul>
            )}
          </div>
          {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{aviso}</p>}

          <div className="rounded-2xl border border-linea bg-white">
            {lineas.length === 0 ? <p className="p-8 text-center text-suave">Escaneá productos o elegí una carga de mercadería.</p> : (
              <ul className="divide-y divide-linea">
                {lineas.map((l) => {
                  const p = porId.get(l.id);
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1"><span className="block truncate">{p?.[3] ?? "Producto que ya no está en el catálogo"}</span>
                        <span className="text-xs text-suave">{p ? `${p[2]} · ${precio(p[4])}${p[5] && p[5] !== p[4] ? ` · efvo ${precio(p[5])}` : ""}` : ""}</span></span>
                      <input type="number" min={0} value={l.cantidad} className="campo !w-20 text-center"
                        onChange={(e) => setLineas((ls) => ls.map((x) => (x.id === l.id ? { ...x, cantidad: Math.max(0, Math.min(500, Number(e.target.value) || 0)) } : x)))} />
                      <button aria-label="Quitar" className="px-2 text-xl text-suave hover:text-red-700" onClick={() => setLineas((ls) => ls.filter((x) => x.id !== l.id))}>×</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {cargas && cargas.length > 0 && (
            <section className="tarjeta">
              <h2 className="font-semibold">Etiquetas de una carga de mercadería</h2>
              <ul className="mt-2 divide-y divide-linea text-sm">
                {cargas.map((c) => (
                  <li key={c.clave} className="flex items-center justify-between gap-3 py-2">
                    <span>{new Date(c.creado_en).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {c.local_id === 2 ? "Beauty" : "Home"}{c.nota ? ` · ${c.nota}` : ""}
                      <span className="text-suave"> · {c.items.reduce((s, i) => s + i.cantidad, 0)} unidades</span></span>
                    <button className="boton-borde !py-1 text-sm" onClick={() => sumar(c.items.map((i) => ({ id: i.producto_id, cantidad: Math.round(i.cantidad) })))}>Agregar</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-3">
          <div className="tarjeta space-y-3">
            <p className="text-sm text-suave">Vista previa</p>
            <div className="flex justify-center rounded-lg bg-gray-100 p-4">
              {muestra ? <div className="etq-vista" style={{ width: `${ancho * 4}px`, height: `${alto * 4}px` }}><div style={{ transform: "scale(1)", transformOrigin: "top left" }}><Etiqueta p={muestra} tamanio={tamanio} /></div></div>
                : <p className="text-sm text-suave">—</p>}
            </div>
            <p className="text-xs text-suave">Mismo diseño que las etiquetas de Precios Deco.</p>
            <button className="boton w-full" disabled={total === 0} onClick={() => window.print()}>Imprimir {total} etiqueta{total === 1 ? "" : "s"}</button>
            {lineas.length > 0 && <button className="w-full text-sm text-suave underline" onClick={() => setLineas([])}>Vaciar lista</button>}
            <p className="text-xs text-suave">En la ventana de impresión elegí la impresora de etiquetas, tamaño de papel {ancho} × {alto} mm, márgenes &quot;Ninguno&quot; y escala 100%.</p>
          </div>
        </aside>
      </div>
      {montado && createPortal(
        <div id="zona-etiquetas">{impresas.map((p, i) => <Etiqueta key={i} p={p} tamanio={tamanio} />)}</div>,
        document.body,
      )}
    </div>
  );
}
