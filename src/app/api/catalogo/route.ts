// Catálogo completo para la caja (se guarda en la compu para vender sin internet).
import { NextResponse } from "next/server";
import type { ProductoCaja } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const db = clienteServidor();
  // Versión = último cambio de cualquier producto (también las bajas). Si la caja ya la tiene, no se manda todo de nuevo.
  const { data: ultimo } = await db.from("productos").select("actualizado_en").order("actualizado_en", { ascending: false }).limit(1).maybeSingle();
  const version = String(ultimo?.actualizado_en ?? "");
  const tiene = new URL(req.url).searchParams.get("version");
  if (tiene && version && tiene === version) return NextResponse.json({ sinCambios: true, version });
  const productos: ProductoCaja[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("productos")
      .select("id, barcode, sku, nombre, precio_lista, precio_efectivo, categoria")
      .eq("activo", true).order("id").range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) {
      productos.push([p.id, p.barcode, p.sku, p.nombre, Number(p.precio_lista), Number(p.precio_efectivo), p.categoria]);
    }
    if (!data || data.length < 1000) break;
  }
  const { data: locales } = await db.from("locales").select("id, nombre").order("id");
  return NextResponse.json({ version, productos, locales: locales ?? [], usuario: u.email });
}
