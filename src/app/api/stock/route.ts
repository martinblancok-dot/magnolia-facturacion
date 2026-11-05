// Stock por local: GET para ver lo que dice el sistema, POST para cargar mercadería o aplicar un control.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

const usuario = usuarioDeLaSesion;

export async function GET(req: Request) {
  if (!(await usuario())) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const local = Number(new URL(req.url).searchParams.get("local"));
  if (![1, 2].includes(local)) return NextResponse.json({ error: "local inválido" }, { status: 400 });
  const db = clienteServidor();
  const stock: Record<string, number> = {};
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("stock").select("producto_id, cantidad").eq("local_id", local).range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const s of data ?? []) stock[s.producto_id] = Number(s.cantidad);
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ stock });
}

export async function POST(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as
    | { local?: number; tipo?: string; completo?: boolean; nota?: string; items?: { producto_id: string; cantidad: number }[] }
    | null;
  if (!b || ![1, 2].includes(Number(b.local)) || !["ingreso", "conteo"].includes(String(b.tipo))) {
    return NextResponse.json({ error: "datos inválidos" }, { status: 400 });
  }
  const items = (b.items ?? []).filter((i) => /^[0-9a-f-]{36}$/i.test(i.producto_id) && Number.isFinite(Number(i.cantidad)) && Number(i.cantidad) >= 0);
  if (items.length === 0) return NextResponse.json({ error: "no hay productos" }, { status: 400 });
  const { data, error } = await clienteServidor().rpc("aplicar_stock", {
    p_local: Number(b.local), p_tipo: b.tipo, p_items: items, p_completo: b.tipo === "conteo" && !!b.completo,
    p_usuario: u.id, p_nota: (b.nota ?? "").slice(0, 200) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cambiados: data });
}
