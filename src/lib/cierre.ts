// Cuentas del cierre de caja y cruce de pagos con Mercado Pago (funciones puras, se prueban solas).
import { MEDIOS, partesPago, type MedioPago } from "./caja";

export const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100] as const;

export function totalBilletes(billetes: Record<string, number>, monedas = 0): number {
  let t = monedas || 0;
  for (const d of DENOMINACIONES) t += d * (Number(billetes[String(d)]) || 0);
  return Math.round(t * 100) / 100;
}

export interface VentaTurno {
  id: string;
  numero?: number;
  creada_en: string;
  medio_pago: MedioPago;
  total: number;
  anulada?: boolean;
  pagos?: { medio: string; monto: number }[] | null; // pago dividido en dos medios
}

export interface MovimientoCaja {
  tipo: "retiro" | "gasto" | "ingreso";
  monto: number;
}

export function resumenTurno(fondo: number, ventas: VentaTurno[], movimientos: MovimientoCaja[]) {
  const validas = ventas.filter((v) => !v.anulada);
  const porMedio = Object.fromEntries(MEDIOS.map((m) => [m.id, { total: 0, cantidad: 0 }])) as Record<MedioPago, { total: number; cantidad: number }>;
  for (const v of validas) {
    for (const p of partesPago(v)) {
      if (!porMedio[p.medio]) continue;
      porMedio[p.medio].total += p.monto;
      porMedio[p.medio].cantidad++;
    }
  }
  const suma = (t: MovimientoCaja["tipo"]) => movimientos.filter((m) => m.tipo === t).reduce((s, m) => s + Number(m.monto), 0);
  const total = validas.reduce((s, v) => s + Number(v.total), 0);
  const efectivoEsperado = fondo + porMedio.efectivo.total + suma("ingreso") - suma("retiro") - suma("gasto");
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    porMedio,
    total: r(total),
    cantidad: validas.length,
    anuladas: ventas.length - validas.length,
    ticketPromedio: validas.length ? r(total / validas.length) : 0,
    retiros: r(suma("retiro")),
    gastos: r(suma("gasto")),
    ingresos: r(suma("ingreso")),
    efectivoEsperado: r(efectivoEsperado),
  };
}

// ---------- Cruce con Mercado Pago ----------

export interface CobroMP {
  id: string;
  fecha_hora: string;
  importe: number;
  origen: "posnet" | "qr" | "transferencia" | "otro";
}

/** Qué tipo de cobro de Mercado Pago corresponde a cada medio de pago de la caja. */
export const ORIGEN_ESPERADO: Partial<Record<MedioPago, CobroMP["origen"][]>> = {
  transferencia: ["transferencia", "otro"],
  debito: ["posnet", "qr"],
  credito: ["posnet", "qr"],
  cuotas: ["posnet", "qr"],
  qr: ["qr", "posnet"],
};

export const MINUTOS_ANTES = 60; // la transferencia puede llegar antes de cargar la venta
export const MINUTOS_DESPUES = 90;
export const TOLERANCIA_PESOS = 1;

export interface ResultadoCruce {
  encontrados: { ventaId: string; cobroId: string; minutos: number }[];
  ventasSinCobro: VentaTurno[]; // se anotaron en la caja pero no entraron a Mercado Pago
  cobrosSinVenta: CobroMP[]; // entraron a Mercado Pago pero no están en la caja
}

/**
 * Cruza las ventas no-efectivo del turno con los cobros de Mercado Pago:
 * mismo importe (±$1), tipo de cobro compatible y hora cercana. Cada cobro se usa una vez;
 * si hay varios candidatos se toma el de hora más cercana.
 */
export function cruzarPagos(ventas: VentaTurno[], cobros: CobroMP[]): ResultadoCruce {
  // Con pago dividido se cruza solo la parte que no es efectivo
  const aCruzar = ventas.filter((v) => !v.anulada).flatMap((v) =>
    partesPago(v).filter((p) => ORIGEN_ESPERADO[p.medio]).map((p) => ({ ...v, medio_pago: p.medio, total: p.monto })));
  const libres = new Map(cobros.map((c) => [c.id, c]));
  const encontrados: ResultadoCruce["encontrados"] = [];
  const ventasSinCobro: VentaTurno[] = [];

  for (const v of [...aCruzar].sort((a, b) => a.creada_en.localeCompare(b.creada_en))) {
    const tv = Date.parse(v.creada_en);
    let mejor: CobroMP | null = null;
    let mejorDist = Infinity;
    for (const c of libres.values()) {
      if (!ORIGEN_ESPERADO[v.medio_pago]!.includes(c.origen)) continue;
      if (Math.abs(Number(c.importe) - Number(v.total)) > TOLERANCIA_PESOS) continue;
      const min = (Date.parse(c.fecha_hora) - tv) / 60_000;
      if (min < -MINUTOS_ANTES || min > MINUTOS_DESPUES) continue;
      if (Math.abs(min) < mejorDist) { mejor = c; mejorDist = Math.abs(min); }
    }
    if (mejor) {
      libres.delete(mejor.id);
      encontrados.push({ ventaId: v.id, cobroId: mejor.id, minutos: Math.round((Date.parse(mejor.fecha_hora) - tv) / 60_000) });
    } else {
      ventasSinCobro.push(v);
    }
  }
  return { encontrados, ventasSinCobro, cobrosSinVenta: [...libres.values()] };
}
