// Clientas de cuenta corriente con lo que debe cada una (para la caja). Solo Martín y Sofi.
import { NextResponse } from "next/server";
import { clientesCC } from "@/lib/supabase/cuentas";
import { clienteServidor } from "@/lib/supabase/almacen";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET() {
  const u = await usuarioDeLaSesion();
  if (!u || (await perfilDe(u.id)).rol !== "duenio") return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  try {
    const cs = await clientesCC(clienteServidor());
    return NextResponse.json({ clientes: cs.map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, limite: c.limite, debe: c.saldo.debe })) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
