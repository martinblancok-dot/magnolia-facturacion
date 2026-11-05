import Link from "next/link";
import { anularVenta } from "../../acciones";
import { BotonAccion } from "../../componentes";
import { MEDIOS } from "@/lib/caja";
import { diaArgentina, restarDias } from "@/lib/fechas";
import { fechaCorta, hora, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

type Venta = {
  id: string; numero: number; local_id: number; creada_en: string; medio_pago: string; total: number; total_lista: number;
  anulada: boolean; venta_items: { n: number; nombre: string; sku: string | null; cantidad: number; precio_unitario: number; total: number }[];
};

export default async function Ventas({ searchParams }: { searchParams: Promise<{ dia?: string; local?: string }> }) {
  await usuarioActual();
  const db = clienteServidor();
  const sp = await searchParams;
  const hoy = diaArgentina();
  const dia = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoy;
  const local = sp.local === "1" || sp.local === "2" ? Number(sp.local) : null;
  const siguiente = restarDias(dia, -1);

  let q = db.from("ventas").select("id, numero, local_id, creada_en, medio_pago, total, total_lista, anulada, venta_items(n, nombre, sku, cantidad, precio_unitario, total)")
    .gte("creada_en", `${dia}T00:00:00-03:00`).lt("creada_en", `${siguiente}T00:00:00-03:00`).order("creada_en", { ascending: false }).limit(1000);
  if (local) q = q.eq("local_id", local);
  const [{ data }, { data: locales }] = await Promise.all([q, db.from("locales").select("id, nombre").order("id")]);
  const ventas = (data ?? []) as Venta[];
  const validas = ventas.filter((v) => !v.anulada);
  const total = validas.reduce((s, v) => s + Number(v.total), 0);
  const porMedio = MEDIOS.map((m) => ({ ...m, total: validas.filter((v) => v.medio_pago === m.id).reduce((s, v) => s + Number(v.total), 0), n: validas.filter((v) => v.medio_pago === m.id).length }));
  const nombreLocal = (id: number) => locales?.find((l) => l.id === id)?.nombre ?? `Local ${id}`;
  const url = (d: string, l: number | null) => `/ventas?dia=${d}${l ? `&local=${l}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ventas</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={url(restarDias(dia, 1), local)} className="boton-borde !px-4 !py-2">←</Link>
          <span className="w-28 text-center font-semibold">{dia === hoy ? "Hoy" : fechaCorta(dia)}</span>
          {dia < hoy ? <Link href={url(siguiente, local)} className="boton-borde !px-4 !py-2">→</Link> : <span className="w-11" />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {[null, 1, 2].map((l) => (
          <Link key={String(l)} href={url(dia, l)} className={`rounded-full border px-3 py-1.5 ${local === l ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>
            {l ? nombreLocal(l) : "Los dos locales"}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="tarjeta">
          <p className="text-sm text-suave">Vendido</p>
          <p className="mt-1 text-2xl font-semibold">{pesos(total)}</p>
          <p className="text-sm text-suave">{validas.length} ventas{ventas.length > validas.length ? ` · ${ventas.length - validas.length} anuladas` : ""}</p>
        </div>
        <div className="tarjeta md:col-span-2">
          <p className="text-sm text-suave">Por medio de pago</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {porMedio.map((m) => (
              <li key={m.id} className="flex justify-between gap-2"><span>{m.nombre}</span><b>{pesos(m.total)}</b></li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-linea bg-white">
        {ventas.length === 0 ? (
          <p className="px-6 py-10 text-center text-suave">No hay ventas este día.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {ventas.map((v) => (
              <li key={v.id} className={`px-4 py-3 md:px-6 ${v.anulada ? "opacity-50" : ""}`}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>#{v.numero}</b> · {hora(v.creada_en)} · {nombreLocal(v.local_id)}
                      <span className="block text-sm text-suave">
                        {MEDIOS.find((m) => m.id === v.medio_pago)?.nombre} · {v.venta_items.reduce((s, i) => s + Number(i.cantidad), 0)} u.
                        {v.anulada && <span className="ml-2 font-semibold text-red-700">ANULADA</span>}
                      </span>
                    </span>
                    <span className={`font-semibold ${v.anulada ? "line-through" : ""}`}>{pesos(Number(v.total))}</span>
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {v.venta_items.sort((a, b) => a.n - b.n).map((i) => (
                      <li key={i.n} className="flex justify-between gap-3">
                        <span>{Number(i.cantidad)} × {i.nombre} <span className="text-suave">({pesos(Number(i.precio_unitario))})</span></span>
                        <span>{pesos(Number(i.total))}</span>
                      </li>
                    ))}
                  </ul>
                  {!v.anulada && <div className="mt-3"><BotonAccion accion={anularVenta.bind(null, v.id)} texto="Anular venta" borde /></div>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
