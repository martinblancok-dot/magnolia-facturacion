// GET: resumen del turno para cerrar (trae cobros nuevos de Mercado Pago). POST: cierra el turno con el arqueo.
import { NextResponse } from "next/server";
import { avisarCierre } from "@/lib/supabase/aviso-cierre";
import { totalBilletes } from "@/lib/cierre";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";
import { calcularCierre, confirmarTransferenciasConCaja } from "@/lib/supabase/turnos";

export const maxDuration = 60;

const usuario = usuarioDeLaSesion;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuario())) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const { id } = await ctx.params;
  const db = clienteServidor();
  const c = await calcularCierre(db, id, true);
  if (!c) return NextResponse.json({ error: "turno no encontrado" }, { status: 404 });
  // Las otras compus que están trabajando en esta caja (para no cerrar con ventas sin subir)
  const [{ data: compus }, { data: perfiles }] = await Promise.all([
    db.from("terminales").select("id, usuario_id, pendientes, visto_en").eq("turno_id", id),
    db.from("perfiles").select("usuario_id, nombre"),
  ]);
  const terminales = (compus ?? []).map((t) => ({ ...t, nombre: perfiles?.find((p) => p.usuario_id === t.usuario_id)?.nombre ?? "" }));
  return NextResponse.json({ ...c, terminales });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { billetes?: Record<string, number>; monedas?: number; deja_en_caja?: number; notas?: string } | null;
  if (!b) return NextResponse.json({ error: "datos inválidos" }, { status: 400 });
  const db = clienteServidor();
  const c = await calcularCierre(db, id, false);
  if (!c) return NextResponse.json({ error: "turno no encontrado" }, { status: 404 });
  if (c.turno.cerrada_en) return NextResponse.json({ error: "esta caja ya está cerrada" }, { status: 409 });

  const billetes = Object.fromEntries(Object.entries(b.billetes ?? {}).map(([k, v]) => [k, Math.max(0, Math.floor(Number(v) || 0))]));
  const contado = totalBilletes(billetes, Math.max(0, Number(b.monedas) || 0));
  // Lo que se cuenta en el arqueo es lo que queda en la caja (la plata grande se saca antes con un retiro)
  const { error } = await db.from("turnos_caja").update({
    cerrada_en: new Date().toISOString(), cerrada_por: u.id,
    efectivo_esperado: c.resumen.efectivoEsperado, efectivo_contado: contado,
    diferencia: Math.round((contado - c.resumen.efectivoEsperado) * 100) / 100,
    deja_en_caja: contado, billetes: { ...billetes, monedas: Number(b.monedas) || 0 },
    resumen: { ...c.resumen, alertas: c.alertas, top: c.top }, notas: String(b.notas ?? "").slice(0, 500) || null,
  }).eq("id", id).is("cerrada_en", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Al cerrar: las transferencias de este turno que coinciden con ventas pasan solas a "Por facturar"
  try { await confirmarTransferenciasConCaja(db, c.turno.abierta_en); } catch {}
  const aviso = await avisarCierre(db, id);
  return NextResponse.json({ ok: true, contado, esperado: c.resumen.efectivoEsperado, aviso });
}
