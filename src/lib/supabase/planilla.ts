// Lado servidor de la sincronización con Precios Deco.
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerHojas } from "../catalogo";
import { compararCatalogo, tokenCorrecto, type ProductoSistema } from "../planilla";

export async function planillaAutorizada(db: SupabaseClient, req: Request): Promise<boolean> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "token_planilla").maybeSingle();
  return tokenCorrecto(req.headers.get("x-magnolia-token"), data?.valor);
}

async function todosLosProductos(db: SupabaseClient): Promise<ProductoSistema[]> {
  const todos: ProductoSistema[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from("productos")
      .select("id, barcode, sku, nombre, categoria, proveedor, costo, precio_lista, precio_efectivo, activo, hoja, baja")
      .order("barcode").range(desde, desde + 999);
    if (error) throw new Error(error.message);
    todos.push(...((data ?? []) as ProductoSistema[]).map((p) => ({
      ...p, costo: p.costo === null ? null : Number(p.costo), precio_lista: Number(p.precio_lista), precio_efectivo: Number(p.precio_efectivo),
    })));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

export interface EstadoPlanilla {
  cuando: string;
  productos: number;
  nuevos: number;
  actualizados: number;
  bajas: number;
  bajasFrenadas: number;
  repetidos: { barcode: string; queda: string; descartado: string }[];
  hojas?: string[];
  error?: string;
}

export async function guardarEstado(db: SupabaseClient, e: EstadoPlanilla) {
  await db.from("ajustes").upsert({ clave: "planilla_estado", valor: JSON.stringify(e), actualizado_en: new Date().toISOString() });
}

export async function leerEstado(db: SupabaseClient): Promise<EstadoPlanilla | null> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "planilla_estado").maybeSingle();
  try { return data ? (JSON.parse(data.valor) as EstadoPlanilla) : null; } catch { return null; }
}

/** Trae la planilla al sistema: productos nuevos, cambios de precio/nombre y bajas. */
export async function sincronizarDesdePlanilla(db: SupabaseClient, hojas: { sheet: string; data: unknown[][] }[]): Promise<EstadoPlanilla> {
  const leidas = leerHojas(hojas);
  if (leidas.productos.length === 0) throw new Error("No llegó ningún producto de la planilla.");
  const [actuales, { data: pend }] = await Promise.all([
    todosLosProductos(db),
    db.from("planilla_cambios").select("barcode").eq("tipo", "editar").is("aplicado_en", null).is("error", null),
  ]);
  const pendientes = new Set((pend ?? []).map((x) => x.barcode as string));
  const c = compararCatalogo(actuales, leidas.productos, pendientes);
  const ahora = new Date().toISOString();

  for (let i = 0; i < c.nuevos.length; i += 500) {
    const filas = c.nuevos.slice(i, i + 500).map((p) => ({
      barcode: p.barcode, sku: p.sku, nombre: p.nombre, categoria: p.categoria, proveedor: p.proveedor, costo: p.costo,
      precio_lista: p.precio_lista, precio_efectivo: p.precio_efectivo, hoja: p.hoja, activo: true, baja: null, actualizado_en: ahora,
    }));
    const { error } = await db.from("productos").insert(filas);
    if (error) throw new Error(error.message);
  }
  const porId = new Map(actuales.map((p) => [p.id, p]));
  for (let i = 0; i < c.cambios.length; i += 500) {
    const filas = c.cambios.slice(i, i + 500).map(({ id, datos }) => ({ ...porId.get(id)!, ...datos, actualizado_en: ahora }));
    const { error } = await db.from("productos").upsert(filas, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < c.bajas.length; i += 300) {
    const { error } = await db.from("productos").update({ activo: false, baja: "planilla", actualizado_en: ahora }).in("id", c.bajas.slice(i, i + 300));
    if (error) throw new Error(error.message);
  }
  const estado: EstadoPlanilla = {
    cuando: ahora, productos: leidas.productos.length, nuevos: c.nuevos.length, actualizados: c.cambios.length,
    bajas: c.bajas.length, bajasFrenadas: c.bajasFrenadas, repetidos: leidas.conflictos.slice(0, 50), hojas: leidas.hojas,
  };
  await guardarEstado(db, estado);
  return estado;
}
