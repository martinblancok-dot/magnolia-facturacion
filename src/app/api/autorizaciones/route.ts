// Pedidos de autorización de descuentos: la caja de un colaborador los pide y los consulta;
// los dueños ven cuántos hay pendientes.
import { NextResponse } from "next/server";
import { leerEstado } from "@/lib/supabase/planilla";
import { clienteServidor } from "@/lib/supabase/almacen";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { local_id?: number; datos?: Record<string, unknown> } | null;
  const d = b?.datos ?? {};
  const valor = Number(d.valor);
  if (!["pct", "monto"].includes(String(d.tipo)) || !(valor > 0) || (d.tipo === "pct" && valor > 100)) return NextResponse.json({ error: "Descuento inválido." }, { status: 400 });
  const { data, error } = await clienteServidor().from("autorizaciones").insert({
    tipo: "descuento", local_id: [1, 2].includes(Number(b?.local_id)) ? Number(b?.local_id) : null, pedido_por: u.id,
    datos: { tipo: d.tipo, valor, motivo: String(d.motivo ?? "").slice(0, 120) || null, subtotal: Number(d.subtotal) || 0, productos: Array.isArray(d.productos) ? d.productos.slice(0, 20) : [] },
  }).select("id").single();
  if (error) return NextResponse.json({ error: /autorizaciones/.test(error.message) ? "Falta correr la migración 0016_cambios_promos.sql en Supabase." : error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const db = clienteServidor();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data } = await db.from("autorizaciones").select("estado, datos, pedido_por").eq("id", id).maybeSingle();
    if (!data || data.pedido_por !== u.id) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    return NextResponse.json({ estado: data.estado, datos: data.datos });
  }
  // Para los dueños: cuántos pedidos esperan respuesta
  if ((await perfilDe(u.id)).rol !== "duenio") return NextResponse.json({ descuentos: 0, anulaciones: 0, codigos: 0 });
  const [a, b, planilla] = await Promise.all([
    db.from("autorizaciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
    db.from("ventas").select("id", { count: "exact", head: true }).not("anulacion_pedida_en", "is", null).eq("anulada", false),
    leerEstado(db).catch(() => null),
  ]);
  return NextResponse.json({ descuentos: a.count ?? 0, anulaciones: b.count ?? 0, codigos: planilla?.codigos?.repetidos.length ?? 0 });
}
