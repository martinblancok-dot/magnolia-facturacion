// Catálogo completo para la caja (se guarda en la compu para vender sin internet).
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { ProductoCaja } from "@/lib/caja";
import type { Promo } from "@/lib/promos";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const db = clienteServidor();
  // Versión = último cambio de cualquier producto (también las bajas). Si la caja ya la tiene, no se manda todo de nuevo.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const [{ data: ultimo }, { data: promosDb }] = await Promise.all([
    db.from("productos").select("actualizado_en").order("actualizado_en", { ascending: false }).limit(1).maybeSingle(),
    db.from("promos").select("id, nombre, tipo, pct, n, m, alcance, valores, mismo_producto, desde, hasta").eq("activa", true).order("orden").order("creada_en"),
  ]);
  // Promos vigentes hoy (si la tabla todavía no existe, no hay promos)
  const promos: Promo[] = (promosDb ?? [])
    .filter((p) => (!p.desde || p.desde <= hoy) && (!p.hasta || p.hasta >= hoy))
    .map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, pct: Number(p.pct), n: p.n, m: p.m, alcance: p.alcance, valores: p.valores ?? [], mismo_producto: p.mismo_producto }));
  // Versión = último cambio de productos + las promos de hoy (si cambia algo, la caja baja todo de nuevo)
  const version = `v2|${ultimo?.actualizado_en ?? ""}|${createHash("md5").update(JSON.stringify(promos)).digest("hex").slice(0, 10)}`;
  const tiene = new URL(req.url).searchParams.get("version");
  if (tiene && version && tiene === version) return NextResponse.json({ sinCambios: true, version });
  const productos: ProductoCaja[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("productos")
      .select("id, barcode, sku, nombre, precio_lista, precio_efectivo, categoria, proveedor, hoja")
      .eq("activo", true).order("id").range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) {
      productos.push([p.id, p.barcode, p.sku, p.nombre, Number(p.precio_lista), Number(p.precio_efectivo), p.categoria, p.hoja ?? p.proveedor ?? null]);
    }
    if (!data || data.length < 1000) break;
  }
  const { data: locales } = await db.from("locales").select("id, nombre").order("id");
  return NextResponse.json({ version, productos, promos, locales: locales ?? [], usuario: u.email });
}
