import Link from "next/link";
import { notFound } from "next/navigation";
import { Reimprimir } from "../../ventas/reimprimir";
import { nombreMedio } from "@/lib/caja";
import { pesos } from "@/lib/formato";
import { estadoGc, NOMBRE_ESTADO } from "@/lib/giftcards";
import { codigoVenta } from "@/lib/impresion";
import { clienteServidor } from "@/lib/supabase/almacen";
import { controlGiftcards } from "@/lib/supabase/giftcards";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { Destinatario } from "./destinatario";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
const local = (id: number | null | undefined) => (id === 2 ? "Magnolia Beauty" : id === 1 ? "Magnolia Home" : "—");

export default async function DetalleGiftcard({ params }: { params: Promise<{ id: string }> }) {
  await usuarioConRol();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = clienteServidor();
  const { tarjetas } = await controlGiftcards(db, { ids: [id] });
  const t = tarjetas[0];
  if (!t) notFound();
  const { data: items } = t.venta_id ? await db.from("venta_items").select("nombre, cantidad, precio_unitario, total").eq("venta_id", t.venta_id) : { data: [] };
  const e = estadoGc(t);
  // saldo después de cada uso
  const saldos = t.usos.map((_, i) => Math.max(t.monto - t.usos.slice(0, i + 1).reduce((s, u) => s + u.usado, 0), 0));

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/giftcards" className="text-sm text-suave underline">← Gift cards</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-3xl font-semibold">{t.codigo}</h1>
          <p className="text-sm text-suave">Gift card de {pesos(t.monto)} · {NOMBRE_ESTADO[e]}</p>
        </div>
        <div className="text-right"><p className="text-sm text-suave">Saldo disponible</p><p className="text-3xl font-semibold">{pesos(t.saldo)}</p></div>
      </div>

      <section className="tarjeta space-y-1 text-sm">
        <Destinatario id={t.id} inicial={t.destinatario ?? null} />
        <p><span className="text-suave">Vendida:</span> {fechaHora(t.creada_en)} en {local(t.local_id)}{t.vendidaPor ? `, por ${t.vendidaPor}` : ""}</p>
        <p><span className="text-suave">Pagada con:</span> {nombreMedio(t.medio_origen)} → al usarla, los productos van a precio de {nombreMedio(t.medio_origen).toLowerCase()}</p>
        {t.venta_id && <p><span className="text-suave">Venta:</span> <Link href={`/ventas?codigo=${codigoVenta(t.venta_id)}`} className="font-mono text-marca underline">{codigoVenta(t.venta_id)}</Link></p>}
        {t.venta_id && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Reimprimir venta={{ id: t.venta_id, local_id: t.local_id ?? 1, creada_en: t.creada_en, medio: nombreMedio(t.medio_origen), total: t.monto, paga_con: null,
              items: (items ?? []).map((i) => ({ nombre: i.nombre, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), total: Number(i.total) })),
              giftcard_nueva: { codigo: t.codigo, monto: t.monto, destinatario: t.destinatario ?? null } }} />
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">Movimientos</h2>
        <ol className="mt-3 space-y-3 border-l-2 border-linea pl-4 text-sm">
          <li><b>{fechaHora(t.creada_en)}</b> · Se vendió por {pesos(t.monto)} <span className="text-suave">— saldo {pesos(t.monto)}</span></li>
          {t.usos.map((u, i) => {
            return (
              <li key={u.venta_id}>
                <b>{fechaHora(u.creado_en)}</b> · Se usaron {pesos(u.usado)} en {local(u.venta?.local_id)}{u.usuario ? ` (atendió ${u.usuario})` : ""}
                {u.venta && <> · venta <Link href={`/ventas?codigo=${codigoVenta(u.venta.id)}`} className="font-mono text-marca underline">{codigoVenta(u.venta.id)}</Link>{Number(u.venta.total) > 0 ? ` (+ ${pesos(Number(u.venta.total))} en ${nombreMedio(u.venta.medio_pago).toLowerCase()})` : ""}</>}
                <span className="text-suave"> — saldo {pesos(saldos[i])}</span>
              </li>
            );
          })}
          {t.anulada && <li className="font-semibold text-red-700">Anulada (se anuló la venta de la tarjeta)</li>}
          {!t.usos.length && !t.anulada && <li className="text-suave">Todavía no se usó.</li>}
        </ol>
      </section>
    </div>
  );
}
