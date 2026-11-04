// Tarea automática: cada 10-15 minutos Supabase llama a esta dirección.
// 1) Trae los cobros nuevos de Mercado Pago de cada persona.
// 2) Si la persona tiene prendida la facturación automática, factura los pendientes.
import { NextResponse } from "next/server";
import { pedirTicket } from "@/lib/arca/wsaa";
import { solicitarCAE, ultimoNumero } from "@/lib/arca/wsfe";
import { facturarPendientes } from "@/lib/facturador";
import { traerCobros } from "@/lib/mercadopago";
import { almacenSupabase, clienteServidor, guardarCobros, traerEmisores } from "@/lib/supabase/almacen";

const arca = { pedirTicket, ultimoNumero, solicitarCAE };

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const db = clienteServidor();
  const almacen = almacenSupabase(db);
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 3 * 24 * 3600_000).toISOString(); // revisa los últimos 3 días
  const informe: Record<string, unknown> = {};

  for (const e of await traerEmisores(db)) {
    const r: Record<string, unknown> = {};
    try {
      if (e.mpToken) r.cobrosNuevos = await guardarCobros(db, e.usuarioId, await traerCobros(e.mpToken, desde, ahora.toISOString()));
      if (e.facturarAutomatico) r.facturas = await facturarPendientes(e, almacen, arca, ahora);
    } catch (err) {
      r.error = (err as Error).message;
    }
    informe[e.nombre] = r;
  }
  return NextResponse.json(informe);
}
