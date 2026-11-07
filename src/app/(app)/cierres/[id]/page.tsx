import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Imprimir } from "./imprimir";
import { MEDIOS } from "@/lib/caja";
import { fechaCorta, hora, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { calcularCierre } from "@/lib/supabase/turnos";
import { leerConfigAviso, resumenDeCierre } from "@/lib/supabase/aviso-cierre";
import { EnviarResumen } from "@/app/enviar-resumen";

const ORIGEN: Record<string, string> = { posnet: "Posnet", qr: "QR", transferencia: "Transferencia", otro: "Otro" };

export default async function ReporteCierre({ params }: { params: Promise<{ id: string }> }) {
  const { u, rol } = await usuarioConRol();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = clienteServidor();
  const c = await calcularCierre(db, id, false);
  if (!c) notFound();
  if (rol !== "duenio") {
    // Un colaborador solo ve el reporte de una caja en la que trabajó
    const t0 = c.turno as { abierta_por?: string | null; cerrada_por?: string | null };
    const { data: compu } = await db.from("terminales").select("id").eq("turno_id", id).eq("usuario_id", u.id).limit(1).maybeSingle();
    if (t0.abierta_por !== u.id && t0.cerrada_por !== u.id && !compu) redirect("/ventas");
  }
  const { data: local } = await db.from("locales").select("nombre").eq("id", c.turno.local_id).maybeSingle();
  const t = c.turno;
  const r = c.resumen;
  const [res, cfg] = t.cerrada_en ? await Promise.all([resumenDeCierre(db, id), leerConfigAviso(db)]) : [null, null];
  const dia = new Date(Date.parse(t.abierta_en) - 3 * 3600_000).toISOString().slice(0, 10);
  const fila = (a: string, b: string, fuerte = false) => (
    <li key={a} className={`flex justify-between ${fuerte ? "border-t border-linea pt-1 font-semibold" : ""}`}><span>{a}</span><span>{b}</span></li>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/cierres" className="text-sm text-suave underline">← Cierres</Link>
        <Imprimir />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Cierre de caja · {local?.nombre}</h1>
        <p className="text-suave">{fechaCorta(dia)} · de {hora(t.abierta_en)} a {t.cerrada_en ? hora(t.cerrada_en) : "(todavía abierta)"}</p>
      </div>

      {res && cfg && <section className="tarjeta print:hidden"><EnviarResumen texto={res.texto} whatsapp={cfg.whatsapp} /></section>}

      <section className="tarjeta">
        <h2 className="font-semibold">Ventas</h2>
        <p className="mt-1 text-2xl font-semibold">{pesos(r.total)}</p>
        <p className="text-sm text-suave">{r.cantidad} ventas · ticket promedio {pesos(r.ticketPromedio)}{r.anuladas ? ` · ${r.anuladas} anuladas` : ""}</p>
        <ul className="mt-3 space-y-0.5 text-sm">
          {MEDIOS.filter((m) => !m.oculto || r.porMedio[m.id]?.cantidad).map((m) => fila(`${m.id === "giftcard" ? "Pagadas solo con gift card" : m.nombre} (${r.porMedio[m.id].cantidad})`, pesos(r.porMedio[m.id].total)))}
        </ul>
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">Arqueo de efectivo</h2>
        <ul className="mt-2 space-y-0.5 text-sm">
          {fila("Cambio inicial", pesos(Number(t.fondo_inicial)))}
          {(() => {
            const ap = (t as { apertura?: { diferencia: number | null; esperado: number | null; nota?: string | null } | null }).apertura;
            return ap?.diferencia ? fila(`Al abrir ${ap.diferencia < 0 ? "faltaban" : "sobraban"} (se habían dejado ${pesos(Number(ap.esperado))})${ap.nota ? ` · ${ap.nota}` : ""}`, pesos(Math.abs(ap.diferencia))) : null;
          })()}
          {fila("+ Ventas en efectivo", pesos(r.porMedio.efectivo.total))}
          {r.ingresos > 0 && fila("+ Ingresos", pesos(r.ingresos))}
          {r.retiros > 0 && fila("− Retiros", pesos(r.retiros))}
          {r.gastos > 0 && fila("− Gastos", pesos(r.gastos))}
          {fila("Esperado", pesos(r.efectivoEsperado), true)}
          {t.efectivo_contado !== null && fila("Contado", pesos(Number(t.efectivo_contado)))}
          {t.diferencia !== null && (
            <li className={`flex justify-between font-semibold ${Number(t.diferencia) === 0 ? "text-green-800" : "text-red-700"}`}>
              <span>{Number(t.diferencia) === 0 ? "Coincide" : Number(t.diferencia) > 0 ? "Sobrante" : "Faltante"}</span><span>{pesos(Math.abs(Number(t.diferencia)))}</span>
            </li>
          )}
          {t.deja_en_caja !== null && fila("Quedó en caja (cambio para mañana)", pesos(Number(t.deja_en_caja)))}
          {t.efectivo_contado !== null && t.deja_en_caja !== null && fila("Retirado al cerrar", pesos(Number(t.efectivo_contado) - Number(t.deja_en_caja)))}
        </ul>
        {c.movimientos.length > 0 && (
          <ul className="mt-3 text-sm text-suave">
            {c.movimientos.map((m, i) => <li key={i}>{hora(m.creado_en)} · {m.tipo} {pesos(Number(m.monto))}{m.motivo ? ` · ${m.motivo}` : ""}</li>)}
          </ul>
        )}
        {t.notas && <p className="mt-2 text-sm">Notas: {t.notas}</p>}
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">Pagos con Mercado Pago</h2>
        <p className="mt-1 text-sm text-green-800">✓ {c.alertas.verificados} pagos encontrados en Mercado Pago.</p>
        {c.alertas.ventasSinCobro.length > 0 && (
          <div className="mt-2 text-sm text-red-800"><b>No entraron ({c.alertas.ventasSinCobro.length}):</b>
            <ul>{c.alertas.ventasSinCobro.map((v) => <li key={v.id}>{hora(v.creada_en)} · {MEDIOS.find((m) => m.id === v.medio_pago)?.nombre} · {pesos(v.total)}{v.numero ? ` · #${v.numero}` : ""}</li>)}</ul>
          </div>
        )}
        {c.alertas.cobrosSinVenta.length > 0 && (
          <div className="mt-2 text-sm text-amber-900"><b>Cobros sin venta en ninguno de los dos locales ({c.alertas.cobrosSinVenta.length}):</b>
            <ul>{c.alertas.cobrosSinVenta.map((x) => <li key={x.id}>{hora(x.fecha_hora)} · {ORIGEN[x.origen] ?? x.origen} · {pesos(Number(x.importe))}</li>)}</ul>
          </div>
        )}
        {c.alertas.ventasSinCobro.length === 0 && c.alertas.cobrosSinVenta.length === 0 && <p className="text-sm text-suave">Sin diferencias.</p>}
      </section>

      {c.top.length > 0 && (
        <section className="tarjeta">
          <h2 className="font-semibold">Lo más vendido</h2>
          <ul className="mt-2 space-y-0.5 text-sm">
            {c.top.map((p) => fila(`${p.cantidad} × ${p.nombre}`, pesos(p.total)))}
          </ul>
        </section>
      )}
    </div>
  );
}
