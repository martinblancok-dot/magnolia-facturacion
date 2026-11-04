// Cruza cobros de Mercado Pago con comprobantes ya emitidos a mano en ARCA,
// para no facturar dos veces la misma venta.
//
// Regla: mismo importe (al centavo) y factura emitida el mismo día del cobro
// o hasta DIAS_DESPUES días después. Cada comprobante se usa una sola vez.
// Si hay varios candidatos, se elige el de fecha más cercana.

export const DIAS_DESPUES = 3;

export interface CobroAConciliar {
  id: string;
  dia: string; // AAAA-MM-DD
  importe: number;
}

export interface ComprobanteAConciliar {
  id: string;
  fecha: string; // AAAA-MM-DD
  importe: number;
}

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);

export function conciliar(cobros: CobroAConciliar[], comprobantes: ComprobanteAConciliar[]): { cobroId: string; comprobanteId: string }[] {
  const libres = new Map(comprobantes.filter((c) => c.importe > 0).map((c) => [c.id, c]));
  const res: { cobroId: string; comprobanteId: string }[] = [];
  for (const cobro of [...cobros].sort((a, b) => a.dia.localeCompare(b.dia))) {
    let mejor: ComprobanteAConciliar | null = null;
    let mejorDist = Infinity;
    for (const c of libres.values()) {
      if (Math.abs(c.importe - cobro.importe) > 0.005) continue;
      const d = dias(cobro.dia, c.fecha);
      if (d < 0 || d > DIAS_DESPUES) continue;
      if (d < mejorDist) { mejor = c; mejorDist = d; }
    }
    if (mejor) {
      libres.delete(mejor.id);
      res.push({ cobroId: cobro.id, comprobanteId: mejor.id });
    }
  }
  return res;
}
