// Copia de seguridad semanal: el script de Precios Deco pide tabla por tabla (de a páginas)
// y al terminar avisa cómo salió. Usa la misma clave que la planilla.
import { NextResponse } from "next/server";
import { FILAS_POR_PAGINA, TABLAS_RESPALDO } from "@/lib/respaldo";
import { clienteServidor } from "@/lib/supabase/almacen";
import { planillaAutorizada } from "@/lib/supabase/planilla";

export const maxDuration = 60;

export async function GET(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave incorrecta." }, { status: 401 });
  const u = new URL(req.url);
  const tabla = u.searchParams.get("tabla");
  if (!tabla) return NextResponse.json({ tablas: Object.keys(TABLAS_RESPALDO), porPagina: FILAS_POR_PAGINA });
  const orden = TABLAS_RESPALDO[tabla];
  if (!orden) return NextResponse.json({ error: "Tabla desconocida." }, { status: 400 });
  const pagina = Math.max(0, Number(u.searchParams.get("pagina")) || 0);
  let q = db.from(tabla).select("*");
  for (const c of orden) q = q.order(c);
  const { data, error } = await q.range(pagina * FILAS_POR_PAGINA, (pagina + 1) * FILAS_POR_PAGINA - 1);
  if (error) {
    // Tabla que todavía no existe (migración sin correr): se saltea
    if (/does not exist|Could not find the table/.test(error.message)) return NextResponse.json({ filas: [], mas: false, falta: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ filas: data ?? [], mas: (data ?? []).length === FILAS_POR_PAGINA });
}

/** El script avisa que terminó (para mostrarlo en Configuración y avisar si hace mucho que no hay copia). */
export async function POST(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave incorrecta." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { archivo?: string; filas?: number; error?: string } | null;
  const valor = JSON.stringify({ cuando: new Date().toISOString(), archivo: String(b?.archivo ?? "").slice(0, 200), filas: Number(b?.filas) || 0, error: b?.error ? String(b.error).slice(0, 300) : null });
  await db.from("ajustes").upsert({ clave: "respaldo_ultimo", valor, actualizado_en: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
