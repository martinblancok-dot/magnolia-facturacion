// Cierre de caja del lado del servidor: junta ventas, movimientos y cobros de Mercado Pago del turno.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cruzarPagos, MINUTOS_ANTES, MINUTOS_DESPUES, resumenTurno, type CobroMP, type MovimientoCaja, type VentaTurno } from "../cierre";
import { traerCobros } from "../mercadopago";
import { guardarCobros, traerEmisores } from "./almacen";

export interface Turno {
  id: string; local_id: number; terminal: string | null; abierta_en: string; fondo_inicial: number;
  cerrada_en: string | null; efectivo_esperado: number | null; efectivo_contado: number | null; diferencia: number | null;
  deja_en_caja: number | null; billetes: unknown; resumen: unknown; notas: string | null;
}

const minutos = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

/** Trae a la base los cobros nuevos de las cuentas de Mercado Pago (de todos los emisores). */
export async function refrescarCobros(db: SupabaseClient, desdeISO: string): Promise<string[]> {
  const errores: string[] = [];
  for (const e of await traerEmisores(db).catch(() => [])) {
    if (!e.mpToken) continue;
    try {
      await guardarCobros(db, e.usuarioId, await traerCobros(e.mpToken, desdeISO, new Date().toISOString()));
    } catch (err) {
      errores.push(`${e.nombre}: ${(err as Error).message}`);
    }
  }
  return errores;
}

export async function calcularCierre(db: SupabaseClient, turnoId: string, refrescar: boolean) {
  const { data: turno } = await db.from("turnos_caja").select("*").eq("id", turnoId).maybeSingle();
  if (!turno) return null;
  const t = turno as Turno;
  const hasta = t.cerrada_en ?? new Date().toISOString();
  const erroresMP = refrescar ? await refrescarCobros(db, minutos(t.abierta_en, -180)) : [];

  const [{ data: ventas }, { data: movs }, { data: delPeriodo }, { data: cobros }, { data: items }] = await Promise.all([
    db.from("ventas").select("*").eq("turno_id", t.id).order("creada_en"),
    db.from("caja_movimientos").select("tipo, monto, motivo, creado_en").eq("turno_id", t.id).order("creado_en"),
    // ventas no-efectivo de los DOS locales en el período: un mismo cobro de MP puede ser del otro local
    db.from("ventas").select("*")
      .neq("medio_pago", "efectivo").gte("creada_en", minutos(t.abierta_en, -MINUTOS_DESPUES)).lte("creada_en", minutos(hasta, MINUTOS_ANTES)),
    db.from("cobros").select("id, fecha_hora, importe, origen")
      .gte("fecha_hora", minutos(t.abierta_en, -MINUTOS_ANTES)).lte("fecha_hora", minutos(hasta, MINUTOS_DESPUES)),
    db.from("venta_items").select("nombre, sku, cantidad, total, ventas!inner(turno_id, anulada)").eq("ventas.turno_id", t.id).eq("ventas.anulada", false),
  ]);

  const vs = (ventas ?? []).map((v) => ({ ...v, total: Number(v.total) })) as VentaTurno[];
  const resumen = resumenTurno(Number(t.fondo_inicial), vs, (movs ?? []).map((m) => ({ tipo: m.tipo, monto: Number(m.monto) })) as MovimientoCaja[]);
  const cruce = cruzarPagos(
    ((delPeriodo ?? []) as (VentaTurno & { local_id: number; terminal?: string | null })[]).filter((v) => !v.terminal?.startsWith("Aronium")).map((v) => ({ ...v, total: Number(v.total) })),
    ((cobros ?? []) as CobroMP[]).map((c) => ({ ...c, importe: Number(c.importe) })),
  );
  const idsTurno = new Set(vs.map((v) => v.id));
  // Cobros que caen dentro del horario de ESTE turno y no se cruzaron con ninguna venta de ningún local
  const desdeMs = Date.parse(t.abierta_en), hastaMs = Date.parse(hasta);
  const cobrosSinVenta = cruce.cobrosSinVenta.filter((c) => Date.parse(c.fecha_hora) >= desdeMs && Date.parse(c.fecha_hora) <= hastaMs);

  // Productos más vendidos del turno
  const top = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const i of items ?? []) {
    const k = i.sku ?? i.nombre;
    const x = top.get(k) ?? { nombre: i.nombre, cantidad: 0, total: 0 };
    x.cantidad += Number(i.cantidad); x.total += Number(i.total);
    top.set(k, x);
  }

  return {
    turno: t,
    ventas: vs,
    movimientos: movs ?? [],
    resumen,
    alertas: {
      ventasSinCobro: cruce.ventasSinCobro.filter((v) => idsTurno.has(v.id)),
      cobrosSinVenta,
      verificados: cruce.encontrados.filter((e) => idsTurno.has(e.ventaId)).length,
      erroresMP,
    },
    top: [...top.values()].sort((a, b) => b.total - a.total).slice(0, 10),
  };
}

export type Cierre = NonNullable<Awaited<ReturnType<typeof calcularCierre>>>;

/**
 * Transferencias "para revisar" que coinciden con una venta de la caja (mismo importe ±$1, de 60 min antes
 * a 90 min después de cobrar) pasan solas a "Por facturar". Cruza con los cobros de las dos cuentas a la vez,
 * así una venta no confirma dos transferencias. Devuelve cuántas confirmó.
 */
export async function confirmarTransferenciasConCaja(db: SupabaseClient, desdeISO: string): Promise<number> {
  const hasta = new Date().toISOString();
  const [{ data: cobros, error: e1 }, { data: ventas, error: e2 }] = await Promise.all([
    db.from("cobros").select("id, fecha_hora, importe, origen, estado").gte("fecha_hora", minutos(desdeISO, -MINUTOS_DESPUES)).lte("fecha_hora", hasta).limit(5000),
    db.from("ventas").select("*").eq("anulada", false).neq("medio_pago", "efectivo")
      .gte("creada_en", minutos(desdeISO, -MINUTOS_DESPUES)).lte("creada_en", hasta).limit(5000),
  ]);
  if (e1 || e2 || !cobros?.length || !ventas?.length) return 0;
  if (!cobros.some((c) => c.estado === "revisar")) return 0;
  const cruce = cruzarPagos(
    (ventas as (VentaTurno & { terminal?: string | null })[]).filter((v) => !v.terminal?.startsWith("Aronium")).map((v) => ({ ...v, total: Number(v.total) })),
    (cobros as CobroMP[]).map((c) => ({ ...c, importe: Number(c.importe) })),
  );
  const revisar = new Set(cobros.filter((c) => c.estado === "revisar").map((c) => c.id));
  const ids = cruce.encontrados.map((e) => e.cobroId).filter((id) => revisar.has(id));
  if (!ids.length) return 0;
  const { data } = await db.from("cobros").update({ estado: "a_facturar", mensaje: null }).in("id", ids).eq("estado", "revisar").select("id");
  return data?.length ?? 0;
}
