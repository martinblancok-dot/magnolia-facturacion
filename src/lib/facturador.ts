// El corazón del sistema: toma los cobros "a facturar" de una persona
// y pide a ARCA una Factura C por cada uno, en orden de fecha.
import type { Ambiente } from "./arca/config";
import type { Ticket } from "./arca/wsaa";
import type { Credenciales, PedidoFactura, ResultadoFactura } from "./arca/wsfe";
import { diaArgentina, fechaParaFactura } from "./fechas";

export interface Emisor {
  usuarioId: string;
  cuit: string;
  puntoVenta: number;
  ambiente: Ambiente;
  certificadoPem: string;
  clavePem: string;
}

export interface CobroPendiente {
  id: string;
  dia: string;
  importe: number;
}

/** Dónde se guardan las cosas (Supabase en la app, un falso en los tests). */
export interface Almacen {
  ticketGuardado(usuarioId: string, ambiente: Ambiente): Promise<Ticket | null>;
  guardarTicket(usuarioId: string, ambiente: Ambiente, t: Ticket): Promise<void>;
  cobrosAFacturar(usuarioId: string): Promise<CobroPendiente[]>; // ordenados del más viejo al más nuevo
  ultimaFechaEmitida(usuarioId: string, puntoVenta: number, ambiente: Ambiente): Promise<string | null>;
  marcarEnviando(cobroId: string): Promise<void>;
  guardarFactura(
    cobroId: string,
    f: { puntoVenta: number; numero: number; fecha: string; importe: number; cae: string; caeVence: string; ambiente: Ambiente; fueraDeTermino: boolean },
  ): Promise<void>;
  marcarError(cobroId: string, mensaje: string, reintentable: boolean): Promise<void>;
}

/** Las llamadas a ARCA (las reales o unas falsas en los tests). */
export interface ServicioARCA {
  pedirTicket(ambiente: Ambiente, certificadoPem: string, clavePem: string): Promise<Ticket>;
  ultimoNumero(c: Credenciales, puntoVenta: number): Promise<number>;
  solicitarCAE(c: Credenciales, p: PedidoFactura): Promise<ResultadoFactura>;
}

export interface Resumen {
  emitidas: number;
  rechazadas: number;
  errores: string[];
}

async function obtenerTicket(e: Emisor, almacen: Almacen, arca: ServicioARCA, ahora: Date): Promise<Ticket> {
  const guardado = await almacen.ticketGuardado(e.usuarioId, e.ambiente);
  // Reusar si le quedan más de 10 minutos (ARCA no deja pedir otro mientras siga vigente)
  if (guardado && new Date(guardado.vence).getTime() - ahora.getTime() > 10 * 60_000) return guardado;
  const nuevo = await arca.pedirTicket(e.ambiente, e.certificadoPem, e.clavePem);
  await almacen.guardarTicket(e.usuarioId, e.ambiente, nuevo);
  return nuevo;
}

export async function facturarPendientes(
  e: Emisor,
  almacen: Almacen,
  arca: ServicioARCA,
  ahora = new Date(),
): Promise<Resumen> {
  const resumen: Resumen = { emitidas: 0, rechazadas: 0, errores: [] };
  const cobros = await almacen.cobrosAFacturar(e.usuarioId);
  if (cobros.length === 0) return resumen;

  const ticket = await obtenerTicket(e, almacen, arca, ahora);
  const cred: Credenciales = { ambiente: e.ambiente, cuit: e.cuit, token: ticket.token, sign: ticket.sign };
  const hoy = diaArgentina(ahora);

  // ARCA es la fuente de verdad para la numeración
  let ultimo = await arca.ultimoNumero(cred, e.puntoVenta);
  let ultimaFecha = (await almacen.ultimaFechaEmitida(e.usuarioId, e.puntoVenta, e.ambiente)) ?? undefined;

  for (const cobro of cobros) {
    const { fecha, fueraDeTermino } = fechaParaFactura(cobro.dia, hoy, ultimaFecha);
    const numero = ultimo + 1;
    await almacen.marcarEnviando(cobro.id);
    let res: ResultadoFactura;
    try {
      res = await arca.solicitarCAE(cred, { puntoVenta: e.puntoVenta, numero, fecha, importe: cobro.importe });
    } catch (err) {
      // No sabemos si ARCA llegó a aprobarla: se deja para revisar a mano y se corta la tanda.
      const msg = `Sin respuesta clara de ARCA: ${(err as Error).message}`;
      await almacen.marcarError(cobro.id, msg, false);
      resumen.errores.push(msg);
      break;
    }
    if (res.aprobada && res.cae && res.caeVence) {
      await almacen.guardarFactura(cobro.id, {
        puntoVenta: e.puntoVenta, numero, fecha, importe: cobro.importe,
        cae: res.cae, caeVence: res.caeVence, ambiente: e.ambiente, fueraDeTermino,
      });
      ultimo = numero;
      ultimaFecha = fecha;
      resumen.emitidas++;
    } else {
      const msg = res.mensajes.join("; ") || "Rechazada sin detalle";
      await almacen.marcarError(cobro.id, msg, true);
      resumen.rechazadas++;
      resumen.errores.push(msg);
    }
  }
  return resumen;
}
