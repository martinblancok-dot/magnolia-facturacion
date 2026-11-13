// Últimas cargas de mercadería (para imprimir sus etiquetas).
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET() {
  if (!(await usuarioDeLaSesion())) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const { data, error } = await clienteServidor().from("stock_movimientos")
    .select("producto_id, local_id, cantidad, nota, creado_en").eq("tipo", "ingreso").gt("cantidad", 0)
    .order("creado_en", { ascending: false }).limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Agrupa por carga: mismo local, misma nota y mismo minuto
  const cargas = new Map<string, { clave: string; local_id: number; nota: string | null; creado_en: string; items: { producto_id: string; cantidad: number }[] }>();
  for (const m of data ?? []) {
    const clave = `${m.local_id}|${m.nota ?? ""}|${m.creado_en.slice(0, 16)}`;
    if (!cargas.has(clave)) { if (cargas.size >= 15) continue; cargas.set(clave, { clave, local_id: m.local_id, nota: m.nota, creado_en: m.creado_en, items: [] }); }
    // Un producto con colores tiene un movimiento por color: la etiqueta es una sola por producto
    const items = cargas.get(clave)!.items;
    const ya = items.find((i) => i.producto_id === m.producto_id);
    if (ya) ya.cantidad += Number(m.cantidad); else items.push({ producto_id: m.producto_id, cantidad: Number(m.cantidad) });
  }
  return NextResponse.json({ cargas: [...cargas.values()] });
}
