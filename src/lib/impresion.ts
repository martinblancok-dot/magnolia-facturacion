// Datos para imprimir el recibo X y el ticket de cambio.
export const DIAS_CAMBIO = 15;

export const DATOS_LOCAL: Record<number, { nombre: string; direccion: string; instagram: string }> = {
  1: { nombre: "Magnolia Home", direccion: "San Martín 1031", instagram: "@magnolia.deco.alvear" },
  2: { nombre: "Magnolia Beauty", direccion: "San Martín 784", instagram: "@magnolia.beauty.alvear" },
};

/** Código corto de la venta: las primeras 8 letras de su id. */
export const codigoVenta = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

export function venceCambio(creadaEn: string): Date {
  return new Date(Date.parse(creadaEn) + DIAS_CAMBIO * 86400_000);
}

export type Papel = "80" | "58" | "a4";

export interface VentaImpresa {
  id: string;
  local_id: number;
  creada_en: string;
  medio: string; // nombre del medio de pago
  total: number;
  paga_con?: number | null;
  /** Pago dividido: cada parte con el nombre del medio. */
  pagos?: { medio: string; monto: number; efectivo?: boolean }[] | null;
  items: { nombre: string; cantidad: number; precio_unitario: number; total: number }[];
  /** Se pagó (en parte o todo) con una gift card. */
  giftcard?: { codigo: string; usado: number; saldo: number | null } | null;
  /** En esta venta se vendió una gift card (o quedó saldo a favor de un cambio). */
  giftcard_nueva?: { codigo: string; monto: number; destinatario?: string | null } | null;
  /** Cambio de una venta anterior. */
  cambio?: { codigo: string; credito: number } | null;
  /** Retiro, gasto o ingreso de efectivo (constancia para firmar). */
  movimiento?: { tipo: "retiro" | "gasto" | "ingreso"; motivo: string; registro: string | null } | null;
}

export type TipoImpreso = "recibo" | "cambio" | "giftcard" | "constancia";

/** Rango de ids que empiezan con ese código, para buscar la venta en la base. */
export function rangoCodigo(texto: string): [string, string] | null {
  const c = texto.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (c.length !== 8) return null;
  return [`${c}-0000-0000-0000-000000000000`, `${c}-ffff-ffff-ffff-ffffffffffff`];
}
