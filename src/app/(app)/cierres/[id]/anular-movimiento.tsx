"use client";
// Botón "Anular" de un retiro, gasto o ingreso (solo dueños). Pide el motivo y confirma antes.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularMovimientoCaja } from "@/app/acciones";

export function AnularMovimiento({ id, texto }: { id: string; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, empezar] = useTransition();
  const router = useRouter();

  if (msg?.ok) return <span className="text-xs text-green-800">{msg.texto}</span>;
  if (!abierto) return <button className="text-xs text-red-700 underline print:hidden" onClick={() => setAbierto(true)}>Anular</button>;
  return (
    <form className="mt-1 flex flex-wrap items-center gap-2 print:hidden" onSubmit={(e) => {
      e.preventDefault();
      empezar(async () => {
        const r = await anularMovimientoCaja(id, motivo);
        setMsg(r);
        if (r.ok) router.refresh();
      });
    }}>
      <span className="basis-full text-xs">¿Anular {texto}? Va a dejar de contar en la caja.</span>
      <input className="campo !py-1 text-sm" placeholder="Motivo (ej: cargado dos veces)" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <button className="boton !py-1 text-sm" disabled={pendiente}>{pendiente ? "Anulando…" : "Sí, anular"}</button>
      <button type="button" className="text-xs text-suave underline" onClick={() => setAbierto(false)}>No</button>
      {msg && !msg.ok && <span className="basis-full text-xs text-red-700">{msg.texto}</span>}
    </form>
  );
}
