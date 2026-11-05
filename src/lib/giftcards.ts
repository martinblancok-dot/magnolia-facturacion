// Control de gift cards: estado de cada tarjeta a partir de sus movimientos.
export type EstadoGc = "sin-usar" | "en-parte" | "agotada" | "anulada";

export interface TarjetaBase { id: string; codigo: string; monto: number; saldo: number; medio_origen: string; local_id: number | null; venta_id: string | null; creada_en: string; anulada: boolean }
export interface MovimientoGc { giftcard_id: string; venta_id: string | null; monto: number; creado_en: string }

export const NOMBRE_ESTADO: Record<EstadoGc, string> = { "sin-usar": "Sin usar", "en-parte": "Usada en parte", agotada: "Agotada", anulada: "Anulada" };

export function estadoGc(t: Pick<TarjetaBase, "monto" | "saldo" | "anulada">): EstadoGc {
  if (t.anulada) return "anulada";
  if (Number(t.saldo) <= 0) return "agotada";
  if (Number(t.saldo) >= Number(t.monto)) return "sin-usar";
  return "en-parte";
}

/** Usos de la tarjeta (descontando los que se devolvieron al anular una venta). */
export function resumenUsos(movs: MovimientoGc[]) {
  const porVenta = new Map<string, { monto: number; creado_en: string }>();
  for (const m of movs) {
    const k = m.venta_id ?? `sin-venta-${m.creado_en}`;
    const x = porVenta.get(k) ?? { monto: 0, creado_en: m.creado_en };
    x.monto += Number(m.monto);
    if (Number(m.monto) < 0) x.creado_en = m.creado_en;
    porVenta.set(k, x);
  }
  const usos = [...porVenta.entries()].filter(([, x]) => x.monto < -0.005).map(([venta_id, x]) => ({ venta_id, usado: -x.monto, creado_en: x.creado_en }))
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  return { usos, ultimoUso: usos.at(-1)?.creado_en ?? null, usado: usos.reduce((s, u) => s + u.usado, 0) };
}
