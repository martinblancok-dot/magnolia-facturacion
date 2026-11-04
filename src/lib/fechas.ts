// Fechas en formato AAAA-MM-DD, siempre en hora de Argentina.
import { DIAS_ATRAS_PERMITIDOS } from "./arca/config";

/** Fecha de hoy (o de un instante dado) en Argentina, como AAAA-MM-DD. */
export function diaArgentina(instante: Date | string = new Date()): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function restarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const mayor = (a: string, b: string) => (a > b ? a : b);

export interface FechaFactura {
  fecha: string;
  /** true si la venta es de un mes anterior: se puede facturar, pero ya está fuera de término. */
  fueraDeTermino: boolean;
}

/**
 * Qué fecha ponerle a la factura de un cobro:
 * - la fecha real del cobro, si no tiene más de 5 días;
 * - si es más vieja, la más antigua permitida (hoy - 5);
 * - nunca anterior a la última factura ya emitida en ese punto de venta.
 */
export function fechaParaFactura(diaCobro: string, hoy: string, ultimaFechaEmitida?: string): FechaFactura {
  let fecha = mayor(diaCobro, restarDias(hoy, DIAS_ATRAS_PERMITIDOS));
  if (ultimaFechaEmitida) fecha = mayor(fecha, ultimaFechaEmitida);
  if (fecha > hoy) fecha = hoy;
  return { fecha, fueraDeTermino: diaCobro.slice(0, 7) < hoy.slice(0, 7) };
}
