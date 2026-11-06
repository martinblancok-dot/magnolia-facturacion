// Datos para el control de gift cards (tarjetas, usos, ventas y quién las vendió).
import type { SupabaseClient } from "@supabase/supabase-js";
import { resumenUsos, type MovimientoGc, type TarjetaBase } from "../giftcards";

type VentaGc = { id: string; local_id: number; usuario_id: string | null; creada_en: string; anulada: boolean; medio_pago: string; total: number };

async function enLotes<T>(ids: string[], traer: (lote: string[]) => PromiseLike<{ data: T[] | null }>) {
  const res: T[] = [];
  for (let i = 0; i < ids.length; i += 200) res.push(...((await traer(ids.slice(i, i + 200))).data ?? []));
  return res;
}

export async function controlGiftcards(db: SupabaseClient, filtro: { ids?: string[] } = {}) {
  let q = db.from("giftcards").select("*").order("creada_en", { ascending: false }).limit(2000);
  if (filtro.ids) q = q.in("id", filtro.ids);
  const { data, error } = await q;
  if (error) return { error: error.message, tarjetas: [] };
  const tarjetas = ((data ?? []) as TarjetaBase[]).map((t) => ({ ...t, monto: Number(t.monto), saldo: Number(t.saldo) }));
  const ids = tarjetas.map((t) => t.id);
  const movs = await enLotes<MovimientoGc>(ids, (l) => db.from("giftcard_movimientos").select("giftcard_id, venta_id, monto, creado_en").in("giftcard_id", l));
  const idsVentas = [...new Set([...tarjetas.map((t) => t.venta_id), ...movs.map((m) => m.venta_id)].filter(Boolean) as string[])];
  const [ventas, { data: perfiles }] = await Promise.all([
    enLotes<VentaGc>(idsVentas, (l) => db.from("ventas").select("id, local_id, usuario_id, creada_en, anulada, medio_pago, total").in("id", l)),
    db.from("perfiles").select("usuario_id, nombre"),
  ]);
  const venta = (id: string | null) => ventas.find((v) => v.id === id) ?? null;
  const nombre = (id: string | null | undefined) => perfiles?.find((p) => p.usuario_id === id)?.nombre ?? null;
  return {
    error: null,
    tarjetas: tarjetas.map((t) => {
      const r = resumenUsos(movs.filter((m) => m.giftcard_id === t.id));
      const vv = venta(t.venta_id);
      return {
        ...t,
        vendidaPor: nombre(vv?.usuario_id),
        usos: r.usos.map((u) => ({ ...u, venta: venta(u.venta_id), usuario: nombre(venta(u.venta_id)?.usuario_id) })),
        usado: r.usado,
        ultimoUso: r.ultimoUso,
      };
    }),
  };
}
export type TarjetaControl = Awaited<ReturnType<typeof controlGiftcards>>["tarjetas"][number];
