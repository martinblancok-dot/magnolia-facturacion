"use client";
// Aviso en la caja: pedidos de la tienda online que tiene que preparar (o entregar) este local.
import { useState } from "react";
import type { PedidoCaja } from "@/lib/tiendanube-pedidos";

const NOMBRE_LOCAL: Record<number, string> = { 1: "Magnolia Home", 2: "Magnolia Beauty" };

export function PedidosWeb({ pedidos, local, onCambio }: { pedidos: PedidoCaja[]; local: number; onCambio: () => void }) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  if (!pedidos.length) return null;

  const marcar = async (p: PedidoCaja, accion: "preparado" | "entregado") => {
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/pedidos-web", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, local_id: local, accion }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      setAbierto(null);
      onCambio();
    } catch (e) { setError((e as Error).message); }
    setEnviando(false);
  };

  const preparar = pedidos.filter((p) => p.accion === "preparar").length;
  const retirar = pedidos.length - preparar;
  return (
    <div className="border-b border-linea bg-[#f4ece6] px-4 py-2">
      <p className="text-sm font-semibold text-marca">
        🛍 Tienda online: {[preparar && `${preparar} ${preparar === 1 ? "pedido" : "pedidos"} para preparar`, retirar && `${retirar} para retirar acá`].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {pedidos.map((p) => (
          <button key={p.id} onClick={() => setAbierto(abierto === p.id ? null : p.id)}
            className={`rounded-xl border px-3 py-1.5 text-left text-sm ${abierto === p.id ? "border-marca bg-white" : "border-linea bg-white/70"}`}>
            <b>#{p.numero}</b> {p.cliente ?? ""} · {p.accion === "retirar" ? "listo para retirar" : `${p.items.filter((i) => !i.preparado).reduce((s, i) => s + i.cantidad, 0)} u. a preparar`}
          </button>
        ))}
      </div>
      {pedidos.filter((p) => p.id === abierto).map((p) => {
        const otroLocal = p.entrega === "retiro" && p.retira_local && p.retira_local !== local ? NOMBRE_LOCAL[p.retira_local] : null;
        return (
          <div key={p.id} className="mt-2 space-y-2 rounded-xl border border-linea bg-white p-3 text-sm">
            <p><b>Pedido #{p.numero}</b>{p.cliente ? ` · ${p.cliente}` : ""}{p.telefono ? ` · ${p.telefono}` : ""}</p>
            <p className="text-suave">
              {p.entrega === "retiro" ? `Retira en ${p.retira_local ? NOMBRE_LOCAL[p.retira_local] : p.entrega_detalle ?? "el local"}` : `Envío: ${p.entrega_detalle ?? "a domicilio"}`}
            </p>
            <ul className="divide-y divide-linea">
              {p.items.map((i) => (
                <li key={i.n} className={`flex justify-between gap-3 py-1 ${i.preparado ? "text-suave line-through" : ""}`}>
                  <span>{i.nombre}{i.sku ? <span className="text-xs text-suave"> · {i.sku}</span> : null}{i.sinStock ? <span className="ml-1 text-xs text-amber-700">(no está en el sistema)</span> : null}</span>
                  <b className="tabular-nums">{i.cantidad}</b>
                </li>
              ))}
            </ul>
            {p.accion === "preparar" && otroLocal && <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-900">Después de prepararlo, llevalo a <b>{otroLocal}</b>: el cliente retira allá.</p>}
            {p.accion === "preparar" && p.entrega === "envio" && <p className="text-xs text-suave">Empacalo con el número de pedido a la vista para despacharlo.</p>}
            {error && <p className="text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              {p.accion === "preparar"
                ? <button className="boton" disabled={enviando} onClick={() => marcar(p, "preparado")}>{enviando ? "Guardando…" : "Listo, ya está preparado"}</button>
                : <button className="boton" disabled={enviando} onClick={() => marcar(p, "entregado")}>{enviando ? "Guardando…" : "El cliente lo retiró"}</button>}
              <button className="text-sm text-suave underline" onClick={() => setAbierto(null)}>Cerrar</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
