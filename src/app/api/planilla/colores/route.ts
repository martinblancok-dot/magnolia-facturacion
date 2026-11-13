// "Actualizar colores ahora" (menú de la planilla): lee la columna Colores de todas las pestañas
// de proveedores y crea, reactiva o desactiva los colores. No toca precios ni productos.
import { NextResponse } from "next/server";
import { leerHojas } from "@/lib/catalogo";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerEstado, guardarEstado, planillaAutorizada, sincronizarColores } from "@/lib/supabase/planilla";

export const maxDuration = 60;

export async function POST(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { hojas?: { sheet: string; data: unknown[][] }[] } | null;
  if (!Array.isArray(body?.hojas)) return NextResponse.json({ error: "Faltan las pestañas." }, { status: 400 });
  try {
    const leidas = leerHojas(body!.hojas);
    const colores = await sincronizarColores(db, leidas.productos);
    if (!colores) return NextResponse.json({ error: "Ninguna pestaña de proveedor tiene la columna \"Colores\" en la fila 1." }, { status: 400 });
    // Queda en el estado de la planilla (se ve en Configuración → Precios Deco) y se apaga el pedido del botón
    const estado = await leerEstado(db);
    if (estado) await guardarEstado(db, { ...estado, colores: { ...colores, cuando: new Date().toISOString() } });
    await db.from("ajustes").delete().eq("clave", "planilla_pedido_colores");
    return NextResponse.json({ ...colores, hojas: leidas.hojas.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
