// La caja marca un pedido online como preparado (sus productos de este local) o entregado.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";
import { marcarEntregado, marcarPreparado } from "@/lib/tiendanube-pedidos";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { id?: number; local_id?: number; accion?: string } | null;
  const id = Number(b?.id), local = Number(b?.local_id);
  if (!id || ![1, 2].includes(local)) return NextResponse.json({ error: "datos inválidos" }, { status: 400 });
  const db = clienteServidor();
  try {
    if (b?.accion === "preparado") return NextResponse.json(await marcarPreparado(db, id, local, u.id));
    if (b?.accion === "entregado") return NextResponse.json({ ok: await marcarEntregado(db, id, u.id) });
    return NextResponse.json({ error: "acción inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
