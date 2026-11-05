// Recibe aperturas de caja y retiros/gastos que la caja tenía guardados (pudieron hacerse sin internet).
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

const esId = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x));
const esFecha = (x: unknown) => !isNaN(Date.parse(String(x)));

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { turnos?: Record<string, unknown>[]; movimientos?: Record<string, unknown>[] } | null;
  const db = clienteServidor();
  const recibidos: string[] = [];

  for (const t of (b?.turnos ?? []).slice(0, 50)) {
    if (!esId(t.id) || ![1, 2].includes(Number(t.local_id)) || !esFecha(t.abierta_en) || !(Number(t.fondo_inicial) >= 0)) continue;
    const { error } = await db.from("turnos_caja").upsert({
      id: t.id, local_id: Number(t.local_id), terminal: String(t.terminal ?? "").slice(0, 40), abierta_en: t.abierta_en,
      abierta_por: u.id, fondo_inicial: Number(t.fondo_inicial),
    }, { onConflict: "id", ignoreDuplicates: true });
    if (!error) recibidos.push(String(t.id));
  }
  for (const m of (b?.movimientos ?? []).slice(0, 200)) {
    if (!esId(m.id) || !esId(m.turno_id) || !["retiro", "gasto", "ingreso"].includes(String(m.tipo)) || !(Number(m.monto) > 0) || !esFecha(m.creado_en)) continue;
    const { error } = await db.from("caja_movimientos").upsert({
      id: m.id, turno_id: m.turno_id, tipo: m.tipo, monto: Number(m.monto), motivo: String(m.motivo ?? "").slice(0, 200) || null,
      creado_en: m.creado_en, usuario_id: u.id,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (!error) recibidos.push(String(m.id));
  }
  return NextResponse.json({ recibidos });
}

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const local = Number(new URL(req.url).searchParams.get("local"));
  if (![1, 2].includes(local)) return NextResponse.json({ error: "local inválido" }, { status: 400 });
  const db = clienteServidor();
  const [{ data: abierto }, { data: ultimo }] = await Promise.all([
    db.from("turnos_caja").select("id, local_id, terminal, abierta_en, fondo_inicial").eq("local_id", local).is("cerrada_en", null).order("abierta_en", { ascending: false }).limit(1).maybeSingle(),
    db.from("turnos_caja").select("deja_en_caja, cerrada_en").eq("local_id", local).not("cerrada_en", "is", null).order("cerrada_en", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return NextResponse.json({ abierto, ultimoDeja: ultimo?.deja_en_caja ?? null });
}
