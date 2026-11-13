import Link from "next/link";
import { calcularReposicion, textoPedido, type ProdRepo } from "@/lib/reposicion";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";
import { AccionesPedido, CargarTransferencias } from "./acciones";

const haceDias = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const NOMBRE = { 1: "Home", 2: "Beauty" } as const;
const ETIQ = { agotado: ["Agotado", "bg-red-100 text-red-800"], bajo: ["Bajo", "bg-amber-100 text-amber-900"], ok: ["OK", "bg-green-50 text-green-800"], quieto: ["Sin ventas", "bg-gray-100 text-gray-600"] } as const;

export default async function Reposicion({ searchParams }: { searchParams: Promise<{ periodo?: string; cubrir?: string; ver?: string }> }) {
  await soloDuenio();
  const sp = await searchParams;
  const periodo = [7, 15, 30, 60, 90].includes(Number(sp.periodo)) ? Number(sp.periodo) : 30;
  const cubrir = [15, 30, 45, 60].includes(Number(sp.cubrir)) ? Number(sp.cubrir) : 30;
  const ver = sp.ver === "todo" ? "todo" : "faltantes";
  const db = clienteServidor();

  const productos: ProdRepo[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from("productos").select("id, sku, nombre, proveedor, hoja, costo").eq("activo", true).order("nombre").range(i, i + 999);
    for (const p of data ?? []) productos.push({ id: p.id, sku: p.sku, nombre: p.nombre, proveedor: p.hoja ?? p.proveedor, costo: p.costo === null ? null : Number(p.costo) });
    if (!data || data.length < 1000) break;
  }
  const stock = new Map<string, [number, number]>();
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from("stock").select("producto_id, local_id, cantidad").range(i, i + 999);
    for (const s of data ?? []) { const x = stock.get(s.producto_id) ?? [0, 0]; x[s.local_id === 2 ? 1 : 0] = Number(s.cantidad); stock.set(s.producto_id, x); }
    if (!data || data.length < 1000) break;
  }
  const desde = haceDias(periodo);
  const vendidas = new Map<string, [number, number]>();
  for (let i = 0; i < 200000; i += 1000) {
    const { data } = await db.from("venta_items").select("producto_id, cantidad, ventas!inner(local_id, creada_en, anulada, prueba)")
      .not("producto_id", "is", null).eq("ventas.anulada", false).eq("ventas.prueba", false).gte("ventas.creada_en", desde).range(i, i + 999);
    for (const it of data ?? []) {
      const v = (Array.isArray(it.ventas) ? it.ventas[0] : it.ventas) as { local_id: number } | null;
      const x = vendidas.get(it.producto_id!) ?? [0, 0]; x[v?.local_id === 2 ? 1 : 0] += Number(it.cantidad); vendidas.set(it.producto_id!, x);
    }
    if (!data || data.length < 1000) break;
  }

  const filas = calcularReposicion(productos, stock, vendidas, { periodo, cubrir, alerta: 10 });
  const mostrar = ver === "todo" ? filas : filas.filter((f) => f.estado === "agotado" || f.estado === "bajo" || f.pedir > 0 || f.pasar);
  const proveedores = new Map<string, typeof mostrar>();
  for (const f of mostrar) proveedores.set(f.proveedor, [...(proveedores.get(f.proveedor) ?? []), f]);
  const transfer = filas.filter((f) => f.pasar);
  const cuenta = { agotado: filas.filter((f) => f.estado === "agotado").length, bajo: filas.filter((f) => f.estado === "bajo").length };
  const link = (x: Record<string, string>) => `/stock/reposicion?${new URLSearchParams({ periodo: String(periodo), cubrir: String(cubrir), ver, ...x })}`;
  const chip = (activo: boolean) => `rounded-full border px-3 py-1 ${activo ? "border-marca bg-marca text-white" : "border-linea bg-white"}`;
  const pesos = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/stock" className="text-sm text-suave">← Stock</Link>
        <h1 className="text-2xl font-semibold">Reposición y faltantes</h1>
        <p className="text-sm text-suave">Según lo que se vendió en los últimos {periodo} días. Lo sugerido para pedir alcanza para {cubrir} días de venta.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-suave">Mirar ventas de:</span>
        {[7, 15, 30, 60, 90].map((d) => <Link key={d} href={link({ periodo: String(d) })} className={chip(periodo === d)}>{d} días</Link>)}
        <span className="ml-2 text-suave">Pedir para:</span>
        {[15, 30, 45, 60].map((d) => <Link key={d} href={link({ cubrir: String(d) })} className={chip(cubrir === d)}>{d} días</Link>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Agotados que se venden</p><p className="text-2xl font-semibold text-red-700">{cuenta.agotado}</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Con menos de 10 días de stock</p><p className="text-2xl font-semibold text-amber-700">{cuenta.bajo}</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Para pasar entre locales</p><p className="text-2xl font-semibold">{transfer.length}</p></div>
      </div>

      {transfer.length > 0 && (
        <section className="tarjeta">
          <h2 className="font-semibold">Conviene pasar de un local al otro</h2>
          <p className="text-sm text-suave">En un local se vende y no hay (o queda poco) y en el otro sobra.</p>
          <ul className="mt-2 divide-y divide-linea text-sm">
            {transfer.slice(0, 40).map((f) => (
              <li key={f.id} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{f.nombre} <span className="text-xs text-suave">{f.sku}</span></span>
                <b className="shrink-0">{f.pasar!.cantidad} de {NOMBRE[f.pasar!.desde]} → {NOMBRE[f.pasar!.hasta]}</b></li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {([1, 2] as const).map((d) => {
              const its = transfer.filter((f) => f.pasar!.desde === d).map((f) => ({ id: f.id, sku: f.sku ?? "", nombre: f.nombre, cantidad: f.pasar!.cantidad }));
              return its.length ? <CargarTransferencias key={d} desde={d} items={its} texto={`Preparar ${its.length} de ${NOMBRE[d]} → ${NOMBRE[d === 1 ? 2 : 1]}`} /> : null;
            })}
          </div>
        </section>
      )}

      <div className="flex gap-2 text-sm">
        <Link href={link({ ver: "faltantes" })} className={chip(ver === "faltantes")}>Solo lo que hay que reponer</Link>
        <Link href={link({ ver: "todo" })} className={chip(ver === "todo")}>Todos los productos con stock o ventas</Link>
      </div>
      {mostrar.length === 0 && <p className="tarjeta text-sm text-suave">No hay nada para reponer con estos criterios.</p>}
      {[...proveedores.entries()].sort((a, b) => b[1].filter((f) => f.pedir > 0).length - a[1].filter((f) => f.pedir > 0).length).map(([prov, fs]) => {
        const pedido = fs.filter((f) => f.pedir > 0);
        const costo = pedido.reduce((s, f) => s + f.pedir * (f.costo ?? 0), 0);
        return (
          <section key={prov} className="tarjeta">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{prov} <span className="text-sm font-normal text-suave">· {pedido.length} para pedir{costo > 0 ? ` · costo aprox. ${pesos(costo)}` : ""}</span></h2>
              {pedido.length > 0 && <AccionesPedido texto={textoPedido(prov, pedido.map((f) => ({ sku: f.sku, nombre: f.nombre, cantidad: f.pedir })))} />}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-suave uppercase"><tr>
                  <th className="py-1">Producto</th><th className="py-1">Estado</th><th className="py-1 text-right">Stock Home</th><th className="py-1 text-right">Stock Beauty</th>
                  <th className="py-1 text-right">Vendidas</th><th className="py-1 text-right">Alcanza</th><th className="py-1 text-right">Pedir</th></tr></thead>
                <tbody className="divide-y divide-linea">
                  {fs.map((f) => (
                    <tr key={f.id}>
                      <td className="py-1.5">{f.nombre}<span className="ml-1 text-xs text-suave">{f.sku}</span></td>
                      <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs ${ETIQ[f.estado][1]}`}>{ETIQ[f.estado][0]}</span></td>
                      <td className="py-1.5 text-right tabular-nums">{f.stock[0]}</td>
                      <td className="py-1.5 text-right tabular-nums">{f.stock[1]}</td>
                      <td className="py-1.5 text-right tabular-nums" title={`Home ${f.vendidas[0]} · Beauty ${f.vendidas[1]}`}>{f.vendidas[0] + f.vendidas[1]}</td>
                      <td className="py-1.5 text-right tabular-nums">{f.dias === null ? "—" : f.dias >= 365 ? "+1 año" : `${Math.floor(f.dias)} días`}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{f.pedir || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="text-xs text-suave">Es una sugerencia: no tiene en cuenta temporadas ni promociones. Los productos que nunca se vendieron en el período no se piden.</p>
    </div>
  );
}
