"use client";
// Lista de cobros con selección masiva: marcar muchos como venta / no venta de una vez, sin esperar cada uno.
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { marcarCobros } from "@/app/acciones";
import { fechaCorta, hora, ORIGENES, pesos } from "@/lib/formato";

export type FilaCobro = { id: string; dia: string; fecha_hora: string; importe: number; origen: string; detalle: string | null; estado: string; mensaje: string | null };
type Destino = "a_facturar" | "no_es_venta" | "revisar";

export function ListaCobros({ filas, pestana }: { filas: FilaCobro[]; pestana: string }) {
  const router = useRouter();
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [, empezar] = useTransition();
  const visibles = useMemo(() => filas.filter((f) => !ocultos.has(f.id)), [filas, ocultos]);
  const elegidos = visibles.filter((f) => sel.has(f.id));
  const total = elegidos.reduce((s, f) => s + Number(f.importe), 0);

  // Botones según la pestaña
  const botones: { destino: Destino; texto: string; principal?: boolean }[] =
    pestana === "revisar" ? [{ destino: "a_facturar", texto: "Es venta", principal: true }, { destino: "no_es_venta", texto: "No es venta" }]
    : pestana === "error" ? [{ destino: "a_facturar", texto: "Reintentar", principal: true }, { destino: "no_es_venta", texto: "No es venta" }]
    : pestana === "a_facturar" ? [{ destino: "no_es_venta", texto: "No es venta" }, { destino: "revisar", texto: "Volver a revisar" }]
    : pestana === "no_es_venta" ? [{ destino: "a_facturar", texto: "Es venta", principal: true }, { destino: "revisar", texto: "Volver a revisar" }]
    : pestana === "ya_facturado" ? [{ destino: "a_facturar", texto: "No era esta" }]
    : [];

  // Se sacan de la lista al instante; el servidor se actualiza atrás
  const mover = (ids: string[], destino: Destino, texto: string) => {
    if (!ids.length) return;
    // "No era esta" en un cobro de transferencia vuelve a revisar, como antes
    const dest = (id: string): Destino => (pestana === "ya_facturado" ? (["posnet", "qr"].includes(filas.find((f) => f.id === id)?.origen ?? "") ? "a_facturar" : "revisar") : destino);
    setOcultos((o) => new Set([...o, ...ids]));
    setSel((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    setAviso(null);
    empezar(async () => {
      const grupos = new Map<Destino, string[]>();
      for (const id of ids) grupos.set(dest(id), [...(grupos.get(dest(id)) ?? []), id]);
      let n = 0;
      for (const [d, lista] of grupos) {
        const r = await marcarCobros(lista, d);
        n += r.cambiados;
        if (!r.ok) { setAviso({ ok: false, texto: `No se pudo guardar: ${r.texto}` }); setOcultos((o) => { const x = new Set(o); lista.forEach((i) => x.delete(i)); return x; }); }
      }
      if (ids.length > 1) setAviso({ ok: true, texto: `${n} cobro${n === 1 ? "" : "s"} → ${texto.toLowerCase()}.` });
      router.refresh();
    });
  };

  if (visibles.length === 0) return <p className="px-6 py-10 text-center text-suave">{aviso?.texto ?? "No hay cobros acá."}</p>;
  const todos = visibles.length > 0 && elegidos.length === visibles.length;
  const tilde = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      {botones.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-linea bg-white px-4 py-2.5 md:px-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(visibles.map((f) => f.id)))} />
            {elegidos.length ? <b>{elegidos.length} elegidos · {pesos(total)}</b> : "Elegir todos"}
          </label>
          {elegidos.length > 0 && botones.map((b) => (
            <button key={b.destino} className={b.principal ? "boton !py-1.5" : "boton-borde !py-1.5"} onClick={() => mover(elegidos.map((f) => f.id), b.destino, b.texto)}>
              {b.texto} ({elegidos.length})
            </button>
          ))}
          {aviso && <span className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-800"}`}>{aviso.texto}</span>}
        </div>
      )}
      <ul className="divide-y divide-linea">
        {visibles.map((c) => (
          <li key={c.id} className={`flex items-start gap-3 px-4 py-3 md:items-center md:px-6 ${sel.has(c.id) ? "bg-marca-claro/60" : ""}`}>
            {botones.length > 0 && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 md:mt-0" checked={sel.has(c.id)} onChange={() => tilde(c.id)} aria-label="Elegir" />}
            <button type="button" className="min-w-0 flex-1 text-left md:grid md:grid-cols-[150px_120px_1fr_120px] md:items-center md:gap-3" onClick={() => botones.length && tilde(c.id)}>
              <span className="text-sm whitespace-nowrap">{fechaCorta(c.dia)} <span className="text-suave">{hora(c.fecha_hora)}</span></span>
              <span className="hidden text-sm md:block">{ORIGENES[c.origen] ?? c.origen}</span>
              <span className="block min-w-0 text-sm text-suave"><span className="md:hidden">{ORIGENES[c.origen] ?? c.origen}{c.detalle ? " · " : ""}</span>{c.detalle || <span className="hidden md:inline">—</span>}
                {c.mensaje && <span className="mt-1 block text-red-700">{c.mensaje}</span>}</span>
              <span className="block font-semibold whitespace-nowrap md:text-right">{pesos(Number(c.importe))}</span>
            </button>
            {botones.length > 0 && (
              <span className="flex shrink-0 items-center gap-3">
                {botones.map((b) => b.principal
                  ? <button key={b.destino} className="boton-borde !px-3 !py-1.5" onClick={() => mover([c.id], b.destino, b.texto)}>{b.texto}</button>
                  : <button key={b.destino} className="py-1.5 text-sm text-suave underline" onClick={() => mover([c.id], b.destino, b.texto)}>{b.texto}</button>)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
