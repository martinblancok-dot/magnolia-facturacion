// Lectura de cobros de una cuenta de Mercado Pago.
import { UMBRAL_IDENTIFICACION } from "./arca/config";
import { diaArgentina } from "./fechas";

const API = "https://api.mercadopago.com";

export type Origen = "posnet" | "qr" | "transferencia" | "otro";
export type EstadoInicial = "a_facturar" | "revisar";

/** Lo mínimo que usamos de un pago de Mercado Pago. */
export interface PagoMP {
  id: number;
  status: string;
  date_approved?: string | null;
  date_created: string;
  transaction_amount: number;
  payment_method_id?: string;
  payment_type_id?: string;
  operation_type?: string;
  pos_id?: string | null;
  description?: string | null;
  point_of_interaction?: { type?: string } | null;
  payer?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

export interface Cobro {
  mpId: string;
  dia: string; // AAAA-MM-DD en Argentina
  fechaHora: string; // ISO
  importe: number;
  origen: Origen;
  estado: EstadoInicial;
  detalle: string;
}

/** Decide de dónde vino el cobro. */
export function origenDe(p: PagoMP): Origen {
  const tipo = (p.point_of_interaction?.type ?? "").toUpperCase();
  if (tipo.includes("POINT")) return "posnet";
  if (tipo.includes("INSTORE") || tipo.includes("QR") || p.pos_id) return "qr";
  if (
    p.payment_method_id === "cvu" ||
    p.payment_type_id === "bank_transfer" ||
    p.operation_type === "money_transfer" ||
    tipo.includes("TRANSFER")
  )
    return "transferencia";
  return "otro";
}

/** Convierte un pago de MP en un cobro nuestro, o null si no corresponde (no aprobado, etc). */
export function aCobro(p: PagoMP): Cobro | null {
  if (p.status !== "approved" || !(p.transaction_amount > 0)) return null;
  const origen = origenDe(p);
  const fechaHora = p.date_approved ?? p.date_created;
  // Posnet y QR en el local son ventas: se facturan solas.
  // Transferencias y otros cobros pueden no ser ventas: quedan para revisar.
  // Ventas grandes requieren datos del comprador: siempre a revisar.
  const automatico = (origen === "posnet" || origen === "qr") && p.transaction_amount < UMBRAL_IDENTIFICACION;
  const nombre = [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(" ");
  return {
    mpId: String(p.id),
    dia: diaArgentina(fechaHora),
    fechaHora,
    importe: p.transaction_amount,
    origen,
    estado: automatico ? "a_facturar" : "revisar",
    detalle: [p.description, nombre].filter(Boolean).join(" · "),
  };
}

async function get<T>(token: string, ruta: string): Promise<T> {
  const res = await fetch(`${API}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Trae todos los cobros aprobados entre dos fechas ISO. */
export async function traerCobros(token: string, desdeISO: string, hastaISO: string): Promise<Cobro[]> {
  const yo = await get<{ id: number }>(token, "/users/me");
  const cobros: Cobro[] = [];
  const porPagina = 100;
  for (let offset = 0; ; offset += porPagina) {
    const q = new URLSearchParams({
      sort: "date_created",
      criteria: "asc",
      range: "date_created",
      begin_date: desdeISO,
      end_date: hastaISO,
      status: "approved",
      "collector.id": String(yo.id),
      limit: String(porPagina),
      offset: String(offset),
    });
    const pagina = await get<{ results: PagoMP[]; paging: { total: number } }>(token, `/v1/payments/search?${q}`);
    for (const p of pagina.results) {
      const c = aCobro(p);
      if (c) cobros.push(c);
    }
    if (offset + porPagina >= pagina.paging.total || pagina.results.length === 0) break;
  }
  return cobros;
}
