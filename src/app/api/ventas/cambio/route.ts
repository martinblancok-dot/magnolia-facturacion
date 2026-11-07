// Busca una venta por el código del ticket para hacer un cambio o una devolución.
import { NextResponse } from "next/server";
import { DIAS_CAMBIO, rangoCodigo, venceCambio } from "@/lib/impresion";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const texto = new URL(req.url).searchParams.get("codigo") ?? "";
  const rango = rangoCodigo(texto);
  if (!rango) return NextResponse.json({ error: "El código del ticket tiene 8 letras y números (está abajo del código de barras)." }, { status: 400 });
  const db = clienteServidor();
  const { data: ventas, error } = await db.from("ventas")
    .select("id, local_id, creada_en, medio_pago, total, anulada, terminal, giftcard_id, giftcard_monto, cambio_de, venta_items(n, producto_id, barcode, sku, nombre, cantidad, precio_unitario, total)")
    .gte("id", rango[0]).lte("id", rango[1]).limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const v = ventas?.[0];
  if (!v) return NextResponse.json({ error: `No encontré ninguna venta con el código ${texto.trim().toUpperCase()}.` }, { status: 404 });
  if (v.anulada) return NextResponse.json({ error: "Esa venta está anulada." }, { status: 409 });
  if (String(v.terminal ?? "").startsWith("Aronium")) return NextResponse.json({ error: "Es una venta vieja de Aronium: el cambio se hace cargando la devolución a mano." }, { status: 409 });

  // Lo que ya se devolvió en cambios anteriores de esta venta
  const { data: cambios } = await db.from("ventas").select("id, venta_items(producto_id, nombre, cantidad)").eq("cambio_de", v.id).eq("anulada", false);
  const devuelto = (pid: string | null, nombre: string) => (cambios ?? []).flatMap((c) => c.venta_items as { producto_id: string | null; nombre: string; cantidad: number }[])
    .filter((x) => Number(x.cantidad) < 0 && (pid ? x.producto_id === pid : !x.producto_id && x.nombre === `Devolución: ${nombre}`))
    .reduce((s, x) => s - Number(x.cantidad), 0);

  // Precio de lo nuevo: el del medio con que se pagó (si fue con gift card, el de la gift card)
  let medio = v.medio_pago as string;
  if (medio === "giftcard" || (medio !== "cambio" && Number(v.giftcard_monto) > 0 && Number(v.total) === 0)) {
    const { data: g } = v.giftcard_id ? await db.from("giftcards").select("medio_origen").eq("id", v.giftcard_id).maybeSingle() : { data: null };
    medio = g?.medio_origen ?? "cuotas";
  }
  if (medio === "cambio" || medio === "qr") medio = "cuotas";

  type Item = { n: number; producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio_unitario: number };
  // Si la venta tuvo promos o descuentos, lo devuelto se acredita a lo que realmente pagó (proporcional)
  const todos = v.venta_items as (Item & { total: number })[];
  const productos = todos.filter((i) => Number(i.cantidad) > 0 && Number(i.precio_unitario) > 0 && !i.nombre.startsWith("Gift card "));
  const bruto = productos.reduce((s, i) => s + Number(i.total), 0);
  const descuentos = todos.filter((i) => !i.producto_id && Number(i.total) < 0 && Number(i.cantidad) > 0).reduce((s, i) => s + Number(i.total), 0);
  const factor = bruto > 0 ? Math.max(0, Math.min(1, (bruto + descuentos) / bruto)) : 1;
  const items = (v.venta_items as Item[])
    .filter((i) => Number(i.cantidad) > 0 && Number(i.precio_unitario) > 0 && !i.nombre.startsWith("Gift card "))
    .sort((a, b) => a.n - b.n)
    .map((i) => {
      const ya = devuelto(i.producto_id, i.nombre);
      return { ...i, cantidad: Number(i.cantidad), precio_unitario: Math.round(Number(i.precio_unitario) * factor), devuelto: ya, puede: Math.max(Number(i.cantidad) - ya, 0) };
    });
  const vence = venceCambio(v.creada_en);
  return NextResponse.json({
    id: v.id, local_id: v.local_id, creada_en: v.creada_en, medio_pago: v.medio_pago, medio_precio: medio,
    vence: vence.toISOString(), enPlazo: Date.now() <= vence.getTime(), dias: DIAS_CAMBIO, items,
  });
}
