// El script de la planilla manda todas las pestañas de proveedores; acá se actualiza el catálogo.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { guardarEstado, planillaAutorizada, sincronizarDesdePlanilla } from "@/lib/supabase/planilla";

export const maxDuration = 60;

export async function POST(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { hojas?: { sheet: string; data: unknown[][] }[] } | null;
  if (!Array.isArray(body?.hojas)) return NextResponse.json({ error: "Faltan las pestañas." }, { status: 400 });
  try {
    return NextResponse.json(await sincronizarDesdePlanilla(db, body!.hojas));
  } catch (e) {
    const error = (e as Error).message;
    await guardarEstado(db, { cuando: new Date().toISOString(), productos: 0, nuevos: 0, actualizados: 0, bajas: 0, bajasFrenadas: 0, repetidos: [], error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
