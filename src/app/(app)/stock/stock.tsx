"use client";
// Cargar mercadería y controlar stock con el lector de códigos.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscar, type ProductoCaja } from "@/lib/caja";
import { guardar, leer } from "@/lib/caja-local";

type Modo = "ingreso" | "conteo" | "transferencia";
interface Linea { id: string; sku: string; nombre: string; cantidad: number }

const LOCALES = [{ id: 1, nombre: "Magnolia Home" }, { id: 2, nombre: "Magnolia Beauty" }];
const claveBorrador = (modo: Modo, local: number) => `magnolia-stock-${modo}-${local}`;

export function Stock({ duenio = false }: { duenio?: boolean }) {
  const [catalogo, setCatalogo] = useState<ProductoCaja[] | null>(null);
  const [local, setLocal] = useState<number>(1);
  const [modo, setModo] = useState<Modo>("ingreso");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [desconocidos, setDesconocidos] = useState<string[]>([]);
  const [sistema, setSistema] = useState<Record<string, number> | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [nota, setNota] = useState("");
  const [completo, setCompleto] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [cargaHecha, setCargaHecha] = useState<{ id: string; cantidad: number }[] | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const cargado = useRef(false);

  // Catálogo: el que tiene la caja guardado, y se actualiza desde el servidor
  useEffect(() => {
    try {
      const l = Number(localStorage.getItem("magnolia-local"));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (l === 1 || l === 2) setLocal(l);
      const q = new URLSearchParams(location.search);
      if (q.get("modo") === "transferencia") setModo("transferencia");
      const d = Number(q.get("local"));
      if (d === 1 || d === 2) setLocal(d);
    } catch {}
    (async () => {
      try { const c = await leer<{ productos: ProductoCaja[] }>("catalogo"); if (c) setCatalogo(c.productos); } catch {}
      try {
        const r = await fetch("/api/catalogo", { cache: "no-store" });
        if (r.ok) { const d = await r.json(); setCatalogo(d.productos); await guardar("catalogo", { ...d, guardado: new Date().toISOString() }); }
      } catch {}
    })();
  }, []);

  // Borrador: si se recarga la página no se pierde lo escaneado
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(claveBorrador(modo, local)) ?? "null");
      // Al cambiar de local o de modo se carga el borrador guardado en esta compu
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLineas(b?.lineas ?? []);
      setDesconocidos(b?.desconocidos ?? []);
      setNota(b?.nota ?? "");
    } catch { setLineas([]); setDesconocidos([]); }
    cargado.current = true;
    setCompleto(false);
    setAviso(null);
  }, [modo, local]);
  useEffect(() => {
    if (!cargado.current) return;
    try { localStorage.setItem(claveBorrador(modo, local), JSON.stringify({ lineas, desconocidos, nota })); } catch {}
  }, [lineas, desconocidos, nota, modo, local]);

  // Stock del sistema (para el control)
  const traerSistema = useCallback(async () => {
    try {
      const r = await fetch(`/api/stock?local=${local}`, { cache: "no-store" });
      setSistema(r.ok ? (await r.json()).stock : null);
    } catch { setSistema(null); }
  }, [local]);
  // Trae del servidor el stock del local elegido (el estado se actualiza al llegar la respuesta)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { traerSistema(); }, [traerSistema]);

  const m = busqueda.match(/^\s*(\d{1,4})\s*[*x]\s*(.+)$/i);
  const cantidadPedida = m ? Number(m[1]) : 1;
  const texto = m ? m[2] : busqueda;
  const resultado = useMemo(
    () => (catalogo && texto.trim().length >= 2 ? buscar(catalogo, texto) : { exacto: null, resultados: [] }),
    [catalogo, texto],
  );

  const sumar = (p: ProductoCaja, n = cantidadPedida) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.id === p[0]);
      if (i >= 0) {
        const copia = [...ls];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + n };
        return [copia[i], ...copia.filter((_, j) => j !== i)]; // el último escaneado arriba
      }
      return [{ id: p[0], sku: p[2], nombre: p[3], cantidad: n }, ...ls];
    });
    setUltimo(`${n > 1 ? `${n} × ` : ""}${p[3]}`);
    setBusqueda("");
    entrada.current?.focus();
  };

  const alEnter = () => {
    if (resultado.exacto) return sumar(resultado.exacto);
    if (resultado.resultados.length === 1) return sumar(resultado.resultados[0]);
    if (resultado.resultados.length === 0 && texto.trim()) {
      const t = texto.trim();
      setDesconocidos((d) => (d.includes(t) ? d : [t, ...d]));
      setUltimo(null);
      setAviso({ ok: false, texto: `"${t}" no está en el catálogo. Quedó anotado abajo.` });
      setBusqueda("");
    }
  };

  const confirmar = async () => {
    if (lineas.length === 0) return;
    setEnviando(true);
    setAviso(null);
    try {
      const items = lineas.map((l) => ({ producto_id: l.id, cantidad: l.cantidad }));
      const r = modo === "transferencia"
        ? await fetch("/api/stock/transferir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desde: local, hasta: otro.id, nota, items }) })
        : await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local, tipo: modo, completo, nota, items }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "error");
      setAviso({ ok: true, texto: modo === "transferencia" ? `Listo: pasaron ${lineas.reduce((s, l) => s + l.cantidad, 0)} unidades de ${LOCALES.find((l) => l.id === local)?.nombre} a ${otro.nombre}.` : modo === "ingreso" ? `Mercadería cargada: ${lineas.reduce((s, l) => s + l.cantidad, 0)} unidades de ${lineas.length} productos.` : `Control aplicado: ${d.cambiados} productos ajustados.` });
      setCargaHecha(modo === "ingreso" ? lineas.map((l) => ({ id: l.id, cantidad: l.cantidad })) : null);
      setLineas([]); setDesconocidos([]); setNota(""); setCompleto(false);
      traerSistema();
    } catch (e) {
      setAviso({ ok: false, texto: `No se pudo guardar (${(e as Error).message}). Lo escaneado sigue acá: probá de nuevo cuando haya internet.` });
    } finally {
      setEnviando(false);
      entrada.current?.focus();
    }
  };

  const otro = LOCALES.find((l) => l.id !== local)!;
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const diferencias = modo === "conteo" && sistema ? lineas.filter((l) => (sistema[l.id] ?? 0) !== l.cantidad).length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Stock</h1>
          <Link href="/etiquetas" className="rounded-full border border-linea bg-white px-3 py-1 text-sm">Etiquetas</Link>
          {duenio && <Link href="/stock/reposicion" className="rounded-full border border-marca px-3 py-1 text-sm text-marca">Reposición y faltantes →</Link>}
        </div>
        <div className="flex gap-2 text-sm">
          {LOCALES.map((l) => (
            <button key={l.id} onClick={() => setLocal(l.id)}
              className={`rounded-full border px-3 py-1.5 ${local === l.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{l.nombre}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
        {([["ingreso", "Cargar mercadería"], ["conteo", "Controlar stock"], ["transferencia", "Pasar al otro local"]] as const).map(([id, t]) => (
          <button key={id} onClick={() => setModo(id)}
            className={`rounded-xl border px-3 py-3 text-sm font-semibold ${modo === id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{t}</button>
        ))}
      </div>
      <p className="text-sm text-suave">
        {modo === "transferencia"
          ? `Escaneá lo que sale de ${LOCALES.find((l) => l.id === local)?.nombre} hacia ${otro.nombre}. Al confirmar, se resta en un local y se suma en el otro.`
          : modo === "ingreso"
          ? "Escaneá cada unidad que llegó (o 6*código para 6 unidades). Al confirmar, se suma al stock del local."
          : "Escaneá todo lo que hay en el estante o sector. Al confirmar, el stock de esos productos queda en lo que contaste."}
      </p>

      <div className="relative">
        <input ref={entrada} autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); alEnter(); } if (e.key === "Escape") setBusqueda(""); }}
          placeholder={catalogo ? "Escaneá o buscá el producto" : "Cargando productos…"} className="campo !py-3 !text-lg" autoComplete="off" inputMode="search" />
        {busqueda.trim().length >= 2 && !resultado.exacto && resultado.resultados.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-auto rounded-xl border border-linea bg-white shadow-lg">
            {resultado.resultados.map((p) => (
              <li key={p[0]}>
                <button onClick={() => sumar(p)} className="block w-full px-4 py-2.5 text-left hover:bg-marca-claro">
                  <span className="block truncate">{p[3]}</span><span className="text-xs text-suave">{p[2]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {ultimo && <p className="text-sm text-green-800">✓ {ultimo}</p>}
      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}
        {aviso.ok && cargaHecha && (
          <button className="ml-2 font-semibold underline" onClick={() => {
            try {
              const g = JSON.parse(localStorage.getItem("magnolia-etiquetas") ?? "null") ?? {};
              localStorage.setItem("magnolia-etiquetas", JSON.stringify({ ...g, lineas: cargaHecha }));
            } catch {}
            location.href = "/etiquetas";
          }}>Imprimir etiquetas de esta carga</button>
        )}</p>}

      <div className="rounded-2xl border border-linea bg-white">
        {lineas.length === 0 ? (
          <p className="p-8 text-center text-suave">Todavía no escaneaste nada.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {lineas.map((l) => {
              const antes = sistema?.[l.id] ?? 0;
              const dif = l.cantidad - antes;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.nombre}</span>
                    <span className="text-xs text-suave">
                      {l.sku} · en sistema: {sistema ? antes : "…"}
                      {modo === "ingreso" && sistema ? ` → quedará ${antes + l.cantidad}` : ""}
                      {modo === "transferencia" && sistema ? ` → quedará ${antes - l.cantidad}` : ""}
                      {modo === "transferencia" && sistema && l.cantidad > antes && <b className="text-red-700"> (hay menos en sistema)</b>}
                      {modo === "conteo" && sistema && dif !== 0 && <b className={dif > 0 ? " text-green-800" : " text-red-700"}> ({dif > 0 ? "+" : ""}{dif})</b>}
                    </span>
                  </span>
                  <input type="number" min={0} value={l.cantidad} className="campo !w-24 text-center"
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.id === l.id ? { ...x, cantidad: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                  <button aria-label="Quitar" className="px-2 text-xl text-suave hover:text-red-700" onClick={() => setLineas((ls) => ls.filter((x) => x.id !== l.id))}>×</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {desconocidos.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <b>Códigos que no están en el catálogo ({desconocidos.length}):</b> {desconocidos.join(", ")}
          <span className="block text-xs">Cargalos en Precios Deco, importá de nuevo y volvé a escanearlos.</span>
          <button className="mt-1 text-xs underline" onClick={() => setDesconocidos([])}>Borrar lista</button>
        </div>
      )}

      <div className="tarjeta space-y-3">
        <label className="block">
          <span className="etiqueta">Nota (opcional)</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className="campo" placeholder={modo === "ingreso" ? "Ej: remito Infinita 12/11" : modo === "transferencia" ? "Ej: lleva Juli el martes" : "Ej: estante tazas"} />
        </label>
        {modo === "conteo" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={completo} onChange={(e) => setCompleto(e.target.checked)} className="mt-1" />
            <span>
              Es un <b>inventario completo</b> del local
              <span className="block text-suave">Todo lo que NO escaneaste queda en 0. Usalo solo si contaste el local entero.</span>
            </span>
          </label>
        )}
        <p className="text-sm text-suave">
          {lineas.length} productos · {unidades} unidades{modo === "conteo" && sistema ? ` · ${diferencias} con diferencia` : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="boton" disabled={lineas.length === 0 || enviando} onClick={confirmar}>
            {enviando ? "Guardando…" : modo === "transferencia" ? `Pasar a ${otro.nombre}` : modo === "ingreso" ? "Confirmar carga" : completo ? "Aplicar inventario completo" : "Aplicar control"}
          </button>
          {lineas.length > 0 && <button className="text-sm text-suave underline" onClick={() => { setLineas([]); setDesconocidos([]); }}>Empezar de nuevo</button>}
        </div>
      </div>
    </div>
  );
}
