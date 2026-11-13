"use client";
// Ventana para elegir el color de un producto (caja y stock). Botones grandes para tocar con el dedo;
// con el teclado: números 1 a 9 (o flechas + Enter) eligen, Esc cancela.
// Si mientras está abierta se escanea otro código, se ignora (el lector "teclea" muy rápido y termina en Enter).
// Funciona sin internet: los colores vienen en el catálogo guardado.
import type { ColorCaja } from "@/lib/variantes";
import { Miniatura } from "./miniatura";
import { useEffect, useRef, useState } from "react";

const RAPIDO = 50; // ms entre teclas: más rápido que esto es el lector de códigos, no una persona

export function ElegirColor({ nombre, colores, cantidad = 1, fotoProducto, onElegir, onCancelar }: {
  nombre: string;
  /** Si un color no tiene foto propia, se muestra la del producto. */
  fotoProducto?: string | null;
  colores: ColorCaja[];
  cantidad?: number;
  onElegir: (variante: ColorCaja) => void;
  onCancelar: () => void;
}) {
  const [marcado, setMarcado] = useState(-1);
  const ultima = useRef(0);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fn = useRef({ onElegir, onCancelar, marcado });
  useEffect(() => { fn.current = { onElegir, onCancelar, marcado }; });

  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // que nada de lo que se teclee vaya al buscador
    const tecla = (e: KeyboardEvent) => {
      e.stopPropagation(); // mientras está abierta, el teclado (y el lector) es solo de esta ventana
      const ahora = Date.now();
      const rapido = ahora - ultima.current < RAPIDO;
      ultima.current = ahora;
      if (rapido && pendiente.current) { clearTimeout(pendiente.current); pendiente.current = null; } // era un escaneo
      if (e.key === "Escape") { e.preventDefault(); fn.current.onCancelar(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => Math.min(colores.length - 1, m + 1)); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => Math.max(0, m - 1)); return; }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const m = fn.current.marcado;
        if (!rapido && m >= 0 && colores[m]) fn.current.onElegir(colores[m]);
        return;
      }
      const n = Number(e.key);
      if (e.key.length === 1) e.preventDefault();
      if (!rapido && n >= 1 && n <= 9 && colores[n - 1]) {
        pendiente.current = setTimeout(() => { pendiente.current = null; fn.current.onElegir(colores[n - 1]); }, RAPIDO + 10);
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => { window.removeEventListener("keydown", tecla, true); if (pendiente.current) clearTimeout(pendiente.current); };
  }, [colores]);

  const conFotos = colores.some((c) => c[2]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancelar}>
      <div role="dialog" aria-label="Elegir color" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-suave">¿De qué color{cantidad > 1 ? ` (${cantidad} unidades)` : ""}?</p>
        <h2 className="mb-4 text-lg font-semibold">{nombre}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {colores.map((c, i) => (
            <button key={c[0]} tabIndex={-1} onClick={() => onElegir(c)} onMouseEnter={() => setMarcado(i)}
              className={`relative min-h-16 rounded-xl border-2 px-3 py-4 text-lg font-semibold ${i === marcado ? "border-marca bg-marca-claro" : "border-linea bg-white"}`}>
              {i < 9 && <span className="absolute top-1 left-2 text-xs font-normal text-suave">{i + 1}</span>}
              {conFotos && <span className="mb-2 flex justify-center"><Miniatura ruta={c[2] ?? fotoProducto} tam={88} alt={c[1]} /></span>}
              {c[1]}
            </button>
          ))}
        </div>
        <button tabIndex={-1} onClick={onCancelar} className="mt-4 w-full rounded-xl border border-linea py-3 text-suave">Cancelar (Esc)</button>
      </div>
    </div>
  );
}
