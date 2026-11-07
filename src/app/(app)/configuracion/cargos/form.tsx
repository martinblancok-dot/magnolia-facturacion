"use client";
import { useState, useTransition } from "react";
import { guardarCargos } from "@/app/acciones";
import { MEDIOS_CAJA } from "@/lib/caja";
import type { Cargos } from "@/lib/reportes";

export function FormCargos({ inicial }: { inicial: Cargos }) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(MEDIOS_CAJA.map((m) => [m.id, inicial[m.id] ? String(inicial[m.id]).replace(".", ",") : ""])));
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, empezar] = useTransition();
  return (
    <section className="tarjeta space-y-3">
      {MEDIOS_CAJA.map((m) => {
        const n = Number((v[m.id] || "0").replace(",", ".")) || 0;
        return (
          <label key={m.id} className="flex items-center gap-3">
            <span className="w-40 text-sm font-semibold">{m.nombre}</span>
            <input className="campo !w-24 text-right" inputMode="decimal" placeholder="0" value={v[m.id]} onChange={(e) => { setV({ ...v, [m.id]: e.target.value }); setMsj(null); }} />
            <span className="text-sm text-suave">% · de $100 quedan ${(100 - n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>
          </label>
        );
      })}
      <button className="boton" disabled={pendiente} onClick={() => empezar(async () => setMsj(await guardarCargos(v)))}>{pendiente ? "Guardando…" : "Guardar"}</button>
      {msj && <p className={`text-sm ${msj.ok ? "text-green-800" : "text-red-800"}`}>{msj.texto}</p>}
    </section>
  );
}
