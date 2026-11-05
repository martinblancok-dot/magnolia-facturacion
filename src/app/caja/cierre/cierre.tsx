"use client";
// Cierre de caja: sube lo pendiente, trae los cobros de Mercado Pago, avisa diferencias y hace el arqueo.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MEDIOS } from "@/lib/caja";
import { DENOMINACIONES, totalBilletes } from "@/lib/cierre";
import { guardarTurno, subirTodo } from "@/lib/caja-sync";
import type { Cierre } from "@/lib/supabase/turnos";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n);
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
const ORIGEN: Record<string, string> = { posnet: "Posnet", qr: "QR", transferencia: "Transferencia", otro: "Otro" };

export function CierreCaja() {
  const turnoId = useSearchParams().get("turno") ?? "";
  const [fase, setFase] = useState<"subiendo" | "pendiente" | "cargando" | "listo" | "cerrada" | "error">("subiendo");
  const [datos, setDatos] = useState<Cierre | null>(null);
  const [error, setError] = useState("");
  const [billetes, setBilletes] = useState<Record<string, string>>({});
  const [monedas, setMonedas] = useState("");
  const [deja, setDeja] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pendientes, setPendientes] = useState(0);

  const cargar = useCallback(async () => {
    setFase("subiendo");
    const s = await subirTodo();
    setPendientes(s.pendientes);
    if (s.estado !== "conectado" || s.pendientes > 0) { setFase("pendiente"); return; }
    setFase("cargando");
    try {
      const r = await fetch(`/api/caja/turno/${turnoId}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "error");
      setDatos(d);
      setDeja((x) => x || String(d.turno.fondo_inicial ?? ""));
      setFase(d.turno.cerrada_en ? "cerrada" : "listo");
    } catch (e) { setError((e as Error).message); setFase("error"); }
  }, [turnoId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);

  const contado = useMemo(() => totalBilletes(Object.fromEntries(Object.entries(billetes).map(([k, v]) => [k, Number(v) || 0])), Number(monedas.replace(",", ".")) || 0), [billetes, monedas]);
  const esperado = datos?.resumen.efectivoEsperado ?? 0;
  const diferencia = Math.round((contado - esperado) * 100) / 100;

  const cerrar = async () => {
    setEnviando(true);
    try {
      const r = await fetch(`/api/caja/turno/${turnoId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billetes: Object.fromEntries(Object.entries(billetes).map(([k, v]) => [k, Number(v) || 0])), monedas: Number(monedas.replace(",", ".")) || 0, deja_en_caja: Number(deja.replace(/\./g, "").replace(",", ".")) || 0, notas }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "error");
      guardarTurno(null);
      setFase("cerrada");
    } catch (e) { setError((e as Error).message); }
    finally { setEnviando(false); }
  };

  if (fase === "subiendo" || fase === "cargando") {
    return <main className="mx-auto mt-20 max-w-md px-6 text-center text-suave">{fase === "subiendo" ? "Subiendo ventas pendientes…" : "Trayendo cobros de Mercado Pago y armando el resumen…"}</main>;
  }
  if (fase === "pendiente") {
    return (
      <main className="mx-auto mt-20 max-w-md px-6 text-center">
        <h1 className="text-xl font-semibold">Falta subir {pendientes} {pendientes === 1 ? "cosa" : "cosas"}</h1>
        <p className="mt-2 text-suave">Para cerrar la caja hace falta internet: así se suben todas las ventas y se revisan los pagos con Mercado Pago.</p>
        <button className="boton mt-4" onClick={cargar}>Reintentar</button>
        <p className="mt-4"><Link href="/caja" className="text-sm text-suave underline">Volver a la caja</Link></p>
      </main>
    );
  }
  if (fase === "error" || !datos) {
    return <main className="mx-auto mt-20 max-w-md px-6 text-center"><p className="text-red-800">No se pudo cargar el cierre: {error}</p><button className="boton mt-4" onClick={cargar}>Reintentar</button></main>;
  }

  const { resumen, alertas, turno } = datos;
  const hayAlertas = alertas.ventasSinCobro.length > 0 || alertas.cobrosSinVenta.length > 0;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{fase === "cerrada" ? "Caja cerrada" : "Cerrar caja"}</h1>
        <Link href="/caja" className="text-sm text-suave underline">← Caja</Link>
      </div>
      <p className="text-suave">Abierta a las {hora(turno.abierta_en)} con {pesos(Number(turno.fondo_inicial))} de cambio.</p>

      <section className="tarjeta">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Ventas del turno</h2>
          <span className="text-2xl font-semibold">{pesos(resumen.total)}</span>
        </div>
        <p className="text-sm text-suave">{resumen.cantidad} ventas · ticket promedio {pesos(resumen.ticketPromedio)}{resumen.anuladas ? ` · ${resumen.anuladas} anuladas` : ""}</p>
        <ul className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {MEDIOS.map((m) => (
            <li key={m.id} className="flex justify-between"><span>{m.nombre} <span className="text-suave">({resumen.porMedio[m.id].cantidad})</span></span><b>{pesos(resumen.porMedio[m.id].total)}</b></li>
          ))}
        </ul>
      </section>

      <section className={`tarjeta ${hayAlertas ? "border-amber-300" : "border-green-300"}`}>
        <h2 className="font-semibold">Pagos revisados con Mercado Pago</h2>
        {alertas.erroresMP.length > 0 && <p className="mt-1 text-sm text-red-800">No se pudo consultar Mercado Pago: {alertas.erroresMP.join(" · ")}</p>}
        <p className="mt-1 text-sm text-green-800">✓ {alertas.verificados} pagos con tarjeta, QR o transferencia encontrados en Mercado Pago.</p>
        {alertas.ventasSinCobro.length > 0 && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">
            <b>⚠ {alertas.ventasSinCobro.length} {alertas.ventasSinCobro.length === 1 ? "pago no entró" : "pagos no entraron"} a Mercado Pago</b>
            <ul className="mt-1 space-y-0.5">
              {alertas.ventasSinCobro.map((v) => (
                <li key={v.id}>{hora(v.creada_en)} · {MEDIOS.find((m) => m.id === v.medio_pago)?.nombre} · <b>{pesos(v.total)}</b>{v.numero ? ` · venta #${v.numero}` : ""}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Revisá si se cobró con otro medio, si el monto fue distinto o si la transferencia entró a otra cuenta.</p>
          </div>
        )}
        {alertas.cobrosSinVenta.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <b>{alertas.cobrosSinVenta.length} {alertas.cobrosSinVenta.length === 1 ? "cobro entró" : "cobros entraron"} a Mercado Pago sin venta en la caja</b>
            <ul className="mt-1 space-y-0.5">
              {alertas.cobrosSinVenta.map((c) => <li key={c.id}>{hora(c.fecha_hora)} · {ORIGEN[c.origen] ?? c.origen} · <b>{pesos(Number(c.importe))}</b></li>)}
            </ul>
            <p className="mt-1 text-xs">Puede ser una venta que no se cargó en la caja, o una transferencia que no es venta.</p>
          </div>
        )}
      </section>

      <section className="tarjeta space-y-4">
        <h2 className="font-semibold">Arqueo de efectivo</h2>
        <ul className="text-sm">
          <li className="flex justify-between"><span>Cambio inicial</span><span>{pesos(Number(turno.fondo_inicial))}</span></li>
          <li className="flex justify-between"><span>+ Ventas en efectivo</span><span>{pesos(resumen.porMedio.efectivo.total)}</span></li>
          {resumen.ingresos > 0 && <li className="flex justify-between"><span>+ Ingresos</span><span>{pesos(resumen.ingresos)}</span></li>}
          {resumen.retiros > 0 && <li className="flex justify-between"><span>− Retiros</span><span>{pesos(resumen.retiros)}</span></li>}
          {resumen.gastos > 0 && <li className="flex justify-between"><span>− Gastos</span><span>{pesos(resumen.gastos)}</span></li>}
          <li className="mt-1 flex justify-between border-t border-linea pt-1 font-semibold"><span>Tiene que haber en la caja</span><span>{pesos(esperado)}</span></li>
        </ul>
        {datos.movimientos.length > 0 && (
          <details className="text-sm"><summary className="cursor-pointer text-suave">Ver retiros y gastos ({datos.movimientos.length})</summary>
            <ul className="mt-1">{datos.movimientos.map((m, i) => <li key={i}>{hora(m.creado_en)} · {m.tipo} · {pesos(Number(m.monto))}{m.motivo ? ` · ${m.motivo}` : ""}</li>)}</ul>
          </details>
        )}

        {fase === "listo" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {DENOMINACIONES.map((d) => (
                <label key={d}><span className="etiqueta">Billetes de ${d.toLocaleString("es-AR")}</span>
                  <input className="campo" inputMode="numeric" value={billetes[d] ?? ""} placeholder="0" onChange={(e) => setBilletes((b) => ({ ...b, [d]: e.target.value.replace(/\D/g, "") }))} />
                </label>
              ))}
              <label><span className="etiqueta">Monedas ($)</span><input className="campo" inputMode="decimal" value={monedas} placeholder="0" onChange={(e) => setMonedas(e.target.value)} /></label>
            </div>
            <div className="rounded-xl bg-fondo p-3">
              <p className="flex justify-between"><span>Contado</span><b>{pesos(contado)}</b></p>
              <p className={`flex justify-between font-semibold ${diferencia === 0 ? "text-green-800" : "text-red-700"}`}>
                <span>{diferencia === 0 ? "Coincide" : diferencia > 0 ? "Sobra" : "Falta"}</span><span>{pesos(Math.abs(diferencia))}</span>
              </p>
            </div>
            <label className="block"><span className="etiqueta">Cuánto queda en la caja para mañana (cambio)</span>
              <input className="campo" inputMode="decimal" value={deja} onChange={(e) => setDeja(e.target.value)} />
              <span className="ayuda block">El resto ({pesos(Math.max(0, contado - (Number(deja.replace(/\./g, "").replace(",", ".")) || 0)))}) se retira.</span>
            </label>
            <label className="block"><span className="etiqueta">Notas (opcional)</span>
              <input className="campo" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder={diferencia !== 0 ? "Ej: faltante por vuelto mal dado" : ""} />
            </label>
            {error && <p className="text-sm text-red-800">{error}</p>}
            <button className="boton w-full justify-center !py-3 text-base" disabled={enviando} onClick={cerrar}>{enviando ? "Cerrando…" : "Cerrar caja"}</button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="font-semibold text-green-800">✓ Caja cerrada.</p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/cierres/${turno.id}`} className="boton-borde">Ver reporte</Link>
              <Link href="/caja" className="boton">Abrir caja nueva</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
