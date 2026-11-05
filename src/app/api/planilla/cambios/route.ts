// Cambios hechos en el sistema (nombre, costo, categoría, productos nuevos) para escribir en la planilla.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { planillaAutorizada } from "@/lib/supabase/planilla";

export async function GET(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const { data, error } = await db.from("planilla_cambios").select("id, tipo, barcode, hoja, datos")
    .is("aplicado_en", null).is("error", null).order("id").limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cambios: data });
}

/** El script avisa cuáles pudo escribir y cuáles no (con el motivo). */
export async function POST(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { resultados?: { id: number; ok: boolean; error?: string }[] } | null;
  const ahora = new Date().toISOString();
  for (const r of body?.resultados ?? []) {
    await db.from("planilla_cambios").update(r.ok ? { aplicado_en: ahora } : { error: String(r.error || "error").slice(0, 300) }).eq("id", r.id);
  }
  return NextResponse.json({ ok: true });
}
