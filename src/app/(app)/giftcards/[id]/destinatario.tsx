"use client";
import { useState, useTransition } from "react";
import { cambiarDestinatarioGc } from "@/app/acciones";

export function Destinatario({ id, inicial }: { id: string; inicial: string | null }) {
  const [valor, setValor] = useState(inicial ?? "");
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, empezar] = useTransition();
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); empezar(async () => setMsj(await cambiarDestinatarioGc(id, valor))); }}>
      <span className="text-suave">Para:</span>
      <input value={valor} onChange={(e) => { setValor(e.target.value); setMsj(null); }} className="campo !w-64 !py-1.5" placeholder="Nombre de quien la recibió" />
      {valor !== (inicial ?? "") && <button className="boton-borde !py-1.5" disabled={pendiente}>{pendiente ? "…" : "Guardar"}</button>}
      {msj && <span className={`text-xs ${msj.ok ? "text-green-800" : "text-red-800"}`}>{msj.texto}</span>}
    </form>
  );
}
