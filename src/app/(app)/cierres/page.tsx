import Link from "next/link";
import { DiaSelector } from "../../dia-selector";
import { fechaCorta, hora, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

type R = { total?: number; cantidad?: number; alertas?: { ventasSinCobro?: unknown[]; cobrosSinVenta?: unknown[] } } | null;

const diaDe = (fecha: Date) => new Date(fecha.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

export default async function Cierres({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  await soloDuenio();
  const sp = await searchParams;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? "") ? sp.dia! : "";
  const hoy = diaDe(new Date());
  const db = clienteServidor();
  let q = db.from("turnos_caja").select("id, local_id, abierta_en, cerrada_en, fondo_inicial, efectivo_esperado, efectivo_contado, diferencia, resumen").order("abierta_en", { ascending: false }).limit(60);
  if (dia) {
    const sig = new Date(`${dia}T12:00:00Z`); sig.setUTCDate(sig.getUTCDate() + 1);
    q = q.gte("abierta_en", `${dia}T00:00:00-03:00`).lt("abierta_en", `${sig.toISOString().slice(0, 10)}T00:00:00-03:00`);
  }
  const [{ data: turnos }, { data: locales }] = await Promise.all([q, db.from("locales").select("id, nombre")]);
  const nombre = (id: number) => locales?.find((l) => l.id === id)?.nombre ?? `Local ${id}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cierres de caja</h1>
          <p className="text-sm text-suave">{dia ? <>Cajas del {fechaCorta(dia)} · <Link href="/cierres" className="text-marca underline">ver las últimas</Link></> : "Las últimas 60 cajas. Elegí un día para buscar una anterior."}</p>
        </div>
        <DiaSelector dia={dia} hoy={hoy} ruta="/cierres" />
      </div>
      <div className="rounded-2xl border border-linea bg-white">
        {(turnos ?? []).length === 0 ? <p className="p-10 text-center text-suave">{dia ? "Ese día no se abrió ninguna caja." : "Todavía no hay cajas abiertas."}</p> : (
          <ul className="divide-y divide-linea">
            {(turnos ?? []).map((t) => {
              const r = t.resumen as R;
              const alertas = (r?.alertas?.ventasSinCobro?.length ?? 0) + (r?.alertas?.cobrosSinVenta?.length ?? 0);
              const dif = Number(t.diferencia ?? 0);
              return (
                <li key={t.id}>
                  <Link href={`/cierres/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-marca-claro md:px-6">
                    <span>
                      <b>{fechaCorta(new Date(Date.parse(t.abierta_en) - 3 * 3600_000).toISOString().slice(0, 10))}</b> · {nombre(t.local_id)}
                      <span className="block text-sm text-suave">{hora(t.abierta_en)} a {t.cerrada_en ? hora(t.cerrada_en) : "abierta"}{r?.cantidad !== undefined ? ` · ${r.cantidad} ventas` : ""}</span>
                    </span>
                    <span className="text-right text-sm">
                      {r?.total !== undefined && <b className="block text-base">{pesos(r.total)}</b>}
                      {t.cerrada_en ? (
                        <span className={dif === 0 ? "text-green-800" : "text-red-700"}>{dif === 0 ? "Arqueo OK" : `${dif > 0 ? "Sobrante" : "Faltante"} ${pesos(Math.abs(dif))}`}</span>
                      ) : <span className="rounded bg-marca-claro px-1 text-marca">Abierta</span>}
                      {alertas > 0 && <span className="ml-2 rounded bg-amber-100 px-1 text-amber-900">⚠ {alertas}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
