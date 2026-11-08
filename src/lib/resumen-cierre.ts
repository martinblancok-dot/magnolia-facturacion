// Texto del resumen del cierre de caja, para mandar por WhatsApp o mail.
import { MEDIOS, type MedioPago } from "./caja";

export interface DatosResumen {
  local: string;
  abierta_en: string;
  cerrada_en: string;
  cerradoPor?: string | null;
  resumen: { total: number; cantidad: number; anuladas: number; ticketPromedio: number; porMedio: Record<string, { total: number; cantidad: number }>; efectivoEsperado: number; retiros: number; gastos: number; ingresos: number };
  fondo: number;
  contado: number | null;
  diferencia: number | null;
  deja: number | null;
  notas?: string | null;
  sinCobro?: number;          // ventas con tarjeta/transferencia que no aparecieron en Mercado Pago
  cobrosSinVenta?: number;
  top?: { nombre: string; cantidad: number }[];
  apertura?: { diferencia: number | null; nota?: string | null } | null;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const ar = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000);
const horaAR = (iso: string) => ar(iso).toISOString().slice(11, 16);
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const diaAR = (iso: string) => { const d = ar(iso); return `${DIAS[d.getUTCDay()]} ${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}`; };

export function textoResumen(d: DatosResumen): string {
  const r = d.resumen;
  const l: string[] = [];
  l.push(`*Cierre ${d.local}*`);
  l.push(`${diaAR(d.abierta_en)} · ${horaAR(d.abierta_en)} a ${horaAR(d.cerrada_en)}${d.cerradoPor ? ` · cerró ${d.cerradoPor}` : ""}`);
  l.push("");
  l.push(`*Ventas: ${$(r.total)}* (${r.cantidad}${r.anuladas ? `, ${r.anuladas} anuladas` : ""}) · ticket ${$(r.ticketPromedio)}`);
  for (const m of MEDIOS) {
    const x = r.porMedio[m.id as MedioPago];
    if (!x || (!x.cantidad && !x.total)) continue;
    l.push(`• ${m.id === "giftcard" ? "Solo con gift card" : m.nombre}: ${$(x.total)} (${x.cantidad})`);
  }
  l.push("");
  l.push("*Efectivo*");
  l.push(`Cambio inicial ${$(d.fondo)} · esperado ${$(r.efectivoEsperado)}`);
  if (d.apertura?.diferencia) l.push(`⚠️ Al abrir ${d.apertura.diferencia < 0 ? "faltaban" : "sobraban"} ${$(Math.abs(d.apertura.diferencia))} respecto del cierre anterior${d.apertura.nota ? ` (${d.apertura.nota})` : ""}`);
  if (r.retiros || r.gastos || r.ingresos) l.push([r.ingresos && `ingresos ${$(r.ingresos)}`, r.retiros && `retiros ${$(r.retiros)}`, r.gastos && `gastos ${$(r.gastos)}`].filter(Boolean).join(" · "));
  if (d.contado !== null) {
    const dif = d.diferencia ?? 0;
    l.push(`Contado ${$(d.contado)} · ${dif === 0 ? "✅ coincide" : dif > 0 ? `⚠️ sobran ${$(dif)}` : `⚠️ faltan ${$(-dif)}`}`);
  }
  if (d.deja !== null && d.contado !== null) l.push(d.contado - d.deja > 0 ? `Queda en caja ${$(d.deja)} · se retiró ${$(d.contado - d.deja)}` : `Queda en caja ${$(d.deja)}`);
  if (d.sinCobro || d.cobrosSinVenta) {
    l.push("");
    if (d.sinCobro) l.push(`⚠️ ${d.sinCobro} venta${d.sinCobro === 1 ? "" : "s"} con tarjeta/transferencia sin pago en Mercado Pago`);
    if (d.cobrosSinVenta) l.push(`⚠️ ${d.cobrosSinVenta} cobro${d.cobrosSinVenta === 1 ? "" : "s"} de Mercado Pago sin venta`);
  }
  if (d.top?.length) {
    l.push("");
    l.push("*Más vendido*");
    for (const t of d.top.slice(0, 5)) l.push(`${t.cantidad} × ${t.nombre}`);
  }
  if (d.notas) { l.push(""); l.push(`Notas: ${d.notas}`); }
  return l.join("\n");
}

/** Normaliza un número de WhatsApp argentino a formato internacional (549 + área + número). */
export function numeroWhatsapp(t: string): string | null {
  let n = t.replace(/\D/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("54")) n = n.slice(2);
  if (n.startsWith("9")) n = n.slice(1);
  if (n.startsWith("0")) n = n.slice(1);
  n = n.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2"); // quita el 15 del celular
  if (n.length !== 10) return null;
  return `549${n}`;
}

export const linkWhatsapp = (texto: string, numero?: string | null) => `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(texto)}`;
