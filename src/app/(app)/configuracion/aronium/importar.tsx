"use client";
import { useEffect, useState } from "react";
import { pesos } from "@/lib/formato";

type Archivo = { origen: string; local: number; hasta: string; ventas: { id: string }[]; resumen: Record<string, { ventas: number; total: number }> };
type Cargado = Record<string, Record<string, { ventas: number; total: number }>>;
const LOCAL: Record<number, string> = { 1: "Magnolia Home", 2: "Magnolia Beauty" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function Importar() {
  const [archivo, setArchivo] = useState<Archivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechas: number; nuevas: number; total: number } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState<Cargado | null>(null);

  const verCargado = async () => {
    try { const r = await fetch("/api/importar/aronium", { cache: "no-store" }); if (r.ok) setCargado(await r.json()); } catch {}
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { verCargado(); }, []);

  const leer = async (f: File | undefined) => {
    setArchivo(null); setError(null); setProgreso(null);
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as Archivo;
      if (d.origen !== "aronium" || ![1, 2].includes(d.local) || !Array.isArray(d.ventas)) throw new Error();
      setArchivo(d);
    } catch { setError("Ese archivo no es una importación de Aronium. Usá el archivo aronium-magnolia-….json."); }
  };

  const importar = async () => {
    if (!archivo) return;
    setCargando(true); setError(null);
    const total = archivo.ventas.length;
    let hechas = 0, nuevas = 0;
    setProgreso({ hechas, nuevas, total });
    for (let i = 0; i < total; i += 250) {
      const lote = archivo.ventas.slice(i, i + 250);
      let intento = 0;
      for (;;) {
        try {
          const r = await fetch("/api/importar/aronium", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local: archivo.local, ventas: lote }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
          nuevas += d.nuevas; break;
        } catch (e) {
          if (++intento >= 3) { setError(`Se cortó en la venta ${i + 1} de ${total}: ${(e as Error).message}. Volvé a tocar Importar: sigue sin duplicar.`); setCargando(false); await verCargado(); return; }
          await new Promise((ok) => setTimeout(ok, 1500));
        }
      }
      hechas += lote.length;
      setProgreso({ hechas, nuevas, total });
    }
    setCargando(false);
    await verCargado();
  };

  const enSistema = archivo ? cargado?.[archivo.local] ?? {} : {};
  return (
    <>
      <section className="tarjeta space-y-3">
        <label className="block"><span className="etiqueta">Archivo de importación</span>
          <input type="file" accept=".json,application/json" className="campo" onChange={(e) => leer(e.target.files?.[0])} disabled={cargando} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {archivo && (
          <>
            <p className="text-sm"><b>{LOCAL[archivo.local]}</b> · {archivo.ventas.length.toLocaleString("es-AR")} ventas hasta el {archivo.hasta.split("-").reverse().join("/")}</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-suave uppercase"><tr><th className="py-1">Mes</th><th className="py-1 text-right">En Aronium</th><th className="py-1 text-right">Ya en el sistema</th><th /></tr></thead>
              <tbody className="divide-y divide-linea">
                {Object.entries(archivo.resumen).sort().map(([m, x]) => {
                  const s = enSistema[m];
                  const ok = s && s.ventas === x.ventas && Math.abs(s.total - x.total) < 1;
                  return (
                    <tr key={m}>
                      <td className="py-1.5">{mes(m)}</td>
                      <td className="py-1.5 text-right tabular-nums">{x.ventas} · {pesos(x.total).replace(",00", "")}</td>
                      <td className="py-1.5 text-right tabular-nums">{s ? `${s.ventas} · ${pesos(s.total).replace(",00", "")}` : "—"}</td>
                      <td className="py-1.5 pl-2">{ok ? <span className="text-green-700">✓</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {progreso && (
              <div>
                <div className="h-2 overflow-hidden rounded bg-linea"><div className="h-full bg-marca transition-all" style={{ width: `${(progreso.hechas / progreso.total) * 100}%` }} /></div>
                <p className="mt-1 text-sm text-suave">{progreso.hechas.toLocaleString("es-AR")} de {progreso.total.toLocaleString("es-AR")} revisadas · {progreso.nuevas.toLocaleString("es-AR")} cargadas ahora
                  {!cargando && progreso.hechas === progreso.total ? " · ✓ Terminado" : ""}</p>
              </div>
            )}
            <button className="boton" disabled={cargando} onClick={importar}>{cargando ? "Importando… (no cierres esta pestaña)" : "Importar"}</button>
          </>
        )}
      </section>
      {cargado && Object.keys(cargado).length > 0 && !archivo && (
        <section className="tarjeta text-sm">
          <h2 className="font-semibold">Ya importado</h2>
          {Object.entries(cargado).map(([l, meses]) => (
            <p key={l} className="mt-1">{LOCAL[Number(l)]}: {Object.values(meses).reduce((s, x) => s + x.ventas, 0).toLocaleString("es-AR")} ventas · {pesos(Object.values(meses).reduce((s, x) => s + x.total, 0))}</p>
          ))}
        </section>
      )}
    </>
  );
}
