// Pasar mercadería de un local al otro.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { desde?: number; hasta?: number; nota?: string; items?: { producto_id: string; variante_id?: string | null; cantidad: number }[] } | null;
  const desde = Number(b?.desde), hasta = Number(b?.hasta);
  if (![1, 2].includes(desde) || ![1, 2].includes(hasta) || desde === hasta) return NextResponse.json({ error: "locales inválidos" }, { status: 400 });
  const items = (b?.items ?? [])
    .filter((i) => /^[0-9a-f-]{36}$/i.test(i.producto_id) && (!i.variante_id || /^[0-9a-f-]{36}$/i.test(i.variante_id)) && Number(i.cantidad) > 0 && Number(i.cantidad) < 100000)
    .map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), ...(i.variante_id ? { variante_id: i.variante_id } : {}) }));
  if (items.length === 0) return NextResponse.json({ error: "no hay productos" }, { status: 400 });
  const { data, error } = await clienteServidor().rpc("transferir_stock", {
    p_desde: desde, p_hasta: hasta, p_items: items, p_usuario: u.id, p_nota: (b?.nota ?? "").slice(0, 200) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transferidos: data });
}
