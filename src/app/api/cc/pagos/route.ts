// Pago de una clienta de cuenta corriente desde la caja. Solo Martín y Sofi.
import { NextResponse } from "next/server";
import { registrarPagoCC } from "@/lib/supabase/cuentas";
import { clienteServidor } from "@/lib/supabase/almacen";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u || (await perfilDe(u.id)).rol !== "duenio") return NextResponse.json({ error: "Solo Martín y Sofi pueden cobrar cuentas corrientes." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { cliente_id?: string; monto?: number; medio?: string; turno_id?: string | null; nota?: string } | null;
  if (!b?.cliente_id || !/^[0-9a-f-]{36}$/i.test(b.cliente_id)) return NextResponse.json({ error: "Elegí la clienta." }, { status: 400 });
  try {
    return NextResponse.json(await registrarPagoCC(clienteServidor(), { cliente_id: b.cliente_id, monto: Number(b.monto), medio: String(b.medio), turno_id: b.turno_id ?? null, nota: b.nota ?? null, usuario_id: u.id }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
