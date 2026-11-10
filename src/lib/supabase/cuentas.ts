// Cuentas corrientes: saldos, ficha de cada clienta y pagos. Solo se usa del lado del servidor.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClienteCC { id: string; nombre: string; telefono: string | null; dni: string | null; notas: string | null; limite: number; activo: boolean; creado_en: string }
export interface SaldoCC { debe: number; compras: number; pagos: number; ultimaCompra: string | null; ultimoPago: string | null; deudaDesde: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Saldo de cada clienta (lo que debe = compras a cuenta − pagos). */
export async function saldosCC(db: SupabaseClient, ids?: string[]): Promise<Map<string, SaldoCC>> {
  let qv = db.from("ventas").select("cliente_cc_id, total, creada_en").eq("medio_pago", "cuenta").eq("anulada", false).not("cliente_cc_id", "is", null).order("creada_en");
  let qp = db.from("cc_pagos").select("cliente_id, monto, creado_en").eq("anulado", false).order("creado_en");
  if (ids) { qv = qv.in("cliente_cc_id", ids); qp = qp.in("cliente_id", ids); }
  const [{ data: ventas, error: e1 }, { data: pagos, error: e2 }] = await Promise.all([qv.limit(20000), qp.limit(20000)]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const res = new Map<string, SaldoCC>();
  const de = (id: string) => res.get(id) ?? (res.set(id, { debe: 0, compras: 0, pagos: 0, ultimaCompra: null, ultimoPago: null, deudaDesde: null }), res.get(id)!);
  // recorre en orden de fecha para saber desde cuándo debe (la última vez que estuvo en cero)
  const eventos = [
    ...(ventas ?? []).map((v) => ({ id: v.cliente_cc_id as string, monto: Number(v.total), fecha: v.creada_en as string, compra: true })),
    ...(pagos ?? []).map((p) => ({ id: p.cliente_id as string, monto: -Number(p.monto), fecha: p.creado_en as string, compra: false })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const e of eventos) {
    const s = de(e.id);
    const antes = s.debe;
    s.debe = r2(s.debe + e.monto);
    if (e.compra) { s.compras = r2(s.compras + e.monto); s.ultimaCompra = e.fecha; } else { s.pagos = r2(s.pagos - e.monto); s.ultimoPago = e.fecha; }
    if (antes <= 0 && s.debe > 0) s.deudaDesde = e.fecha;
    if (s.debe <= 0) s.deudaDesde = null;
  }
  return res;
}

export async function clientesCC(db: SupabaseClient, soloActivas = true) {
  let q = db.from("clientes_cc").select("*").order("nombre");
  if (soloActivas) q = q.eq("activo", true);
  const { data, error } = await q;
  if (error) throw new Error(/clientes_cc/.test(error.message) ? "Falta correr la migración 0026_cuentas_corrientes.sql en Supabase." : error.message);
  const saldos = await saldosCC(db);
  return (data as ClienteCC[]).map((c) => ({ ...c, limite: Number(c.limite), saldo: saldos.get(c.id) ?? { debe: 0, compras: 0, pagos: 0, ultimaCompra: null, ultimoPago: null, deudaDesde: null } }));
}

/** Movimientos de una clienta con el saldo después de cada uno. */
export async function fichaCC(db: SupabaseClient, id: string) {
  const [{ data: cliente }, { data: ventas }, { data: pagos }] = await Promise.all([
    db.from("clientes_cc").select("*").eq("id", id).maybeSingle(),
    db.from("ventas").select("id, creada_en, local_id, total, anulada, cambio_de, venta_items(n, nombre, cantidad, total)").eq("cliente_cc_id", id).order("creada_en"),
    db.from("cc_pagos").select("*").eq("cliente_id", id).order("creado_en"),
  ]);
  if (!cliente) return null;
  type Mov = { tipo: "compra" | "cambio" | "pago"; id: string; fecha: string; monto: number; detalle: string; anulado: boolean; local_id?: number | null; medio?: string; items?: { n: number; nombre: string; cantidad: number; total: number }[]; saldo: number };
  const movs: Mov[] = [
    ...(ventas ?? []).map((v) => ({ tipo: (v.cambio_de ? "cambio" : "compra") as Mov["tipo"], id: v.id, fecha: v.creada_en, monto: Number(v.total), anulado: v.anulada, local_id: v.local_id,
      detalle: v.cambio_de ? "Cambio / devolución" : "Compra", items: ((v.venta_items ?? []) as Mov["items"])!.sort((a, b) => a.n - b.n), saldo: 0 })),
    ...(pagos ?? []).map((p) => ({ tipo: "pago" as const, id: p.id, fecha: p.creado_en, monto: -Number(p.monto), anulado: p.anulado, local_id: p.local_id, medio: p.medio,
      detalle: `Pago${p.nota ? ` · ${p.nota}` : ""}`, saldo: 0 })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let saldo = 0;
  for (const m of movs) { if (!m.anulado) saldo = r2(saldo + m.monto); m.saldo = saldo; }
  return { cliente: { ...(cliente as ClienteCC), limite: Number(cliente.limite) }, movimientos: movs.reverse(), saldo };
}

export const MEDIOS_PAGO_CC = ["efectivo", "transferencia", "debito", "credito", "cuotas", "qr"] as const;

/** Registra un pago. Si es en efectivo y se indica una caja abierta, también suma a esa caja (como ingreso). */
export async function registrarPagoCC(db: SupabaseClient, p: { cliente_id: string; monto: number; medio: string; turno_id?: string | null; nota?: string | null; usuario_id: string }) {
  const monto = r2(Number(p.monto));
  if (!(monto > 0) || monto > 10_000_000) throw new Error("Monto inválido.");
  if (!(MEDIOS_PAGO_CC as readonly string[]).includes(p.medio)) throw new Error("Medio de pago inválido.");
  const { data: cliente } = await db.from("clientes_cc").select("id, nombre").eq("id", p.cliente_id).maybeSingle();
  if (!cliente) throw new Error("No encontré la clienta.");
  let turno: { id: string; local_id: number } | null = null;
  if (p.turno_id) {
    const { data } = await db.from("turnos_caja").select("id, local_id, cerrada_en").eq("id", p.turno_id).maybeSingle();
    if (data && !data.cerrada_en) turno = { id: data.id, local_id: data.local_id };
  }
  const id = crypto.randomUUID();
  let movimiento_id: string | null = null;
  if (turno && p.medio === "efectivo") {
    movimiento_id = crypto.randomUUID();
    const { error } = await db.from("caja_movimientos").insert({ id: movimiento_id, turno_id: turno.id, tipo: "ingreso", monto, motivo: `Pago cuenta corriente: ${cliente.nombre}`, creado_en: new Date().toISOString(), usuario_id: p.usuario_id });
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from("cc_pagos").insert({ id, cliente_id: p.cliente_id, monto, medio: p.medio, turno_id: turno?.id ?? null, movimiento_id, local_id: turno?.local_id ?? null, nota: p.nota?.slice(0, 200) || null, usuario_id: p.usuario_id });
  if (error) {
    if (movimiento_id) await db.from("caja_movimientos").delete().eq("id", movimiento_id);
    throw new Error(error.message);
  }
  const saldo = (await saldosCC(db, [p.cliente_id])).get(p.cliente_id)?.debe ?? 0;
  return { id, saldo, cliente: cliente.nombre as string, entroACaja: !!movimiento_id };
}

/** Anula un pago (y lo saca de la caja si había entrado). */
export async function anularPagoCC(db: SupabaseClient, id: string) {
  const { data: p } = await db.from("cc_pagos").select("id, movimiento_id, turno_id, anulado").eq("id", id).maybeSingle();
  if (!p || p.anulado) return;
  if (p.movimiento_id) {
    const { data: t } = await db.from("turnos_caja").select("cerrada_en").eq("id", p.turno_id).maybeSingle();
    if (t?.cerrada_en) throw new Error("Ese pago entró a una caja que ya se cerró: no se puede anular.");
    await db.from("caja_movimientos").delete().eq("id", p.movimiento_id);
  }
  await db.from("cc_pagos").update({ anulado: true }).eq("id", id);
}
