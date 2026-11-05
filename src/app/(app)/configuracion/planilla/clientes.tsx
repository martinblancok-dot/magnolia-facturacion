"use client";
import { useState, useTransition } from "react";
import { generarTokenPlanilla } from "../../../acciones";

export function GenerarClave({ hay }: { hay: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seguro, setSeguro] = useState(!hay);
  const [cargando, empezar] = useTransition();
  if (token) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold">Clave nueva (se muestra una sola vez):</p>
        <div className="flex gap-2">
          <input readOnly value={token} className="campo font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
          <Copiar texto={token} />
        </div>
        <p className="ayuda">Pegala en la planilla: menú Magnolia → Configurar conexión.</p>
      </div>
    );
  }
  return (
    <div>
      {!seguro ? (
        <button className="boton-borde" onClick={() => setSeguro(true)}>Generar una clave nueva</button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button className="boton" disabled={cargando} onClick={() => empezar(async () => {
            const r = await generarTokenPlanilla();
            if (r.token) setToken(r.token); else setError(r.texto ?? "Error");
          })}>{cargando ? "Un momento…" : "Generar clave"}</button>
          {hay && <span className="text-sm text-amber-800">La clave anterior deja de funcionar: hay que pegar la nueva en la planilla.</span>}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function Copiar({ texto, etiqueta = "Copiar" }: { texto: string; etiqueta?: string }) {
  const [listo, setListo] = useState(false);
  return (
    <button type="button" className="boton-borde shrink-0" onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setListo(true); setTimeout(() => setListo(false), 2000); } catch {}
    }}>{listo ? "✓ Copiado" : etiqueta}</button>
  );
}
