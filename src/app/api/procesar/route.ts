export const maxDuration = 120;
// Tarea automática: cada 10-15 minutos Supabase llama a esta dirección.
// 1) Trae los cobros nuevos de Mercado Pago de cada persona.
// 2) Si la persona tiene prendida la facturación automática, factura los pendientes.
import { NextResponse } from "next/server";
import { pedirTicket } from "@/lib/arca/wsaa";
import { solicitarCAE, ultimoNumero } from "@/lib/arca/wsfe";
import { facturarPendientes } from "@/lib/facturador";
import { traerCobros } from "@/lib/mercadopago";
import { leerCredencialesTN } from "@/lib/tiendanube";
import { sincronizarTienda } from "@/lib/tiendanube-sync";
import { confirmarTransferenciasConCaja } from "@/lib/supabase/turnos";
import { almacenSupabase, clienteServidor, conciliarUsuario, guardarCobros, traerEmisores } from "@/lib/supabase/almacen";

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

  const emisores = await traerEmisores(db);
  // 1) Cobros nuevos de las dos cuentas
  const nuevos: Record<string, number | string> = {};
  for (const e of emisores) {
    if (!e.mpToken) continue;
    try { nuevos[e.nombre] = await guardarCobros(db, e.usuarioId, await traerCobros(e.mpToken, desde, ahora.toISOString())); }
    catch (err) { nuevos[e.nombre] = (err as Error).message; }
  }
  // 2) Transferencias que coinciden con una venta de la caja → son venta (pasan a "Por facturar")
  try { informe.transferenciasConfirmadasPorCaja = await confirmarTransferenciasConCaja(db, desde); } catch (err) { informe.errorCruceCaja = (err as Error).message; }
  // 3) Por cada persona: conciliar con facturas hechas a mano y facturar
  for (const e of emisores) {
    const r: Record<string, unknown> = { cobrosNuevos: nuevos[e.nombre] };
    try {
      r.yaFacturados = await conciliarUsuario(db, e.usuarioId, e.puntoVenta);
      if (e.facturarAutomatico) r.facturas = await facturarPendientes(e, almacen, arca, ahora);
    } catch (err) {
      r.error = (err as Error).message;
    }
    informe[e.nombre] = r;
  }
  // 4) Tienda online: precios y stock al día (con el tiempo que quede)
  try {
    const cred = await leerCredencialesTN(db);
    const resta = 105_000 - (Date.now() - ahora.getTime());
    if (cred && resta > 10_000) informe.tiendaOnline = await sincronizarTienda(db, cred, { hastaMs: resta });
  } catch (err) { informe.errorTiendaOnline = (err as Error).message; }
  return NextResponse.json(informe);
}
