// Totales de facturación por mes y por período de recategorización del monotributo.
// La recategorización es en enero y julio, y mira los 12 meses anteriores:
//   enero AAAA → enero a diciembre de AAAA-1
//   julio AAAA → julio de AAAA-1 a junio de AAAA

export interface Movimiento {
  fecha: string; // AAAA-MM-DD
  importe: number;
}

export interface PeriodoRecat {
  nombre: string; // "Enero 2027"
  desde: string; // AAAA-MM
  hasta: string; // AAAA-MM
  total: number;
  cantidad: number;
  enCurso: boolean; // todavía no terminó el período
  mesesConDatos: number;
}

export const mesSiguiente = (m: string, n = 1) => {
  const [a, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(a, mm - 1 + n, 1)).toISOString().slice(0, 7);
};

export function totalesPorMes(movs: Movimiento[]): Map<string, { total: number; cantidad: number }> {
  const r = new Map<string, { total: number; cantidad: number }>();
  for (const m of movs) {
    const k = m.fecha.slice(0, 7);
    const x = r.get(k) ?? { total: 0, cantidad: 0 };
    x.total += m.importe;
    x.cantidad++;
    r.set(k, x);
  }
  return r;
}

/** Períodos de recategorización desde el primer dato hasta el próximo (incluido). */
export function periodosRecategorizacion(movs: Movimiento[], hoy: string): PeriodoRecat[] {
  if (movs.length === 0) return [];
  const meses = totalesPorMes(movs);
  const primero = [...meses.keys()].sort()[0];
  const mesHoy = hoy.slice(0, 7);
  const res: PeriodoRecat[] = [];

  // Recorremos fechas de recategorización (enero y julio) desde el primer dato
  let [a, m] = primero.split("-").map(Number);
  // primera recategorización cuyo período incluye el primer mes con datos
  let recat = m <= 6 ? `${a}-07` : `${a + 1}-01`;
  const ultimoRecat = Number(mesHoy.slice(5)) <= 6 ? `${mesHoy.slice(0, 4)}-07` : `${Number(mesHoy.slice(0, 4)) + 1}-01`;
  while (recat <= ultimoRecat) {
    const hasta = mesSiguiente(recat, -1);
    const desde = mesSiguiente(recat, -12);
    let total = 0, cantidad = 0, mesesConDatos = 0;
    for (let k = desde; k <= hasta; k = mesSiguiente(k)) {
      const x = meses.get(k);
      if (x) { total += x.total; cantidad += x.cantidad; mesesConDatos++; }
    }
    [a, m] = recat.split("-").map(Number);
    res.push({
      nombre: `${m === 1 ? "Enero" : "Julio"} ${a}`,
      desde, hasta, total: Math.round(total * 100) / 100, cantidad,
      enCurso: hasta >= mesHoy, mesesConDatos,
    });
    recat = mesSiguiente(recat, 6);
  }
  return res.reverse(); // la más nueva primero
}

/** Total de los últimos 12 meses corridos (incluido el actual). */
export function ultimos12(movs: Movimiento[], hoy: string): number {
  const desde = mesSiguiente(hoy.slice(0, 7), -11);
  return Math.round(movs.filter((m) => m.fecha.slice(0, 7) >= desde).reduce((s, m) => s + m.importe, 0) * 100) / 100;
}
