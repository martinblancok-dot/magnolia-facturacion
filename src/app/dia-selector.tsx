"use client";
// Elegir un día con calendario (y flechas para el anterior / siguiente).
import { useRouter } from "next/navigation";

const sumar = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function DiaSelector({ dia, hoy, ruta, extra = {} }: { dia: string; hoy: string; ruta: string; extra?: Record<string, string> }) {
  const router = useRouter();
  const ir = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const q = new URLSearchParams({ ...extra, dia: d > hoy ? hoy : d });
    router.push(`${ruta}?${q}`);
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      {dia && <button type="button" className="boton-borde !px-4 !py-2" onClick={() => ir(sumar(dia, -1))} aria-label="Día anterior">←</button>}
      <label className="relative">
        <span className="sr-only">Elegir día</span>
        <input type="date" value={dia} max={hoy} onChange={(e) => ir(e.target.value)}
          className="rounded-lg border border-linea bg-white px-3 py-2 font-semibold" />
      </label>
      {dia && <button type="button" className="boton-borde !px-4 !py-2 disabled:opacity-30" disabled={dia >= hoy} onClick={() => ir(sumar(dia, 1))} aria-label="Día siguiente">→</button>}
      {dia && dia !== hoy && <button type="button" className="text-sm text-marca underline" onClick={() => ir(hoy)}>Hoy</button>}
    </div>
  );
}
