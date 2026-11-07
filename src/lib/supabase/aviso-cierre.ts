// Resumen del cierre por WhatsApp y mail.
import type { SupabaseClient } from "@supabase/supabase-js";
import { textoResumen, type DatosResumen } from "@/lib/resumen-cierre";
import { descifrar } from "@/lib/secretos";
import { calcularCierre } from "./turnos";

export interface ConfigAviso { whatsapp: { nombre: string; numero: string }[]; mails: string[]; mailAuto: boolean; remitente: string }
export const AVISO_VACIO: ConfigAviso = { whatsapp: [], mails: [], mailAuto: false, remitente: "" };

export async function leerConfigAviso(db: SupabaseClient): Promise<ConfigAviso & { hayClaveMail: boolean }> {
  const { data } = await db.from("ajustes").select("clave, valor").in("clave", ["aviso_cierre", "resend_key"]);
  const m = new Map((data ?? []).map((x) => [x.clave, x.valor as string]));
  let c = AVISO_VACIO;
  try { c = { ...AVISO_VACIO, ...JSON.parse(m.get("aviso_cierre") ?? "{}") }; } catch {}
  return { ...c, hayClaveMail: !!m.get("resend_key") };
}

/** Texto del resumen de un cierre ya hecho. */
export async function resumenDeCierre(db: SupabaseClient, turnoId: string) {
  const c = await calcularCierre(db, turnoId, false);
  if (!c || !c.turno.cerrada_en) return null;
  const t = c.turno as typeof c.turno & { cerrada_por?: string | null; efectivo_contado: number | null; diferencia: number | null; deja_en_caja: number | null; notas: string | null };
  const [{ data: local }, { data: perfil }] = await Promise.all([
    db.from("locales").select("nombre").eq("id", t.local_id).maybeSingle(),
    t.cerrada_por ? db.from("perfiles").select("nombre").eq("usuario_id", t.cerrada_por).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const texto = textoResumen({
    local: local?.nombre ?? "Magnolia", abierta_en: t.abierta_en, cerrada_en: t.cerrada_en!, cerradoPor: (perfil as { nombre?: string } | null)?.nombre ?? null,
    resumen: c.resumen, fondo: Number(t.fondo_inicial),
    contado: t.efectivo_contado === null ? null : Number(t.efectivo_contado), diferencia: t.diferencia === null ? null : Number(t.diferencia),
    deja: t.deja_en_caja === null ? null : Number(t.deja_en_caja), notas: t.notas,
    sinCobro: c.alertas.ventasSinCobro.length, cobrosSinVenta: c.alertas.cobrosSinVenta.length, top: c.top,
    apertura: (t as { apertura?: DatosResumen["apertura"] }).apertura ?? null,
  });
  return { texto, asunto: `Cierre ${local?.nombre ?? ""} · $${Math.round(c.resumen.total).toLocaleString("es-AR")}` };
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (texto: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${escapar(texto).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>")}</div>`;

/** Manda un mail con Resend. Devuelve un error legible o null si salió bien. */
export async function enviarMail(db: SupabaseClient, para: string[], asunto: string, texto: string): Promise<string | null> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "resend_key").maybeSingle();
  if (!data?.valor) return "Falta la clave de Resend.";
  const cfg = await leerConfigAviso(db);
  let clave: string;
  try { clave = descifrar(data.valor); } catch { return "No se pudo leer la clave de Resend."; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.remitente || "Magnolia <onboarding@resend.dev>", to: para, subject: asunto, text: texto.replace(/\*/g, ""), html: html(texto) }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return `Resend respondió ${r.status}: ${(d as { message?: string }).message ?? ""}`.trim(); }
    return null;
  } catch (e) { return `No se pudo mandar el mail (${(e as Error).message}).`; }
}

/** Al cerrar la caja: arma el resumen y, si está activado, lo manda por mail. Nunca tira error. */
export async function avisarCierre(db: SupabaseClient, turnoId: string) {
  try {
    const r = await resumenDeCierre(db, turnoId);
    if (!r) return null;
    const cfg = await leerConfigAviso(db);
    let mail: string | null = null;
    if (cfg.mailAuto && cfg.mails.length && cfg.hayClaveMail) mail = (await enviarMail(db, cfg.mails, r.asunto, r.texto)) ?? "enviado";
    return { texto: r.texto, whatsapp: cfg.whatsapp, mail };
  } catch { return null; }
}
