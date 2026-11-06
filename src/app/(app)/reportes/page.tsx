import Link from "next/link";
import { nombreMedio } from "@/lib/caja";
import { pesos } from "@/lib/formato";
import { calcularReporte, type ProductoRep, type VentaRep } from "@/lib/reportes";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const hoyAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const sumarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);

function periodo(p: string | undefined, desde?: string, hasta?: string): [string, string, string] {
  const hoy = hoyAR();
  const d = new Date(`${hoy}T12:00:00Z`);
  if (desde && hasta && /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta)) return [desde, hasta, "personalizado"];
  switch (p) {
    case "hoy": return [hoy, hoy, "hoy"];
    case "ayer": return [sumarDias(hoy, -1), sumarDias(hoy, -1), "ayer"];
    case "semana": return [sumarDias(hoy, -((d.getUTCDay() + 6) % 7)), hoy, "semana"];
    case "30": return [sumarDias(hoy, -29), hoy, "30"];
    case "mes-pasado": {
      const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
      const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
      return [ini, fin, "mes-pasado"];
    }
    case "anio": return [`${hoy.slice(0, 4)}-01-01`, hoy, "anio"];
    default: return [`${hoy.slice(0, 7)}-01`, hoy, "mes"];
  }
}

function Tabla({ titulo, filas }: { titulo: string; filas: ReturnType<typeof calcularReporte>["porCategoria"] }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <section className="tarjeta">
      <h2 className="font-semibold">{titulo}</h2>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-suave uppercase"><tr><th className="py-1">Nombre</th><th className="py-1 text-right">Unid.</th><th className="py-1 text-right">Vendido</th><th className="py-1 text-right">Ganancia</th></tr></thead>
        <tbody className="divide-y divide-linea">
          {filas.slice(0, 15).map((f) => (
            <tr key={f.clave}>
              <td className="py-1.5">{f.clave}<div className="mt-1 h-1 rounded bg-marca/70" style={{ width: `${Math.max(2, (f.ingreso / (filas[0]?.ingreso || 1)) * 100)}%` }} /></td>
              <td className="py-1.5 text-right tabular-nums">{f.unidades}</td>
              <td className="py-1.5 text-right tabular-nums">{pesos(f.ingreso).replace(",00", "")}</td>
              <td className="py-1.5 text-right tabular-nums">{f.ingreso - f.sinCosto > 0 ? <>{pesos(f.ingreso - f.sinCosto - f.costo).replace(",00", "")} <span className="text-xs text-suave">{pct((f.ingreso - f.sinCosto - f.costo) / (f.ingreso - f.sinCosto))}</span></> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function traerVentas(db: ReturnType<typeof clienteServidor>, desde: string, hasta: string, local: number | null) {
  const ventas: VentaRep[] = [];
  for (let i = 0; i < 30000; i += 1000) {
    let q = db.from("ventas").select("*, venta_items(producto_id, sku, nombre, cantidad, total)")
      .eq("anulada", false).gte("creada_en", `${desde}T00:00:00-03:00`).lt("creada_en", `${sumarDias(hasta, 1)}T00:00:00-03:00`).order("creada_en").range(i, i + 999);
    if (local) q = q.eq("local_id", local);
    const { data } = await q;
    ventas.push(...(data ?? []).map((v) => ({ ...v, total: Number(v.total), giftcard_monto: Number(v.giftcard_monto ?? 0), items: (v.venta_items ?? []) as VentaRep["items"] })));
    if (!data || data.length < 1000) break;
  }
  return ventas;
}

export default async function Reportes({ searchParams }: { searchParams: Promise<{ p?: string; desde?: string; hasta?: string; local?: string }> }) {
  await soloDuenio();
  const sp = await searchParams;
  const [desde, hasta, clave] = periodo(sp.p, sp.desde, sp.hasta);
  const local = sp.local === "1" || sp.local === "2" ? Number(sp.local) : null;
  const largo = diasEntre(desde, hasta) + 1;
  const db = clienteServidor();
  const [ventas, anteriores] = await Promise.all([
    traerVentas(db, desde, hasta, local),
    traerVentas(db, sumarDias(desde, -largo), sumarDias(desde, -1), local),
  ]);
  const ids = [...new Set([...ventas, ...anteriores].flatMap((v) => v.items.map((i) => i.producto_id)).filter(Boolean) as string[])];
  const productos = new Map<string, ProductoRep>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("productos").select("id, costo, categoria, proveedor, hoja").in("id", ids.slice(i, i + 200));
    for (const p of data ?? []) productos.set(p.id, { id: p.id, costo: p.costo === null ? null : Number(p.costo), categoria: p.categoria, proveedor: p.hoja ?? p.proveedor });
  }
  const r = calcularReporte(ventas, productos);
  const a = calcularReporte(anteriores, productos);
  const cambio = (x: number, y: number) => (y > 0 ? Math.round(((x - y) / y) * 100) : null);
  const flecha = (x: number, y: number) => {
    const c = cambio(x, y);
    if (c === null) return null;
    return <span className={`text-xs font-semibold ${c >= 0 ? "text-green-700" : "text-red-700"}`}>{c >= 0 ? "▲" : "▼"} {Math.abs(c)}% vs período anterior</span>;
  };
  const url = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(sp.p ? { p: sp.p } : {}), ...(sp.desde ? { desde: sp.desde, hasta: sp.hasta ?? "" } : {}), ...(local ? { local: String(local) } : {}), ...extra });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return `/reportes?${q}`;
  };
  const fecha = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  const maxHora = Math.max(...r.porHora, 1), maxDia = Math.max(...r.porDia, 1), maxFecha = Math.max(...r.porFecha.map((x) => x[1]), 1);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reportes</h1>
          <p className="text-sm text-suave">Del {new Date(`${desde}T12:00:00Z`).toLocaleDateString("es-AR")} al {new Date(`${hasta}T12:00:00Z`).toLocaleDateString("es-AR")} · {local === 1 ? "Magnolia Home" : local === 2 ? "Magnolia Beauty" : "los dos locales"}</p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          {local && <input type="hidden" name="local" value={local} />}
          <input type="date" name="desde" defaultValue={desde} className="rounded-lg border border-linea bg-white px-2 py-1.5" />
          <span className="text-suave">al</span>
          <input type="date" name="hasta" defaultValue={hasta} className="rounded-lg border border-linea bg-white px-2 py-1.5" />
          <button className="boton-borde !py-1.5">Ver</button>
        </form>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {[["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Esta semana"], ["mes", "Este mes"], ["mes-pasado", "Mes pasado"], ["30", "Últimos 30 días"], ["anio", "Este año"]].map(([k, t]) => (
          <Link key={k} href={url({ p: k, desde: "", hasta: "" })} className={`rounded-full border px-3 py-1.5 ${clave === k ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{t}</Link>
        ))}
        <span className="mx-1 text-linea">|</span>
        {[["", "Los dos locales"], ["1", "Home"], ["2", "Beauty"]].map(([k, t]) => (
          <Link key={k} href={url({ local: k })} className={`rounded-full border px-3 py-1.5 ${String(local ?? "") === k ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{t}</Link>
        ))}
      </div>

      {r.ventas === 0 && <p className="tarjeta text-sm text-suave">No hay ventas en este período{local ? " para este local" : ""}.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Vendido en productos</p><p className="text-2xl font-semibold">{pesos(r.ingreso)}</p>{flecha(r.ingreso, a.ingreso)}</div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Ganancia estimada</p><p className="text-2xl font-semibold">{pesos(r.ganancia)}</p>
          <p className="text-xs text-suave">margen {pct(r.margen)} sobre el costo cargado{r.sinCostoIngreso > 0 ? ` · ${pesos(r.sinCostoIngreso)} vendidos sin costo cargado` : ""}</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Ventas</p><p className="text-2xl font-semibold">{r.conProductos}</p>{flecha(r.conProductos, a.conProductos)}<p className="text-xs text-suave">{r.unidades} unidades</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Ticket promedio</p><p className="text-2xl font-semibold">{pesos(r.ticketPromedio)}</p>{flecha(r.ticketPromedio, a.ticketPromedio)}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="tarjeta">
          <h2 className="font-semibold">Plata que entró a la caja</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {r.porMedio.filter(([, v]) => v !== 0).map(([m, v]) => <li key={m} className="flex justify-between"><span>{nombreMedio(m)}</span><b className="tabular-nums">{pesos(v)}</b></li>)}
            <li className="flex justify-between border-t border-linea pt-1"><span>Total cobrado</span><b>{pesos(r.cobrado)}</b></li>
          </ul>
          <p className="mt-2 text-xs text-suave">Incluye {pesos(r.giftcardsVendidas)} de gift cards vendidas. Se usaron {pesos(r.giftcardsUsadas)} de gift cards (no entran a la caja){r.devoluciones ? ` y se devolvieron ${pesos(r.devoluciones)} en cambios` : ""}.</p>
        </section>
        <section className="tarjeta">
          <h2 className="font-semibold">Por local</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {r.porLocal.map(([l, x]) => (
              <li key={l}><div className="flex justify-between"><span>{l === 2 ? "Magnolia Beauty" : "Magnolia Home"}</span><b>{pesos(x.ingreso)}</b></div>
                <div className="mt-1 h-1.5 rounded bg-marca/70" style={{ width: `${Math.max(2, (x.ingreso / (r.ingreso || 1)) * 100)}%` }} />
                <span className="text-xs text-suave">{x.ventas} ventas · ticket {pesos(x.ventas ? x.ingreso / x.ventas : 0)}</span></li>
            ))}
          </ul>
        </section>
        <section className="tarjeta">
          <h2 className="font-semibold">Día de la semana</h2>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <div key={d} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-marca/80" style={{ height: `${(r.porDia[d] / maxDia) * 100}%` }} title={pesos(r.porDia[d])} />
                <span className="text-xs text-suave">{DIAS[d]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="tarjeta">
        <h2 className="font-semibold">Ventas por día</h2>
        <div className="mt-3 flex h-32 items-end gap-0.5 overflow-x-auto">
          {r.porFecha.map(([d, v]) => (
            <div key={d} className="flex min-w-3 flex-1 flex-col items-center" title={`${fecha(d)}: ${pesos(v)}`}>
              <div className="w-full rounded-t bg-marca/80" style={{ height: `${(v / maxFecha) * 100}%` }} />
            </div>
          ))}
        </div>
        {r.porFecha.length > 0 && <p className="mt-1 flex justify-between text-xs text-suave"><span>{fecha(r.porFecha[0][0])}</span><span>{fecha(r.porFecha.at(-1)![0])}</span></p>}
      </section>

      <section className="tarjeta">
        <h2 className="font-semibold">Horarios con más ventas</h2>
        <div className="mt-3 flex h-28 items-end gap-1">
          {r.porHora.map((v, h) => h >= 8 && h <= 22 ? (
            <div key={h} className="flex flex-1 flex-col items-center gap-1" title={pesos(v)}>
              <div className="w-full rounded-t bg-marca/80" style={{ height: `${(v / maxHora) * 100}%` }} />
              <span className="text-xs text-suave">{h}</span>
            </div>
          ) : null)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tabla titulo="Por categoría" filas={r.porCategoria} />
        <Tabla titulo="Por proveedor" filas={r.porProveedor} />
      </div>

      <section className="tarjeta">
        <h2 className="font-semibold">Más vendidos</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-suave uppercase"><tr><th className="py-1">#</th><th className="py-1">Producto</th><th className="py-1 text-right">Unidades</th><th className="py-1 text-right">Vendido</th><th className="py-1 text-right">Ganancia</th></tr></thead>
          <tbody className="divide-y divide-linea">
            {r.masVendidos.map((f, i) => (
              <tr key={f.clave}>
                <td className="py-1.5 text-suave">{i + 1}</td>
                <td className="py-1.5">{f.nombre}<span className="ml-1 text-xs text-suave">{f.sku}</span></td>
                <td className="py-1.5 text-right tabular-nums">{f.unidades}</td>
                <td className="py-1.5 text-right tabular-nums">{pesos(f.ingreso).replace(",00", "")}</td>
                <td className="py-1.5 text-right tabular-nums">{f.ingreso - f.sinCosto > 0 ? pesos(f.ingreso - f.sinCosto - f.costo).replace(",00", "") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-suave">La ganancia se calcula con el costo actual de cada producto (el de Precios Deco), descontando promos y descuentos. Los productos sin costo cargado no suman ganancia.</p>
    </div>
  );
}
