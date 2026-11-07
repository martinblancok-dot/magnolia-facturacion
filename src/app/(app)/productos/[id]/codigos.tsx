"use client";
// Códigos de barras de un producto: el interno (etiqueta nuestra) y los originales (de fábrica / proveedor).
import { useState, useTransition } from "react";
import { agregarCodigo, quitarCodigo } from "@/app/acciones";

export function Codigos({ productoId, interno, codigos }: { productoId: string; interno: string; codigos: { codigo: string; origen: string }[] }) {
  const [nuevo, setNuevo] = useState("");
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, empezar] = useTransition();
  return (
    <section className="tarjeta space-y-3">
      <div>
        <h2 className="font-semibold">Códigos de barras</h2>
        <p className="ayuda">En la caja, en Stock y en Etiquetas se encuentra el producto escaneando o escribiendo cualquiera de estos.</p>
      </div>
      <ul className="divide-y divide-linea text-sm">
        <li className="flex items-center justify-between gap-2 py-1.5"><span className="font-mono">{interno}</span><span className="text-xs text-suave">Interno (nuestra etiqueta)</span></li>
        {codigos.map((c) => (
          <li key={c.codigo} className="flex items-center justify-between gap-2 py-1.5">
            <span className="font-mono">{c.codigo}</span>
            {c.origen === "planilla"
              ? <span className="text-xs text-suave">Original · viene de Precios Deco (se cambia en la planilla)</span>
              : <span className="flex items-center gap-2 text-xs text-suave">Original · cargado acá
                  <button className="text-red-700 underline" disabled={pendiente} onClick={() => empezar(async () => setMsj(await quitarCodigo(productoId, c.codigo)))}>Quitar</button></span>}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!nuevo.trim()) return; empezar(async () => { const r = await agregarCodigo(productoId, nuevo); setMsj(r); if (r.ok) setNuevo(""); }); }}>
        <input value={nuevo} onChange={(e) => { setNuevo(e.target.value); setMsj(null); }} className="campo" placeholder="Escaneá el código que trae el producto" autoComplete="off" />
        <button className="boton-borde shrink-0" disabled={pendiente || !nuevo.trim()}>{pendiente ? "…" : "Agregar"}</button>
      </form>
      {msj && <p className={`text-sm ${msj.ok ? "text-green-800" : "text-red-800"}`}>{msj.texto}</p>}
    </section>
  );
}
