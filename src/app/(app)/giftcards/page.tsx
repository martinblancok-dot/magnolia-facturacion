import Link from "next/link";
import { nombreMedio } from "@/lib/caja";
import { pesos } from "@/lib/formato";
import { estadoGc, NOMBRE_ESTADO, type EstadoGc } from "@/lib/giftcards";
import { clienteServidor } from "@/lib/supabase/almacen";
import { controlGiftcards } from "@/lib/supabase/giftcards";
import { usuarioConRol } from "@/lib/supabase/sesion";

const FILTROS: { id: string; texto: string }[] = [
  { id: "", texto: "Todas" }, { id: "saldo", texto: "Con saldo" }, { id: "sin-usar", texto: "Sin usar" },
  { id: "en-parte", texto: "Usadas en parte" }, { id: "agotada", texto: "Agotadas" }, { id: "anulada", texto: "Anuladas" },
];
const COLOR: Record<EstadoGc, string> = {
  "sin-usar": "bg-blue-50 text-blue-800", "en-parte": "bg-amber-50 text-amber-900", agotada: "bg-linea/60 text-suave", anulada: "bg-red-50 text-red-800",
};
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
const diasDesde = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
const local = (id: number | null | undefined) => (id === 2 ? "Beauty" : id === 1 ? "Home" : "—");

export default async function GiftCards({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; desde?: string; hasta?: string }> }) {
  const { rol } = await usuarioConRol();
  const duenio = rol === "duenio";
  const sp = await searchParams;
  const texto = (sp.q ?? "").trim();
  const q = texto.toUpperCase().replace(/^GC/, "").replace(/[^0-9A-F]/g, "");
  const sinTildes = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const porNombre = texto.length >= 2 ? sinTildes(texto).split(/\s+/) : [];
  const { tarjetas: todas, error } = await controlGiftcards(clienteServidor());
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? "") ? sp.desde! : "";
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? "") ? sp.hasta! : "";
  const diaAR = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
  const enPeriodo = todas.filter((t) => (!desde || diaAR(t.creada_en) >= desde) && (!hasta || diaAR(t.creada_en) <= hasta));
  const filtradas = enPeriodo.filter((t) => {
    if (texto && !(q.length >= 2 && t.codigo.includes(q)) && !(t.destinatario && porNombre.every((p) => sinTildes(t.destinatario!).includes(p)))) return false;
    const e = estadoGc(t);
    if (sp.estado === "saldo") return e === "sin-usar" || e === "en-parte";
    return !sp.estado || e === sp.estado;
  });
  const vigentes = todas.filter((t) => !t.anulada);
  const pendiente = vigentes.reduce((s, t) => s + t.saldo, 0);
  const periodoVig = enPeriodo.filter((t) => !t.anulada);
  const cuenta = (e: EstadoGc) => enPeriodo.filter((t) => estadoGc(t) === e).length;
  const viejasConSaldo = vigentes.filter((t) => t.saldo > 0 && diasDesde(t.creada_en) > 180).length;
  const url = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.estado ? { estado: sp.estado } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...extra });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/giftcards${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Gift cards</h1>
          <p className="text-sm text-suave">Se venden desde la caja (🎁 Vender gift card) y se usan en los dos locales.</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={sp.q ?? ""} className="campo w-64" placeholder="Código o nombre de quien la recibió" autoComplete="off" />
          <button className="boton">Buscar</button>
        </form>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0011_giftcards.sql</b> en Supabase.</p> : (
        <>
          {duenio && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="tarjeta !p-4"><p className="text-sm text-suave">Saldo sin usar (todas)</p><p className="text-2xl font-semibold">{pesos(pendiente)}</p>
                <p className="text-xs text-suave">Plata ya cobrada que los clientes todavía pueden gastar</p></div>
              <div className="tarjeta !p-4"><p className="text-sm text-suave">Vendidas{desde || hasta ? " en el período" : ""}</p><p className="text-2xl font-semibold">{pesos(periodoVig.reduce((s, t) => s + t.monto, 0))}</p>
                <p className="text-xs text-suave">{periodoVig.length} {periodoVig.length === 1 ? "tarjeta" : "tarjetas"} · promedio {pesos(periodoVig.length ? periodoVig.reduce((s, t) => s + t.monto, 0) / periodoVig.length : 0)}</p></div>
              <div className="tarjeta !p-4"><p className="text-sm text-suave">Ya usado</p><p className="text-2xl font-semibold">{pesos(periodoVig.reduce((s, t) => s + t.usado, 0))}</p>
                <p className="text-xs text-suave">{(() => { const n = periodoVig.reduce((s, t) => s + t.usos.length, 0); return `${n} ${n === 1 ? "compra pagada" : "compras pagadas"} con gift card`; })()}</p></div>
              <div className="tarjeta !p-4"><p className="text-sm text-suave">Estado</p>
                <p className="text-sm">{cuenta("sin-usar")} sin usar · {cuenta("en-parte")} en parte · {cuenta("agotada")} agotadas{cuenta("anulada") ? ` · ${cuenta("anulada")} anuladas` : ""}</p>
                {viejasConSaldo > 0 && <p className="mt-1 text-xs text-amber-800">{viejasConSaldo} con saldo hace más de 6 meses</p>}</div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              {FILTROS.map((f) => (
                <Link key={f.id} href={url({ estado: f.id })} className={`rounded-full border px-3 py-1.5 ${(sp.estado ?? "") === f.id ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>{f.texto}</Link>
              ))}
            </div>
            <form className="flex flex-wrap items-center gap-2 text-sm">
              {sp.estado && <input type="hidden" name="estado" value={sp.estado} />}
              <span className="text-suave">Vendidas del</span>
              <input type="date" name="desde" defaultValue={desde} className="rounded-lg border border-linea bg-white px-2 py-1.5" />
              <span className="text-suave">al</span>
              <input type="date" name="hasta" defaultValue={hasta} className="rounded-lg border border-linea bg-white px-2 py-1.5" />
              <button className="boton-borde !py-1.5">Filtrar</button>
              {(desde || hasta) && <Link href={url({ desde: "", hasta: "" })} className="text-marca underline">Quitar fechas</Link>}
            </form>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
            {filtradas.length === 0 ? <p className="px-6 py-10 text-center text-suave">{texto ? `No hay ninguna gift card con "${texto}".` : "No hay gift cards con ese filtro."}</p> : (
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-linea text-left text-xs tracking-wide text-suave uppercase">
                  <tr>
                    <th className="px-4 py-2">Código</th><th className="px-3 py-2">Vendida</th><th className="px-3 py-2">Pagada con</th>
                    <th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-right">Usado</th><th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2">Estado</th><th className="px-4 py-2">Último uso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linea">
                  {filtradas.map((t) => {
                    const e = estadoGc(t);
                    return (
                      <tr key={t.id} className="hover:bg-marca-claro/50">
                        <td className="px-4 py-2.5"><Link href={`/giftcards/${t.id}`} className="font-mono font-semibold text-marca underline">{t.codigo}</Link>{t.destinatario && <span className="block text-xs">para <b>{t.destinatario}</b></span>}</td>
                        <td className="px-3 py-2.5">{fecha(t.creada_en)} · {local(t.local_id)}<span className="block text-xs text-suave">{t.vendidaPor ? `por ${t.vendidaPor} · ` : ""}{(() => { const d = diasDesde(t.creada_en); return d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`; })()}</span></td>
                        <td className="px-3 py-2.5">{nombreMedio(t.medio_origen)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pesos(t.monto)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.usado ? pesos(t.usado) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{pesos(t.saldo)}</td>
                        <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR[e]}`}>{NOMBRE_ESTADO[e]}</span></td>
                        <td className="px-4 py-2.5">{t.ultimoUso ? <>{fecha(t.ultimoUso)}<span className="block text-xs text-suave">{t.usos.length} {t.usos.length === 1 ? "uso" : "usos"} · {[...new Set(t.usos.map((u) => local(u.venta?.local_id)))].join(" y ")}</span></> : <span className="text-suave">Nunca</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-suave">El descuento al usarla depende de cómo se pagó la tarjeta: efectivo 15%; transferencia, débito o crédito en 1 pago 10%; cuotas, precio de lista.</p>
        </>
      )}
    </div>
  );
}
