// Catálogo completo para la caja (se guarda en la compu para vender sin internet).
import { NextResponse } from "next/server";
import type { ProductoCaja } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
import { clienteUsuario } from "@/lib/supabase/sesion";

export async function GET() {
  const { data: u } = await (await clienteUsuario()).auth.getUser();
  if (!u.user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const db = clienteServidor();
  const productos: ProductoCaja[] = [];
  let version = "";
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("productos")
      .select("id, barcode, sku, nombre, precio_lista, precio_efectivo, categoria, actualizado_en")
      .eq("activo", true).order("id").range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) {
      productos.push([p.id, p.barcode, p.sku, p.nombre, Number(p.precio_lista), Number(p.precio_efectivo), p.categoria]);
      if (p.actualizado_en > version) version = p.actualizado_en;
    }
    if (!data || data.length < 1000) break;
  }
  const { data: locales } = await db.from("locales").select("id, nombre").order("id");
  return NextResponse.json({ version, productos, locales: locales ?? [], usuario: u.user.email });
}
