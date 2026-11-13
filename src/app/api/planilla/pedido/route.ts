// La planilla pregunta cada minuto si desde el sistema se pidió "Actualizar colores desde la planilla".
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { planillaAutorizada } from "@/lib/supabase/planilla";

export async function GET(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const { data } = await db.from("ajustes").select("valor").eq("clave", "planilla_pedido_colores").maybeSingle();
  // Un pedido de hace más de una hora ya no vale
  const pedido = !!data?.valor && Date.now() - Date.parse(data.valor) < 3600_000;
  return NextResponse.json({ colores: pedido });
}
