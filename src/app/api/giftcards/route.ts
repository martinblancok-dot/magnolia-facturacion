// Busca una gift card por su código (para cobrar con ella en la caja).
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  // Búsqueda por nombre de quien la recibió (si se olvidó la tarjeta)
  const nombre = (sp.get("nombre") ?? "").trim();
  if (nombre) {
    if (nombre.length < 3) return NextResponse.json({ error: "Escribí al menos 3 letras del nombre." }, { status: 400 });
    const patron = `%${nombre.replace(/[%_\\,()]/g, " ").replace(/\s+/g, "%")}%`;
    const { data, error } = await clienteServidor().from("giftcards").select("id, codigo, monto, saldo, medio_origen, destinatario, creada_en")
      .ilike("destinatario", patron).eq("anulada", false).gt("saldo", 0).order("creada_en", { ascending: false }).limit(15);
    if (error) return NextResponse.json({ error: /destinatario/.test(error.message) ? "Falta correr la migración 0018_giftcard_destinatario.sql en Supabase." : error.message }, { status: 500 });
    return NextResponse.json({ resultados: (data ?? []).map((g) => ({ ...g, saldo: Number(g.saldo), monto: Number(g.monto) })) });
  }
  const codigo = (sp.get("codigo") ?? "").trim().toUpperCase().replace(/^GC/, "").replace(/[^0-9A-F]/g, "");
  if (codigo.length !== 8) return NextResponse.json({ error: "El código de la gift card tiene 8 letras y números." }, { status: 400 });
  const { data, error } = await clienteServidor().from("giftcards").select("*").eq("codigo", codigo).maybeSingle();
  if (error) return NextResponse.json({ error: /giftcards/.test(error.message) ? "Falta correr la migración 0011_giftcards.sql en Supabase." : error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No encontré la gift card ${codigo}. Si se vendió hace un rato sin internet, esperá a que esa caja suba sus ventas.` }, { status: 404 });
  if (data.anulada) return NextResponse.json({ error: `La gift card ${codigo} está anulada.` }, { status: 409 });
  if (Number(data.saldo) <= 0) return NextResponse.json({ error: `La gift card ${codigo} ya no tiene saldo.` }, { status: 409 });
  return NextResponse.json({ ...data, saldo: Number(data.saldo), monto: Number(data.monto) });
}
