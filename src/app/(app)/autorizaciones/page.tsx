import Link from "next/link";
import { resolverAutorizacion } from "../../acciones";
import { Refrescar } from "../../avisos-duenio";
import { BotonAccion } from "../../componentes";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

type Datos = { tipo: "pct" | "monto"; valor: number; motivo: string | null; subtotal: number; productos: string[] };

export default async function Autorizaciones() {
  await soloDuenio();
  const db = clienteServidor();
  const [{ data: pendientes, error }, { data: ultimas }, { data: perfiles }] = await Promise.all([
    db.from("autorizaciones").select("id, local_id, pedido_por, datos, creada_en").eq("estado", "pendiente").order("creada_en"),
    db.from("autorizaciones").select("id, local_id, pedido_por, datos, estado, creada_en, resuelta_por").neq("estado", "pendiente").order("creada_en", { ascending: false }).limit(20),
    db.from("perfiles").select("usuario_id, nombre"),
  ]);
  const quien = (id: string | null) => perfiles?.find((p) => p.usuario_id === id)?.nombre || "Alguien";
  const local = (id: number | null) => (id === 2 ? "Magnolia Beauty" : "Magnolia Home");
  const hora = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
  const monto = (d: Datos) => (d.tipo === "pct" ? Math.round((d.subtotal * d.valor) / 100) : d.valor);

  return (
    <div className="max-w-3xl space-y-6">
      <Refrescar segundos={10} />
      <div>
        <h1 className="text-2xl font-semibold">Descuentos para autorizar</h1>
        <p className="text-sm text-suave">Los pide un colaborador desde la caja. Cuando aprobás, se aplica solo en su pantalla. Las anulaciones de ventas se autorizan en <Link href="/ventas" className="underline">Ventas</Link>.</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0016_cambios_promos.sql</b> en Supabase.</p>}
      {!error && (pendientes ?? []).length === 0 && <p className="tarjeta text-suave">No hay pedidos esperando. Esta pantalla se actualiza sola.</p>}
      {(pendientes ?? []).map((a) => {
        const d = a.datos as Datos;
        return (
          <div key={a.id} className="tarjeta space-y-3 border-amber-300">
            <p className="text-lg"><b>{d.tipo === "pct" ? `${d.valor}%` : pesos(d.valor)}</b> de descuento <span className="text-suave">(−{pesos(monto(d))} sobre {pesos(d.subtotal)})</span></p>
            <p className="text-sm">Pide <b>{quien(a.pedido_por)}</b> en {local(a.local_id)} · {hora(a.creada_en)}{d.motivo ? <> · motivo: “{d.motivo}”</> : null}</p>
            {d.productos?.length > 0 && <p className="text-sm text-suave">{d.productos.join(" · ")}</p>}
            <div className="flex gap-2">
              <BotonAccion accion={resolverAutorizacion.bind(null, a.id, true)} texto="Aprobar" />
              <BotonAccion accion={resolverAutorizacion.bind(null, a.id, false)} texto="Rechazar" borde />
            </div>
          </div>
        );
      })}
      {(ultimas ?? []).length > 0 && (
        <section className="tarjeta">
          <h2 className="font-semibold">Últimos resueltos</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(ultimas ?? []).map((a) => {
              const d = a.datos as Datos;
              return <li key={a.id}>{hora(a.creada_en)} · {quien(a.pedido_por)} · {d.tipo === "pct" ? `${d.valor}%` : pesos(d.valor)} · <b className={a.estado === "rechazada" ? "text-red-700" : "text-green-800"}>{a.estado === "rechazada" ? "rechazado" : a.estado === "usada" ? "aprobado y usado" : "aprobado"}</b>{a.resuelta_por ? ` por ${quien(a.resuelta_por)}` : ""}</li>;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
