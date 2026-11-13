// Lista de productos (SKU, nombre y colores) para asociar en la compu las fotos de la carga masiva.
import { NextResponse } from "next/server";
import { adminDesbloqueado } from "@/lib/admin";
import type { ProductoIndice } from "@/lib/fotos";
import { clienteServidor } from "@/lib/supabase/almacen";

export async function GET() {
  if (!(await adminDesbloqueado())) return NextResponse.json({ error: "Solo Martín y Sofi pueden cargar fotos." }, { status: 403 });
  const db = clienteServidor();
  const productos: ProductoIndice[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("productos").select("id, sku, barcode, nombre").eq("activo", true).order("id").range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) productos.push({ ...p, sku: p.sku ?? "", colores: [] });
    if (!data || data.length < 1000) break;
  }
  const porId = new Map(productos.map((p) => [p.id, p]));
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("producto_variantes").select("id, producto_id, color, sku_variante").eq("activo", true).order("id").range(i, i + 999);
    if (error) break; // sin la migración 0032 no hay colores
    for (const v of data ?? []) porId.get(v.producto_id)?.colores.push({ id: v.id, color: v.color, sku_variante: v.sku_variante });
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ productos });
}
