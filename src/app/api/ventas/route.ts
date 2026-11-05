// Recibe las ventas que la caja tenía guardadas. Si una ya estaba, no se duplica.
import { NextResponse } from "next/server";
import { validarVenta } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ventas?: unknown[] } | null;
  const ventas = Array.isArray(body?.ventas) ? body!.ventas.slice(0, 200) : [];
  const db = clienteServidor();
  const recibidas: string[] = [];
  const rechazadas: { id: string; motivo: string }[] = [];
  for (const v of ventas) {
    const id = String((v as { id?: string })?.id ?? "");
    const error = validarVenta(v);
    if (error) { rechazadas.push({ id, motivo: error }); continue; }
    const r = await db.rpc("registrar_venta", { v, usuario: u.id });
    if (r.error) rechazadas.push({ id, motivo: r.error.message });
    else recibidas.push(id); // nueva o ya registrada: en ambos casos la caja la puede borrar
  }
  return NextResponse.json({ recibidas, rechazadas });
}
