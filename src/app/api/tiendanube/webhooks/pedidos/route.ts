// Aviso inmediato de Tiendanube cuando entra o cambia un pedido.
// Se verifica la firma, se trae el pedido completo desde la API y se guarda.
// Si algo falla igual se responde OK: la tarea automática lo vuelve a revisar en unos minutos.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { configTN, leerCredencialesTN } from "@/lib/tiendanube";
import { procesarPedidoTN } from "@/lib/tiendanube-pedidos";

export const maxDuration = 30;

export async function POST(req: Request) {
  const cuerpo = await req.text();
  const { secreto } = configTN();
  if (!secreto) return NextResponse.json({ error: "falta configurar la app" }, { status: 503 });
  const firma = req.headers.get("x-linkedstore-hmac-sha256") ?? "";
  const esperada = createHmac("sha256", secreto).update(cuerpo).digest("hex");
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "firma inválida" }, { status: 401 });

  let aviso: { store_id?: number | string; event?: string; id?: number | string } = {};
  try { aviso = JSON.parse(cuerpo); } catch {}
  const id = Number(aviso.id);
  if (!id || !String(aviso.event ?? "").startsWith("order/")) return NextResponse.json({ ok: true, ignorado: true });

  const db = clienteServidor();
  const cred = await leerCredencialesTN(db);
  if (!cred || Number(aviso.store_id) !== cred.tienda) return NextResponse.json({ ok: true, ignorado: true });
  try {
    const r = await procesarPedidoTN(db, cred, id);
    return NextResponse.json({ ok: true, resultado: r });
  } catch (e) {
    console.error(`Pedido online ${id}:`, (e as Error).message);
    return NextResponse.json({ ok: true, pendiente: true });
  }
}
