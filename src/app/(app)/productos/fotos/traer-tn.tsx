"use client";
// Botón "Traer fotos de Tienda Nube": pone en el sistema las fotos que ya están en la tienda.
import { useState } from "react";
import type { ResultadoFotosTN } from "@/lib/tiendanube-fotos";

export function TraerFotosTN({ ultima }: { ultima: string | null }) {
  const [trabajando, setTrabajando] = useState(false);
  const [r, setR] = useState<ResultadoFotosTN | null>(null);
  const [error, setError] = useState<string | null>(null);

  const traer = async () => {
    setTrabajando(true); setError(null); setR(null);
    try {
      const resp = await fetch("/api/tiendanube/fotos", { method: "POST" });
      const d = await resp.json().catch(() => ({ error: `Error ${resp.status}` }));
      if (!resp.ok) throw new Error(d.error ?? `Error ${resp.status}`);
      setR(d);
    } catch (e) { setError((e as Error).message); }
    setTrabajando(false);
  };

  return (
    <div className="tarjeta space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Fotos de Tienda Nube</h2>
          <p className="text-suave">Trae la foto principal de cada producto y la de cada color. Se hace sola en cada sincronización (una vez por hora).
            {ultima && <> Última vez: {new Date(ultima).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}.</>}</p>
        </div>
        <button className="boton" disabled={trabajando} onClick={traer}>{trabajando ? "Trayendo fotos…" : "Traer fotos de Tienda Nube"}</button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      {r && (
        <div className="space-y-2">
          <p className="text-base">
            <b className="text-green-800">{r.actualizadas} actualizadas</b>
            {" · "}<b className={r.skuNoEncontrado.length ? "text-red-700" : "text-suave"}>{r.skuNoEncontrado.length} SKU no encontrado en el sistema</b>
          </p>
          <p className="text-suave">{r.sinCambios} ya estaban iguales · {r.propias} tienen una foto cargada en el sistema (no se tocaron)</p>
          {r.pendientes && <p className="text-amber-800">Quedaron productos sin revisar por tiempo: tocá el botón de nuevo (o se siguen solos en la próxima sincronización).</p>}
          {r.skuNoEncontrado.length > 0 && (
            <details className="rounded-lg bg-red-50 p-2">
              <summary className="cursor-pointer font-semibold text-red-800">Productos de la tienda que no están en el sistema ({r.skuNoEncontrado.length})</summary>
              <ul className="mt-1 space-y-0.5">{r.skuNoEncontrado.map((x, i) => <li key={i}>{x.nombre}{x.skus.length ? <span className="text-suave"> · SKU {x.skus.join(", ")}</span> : <span className="text-suave"> · sin SKU</span>}</li>)}</ul>
            </details>
          )}
          {r.errores.length > 0 && <p className="text-red-700">Con error: {r.errores.join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}
