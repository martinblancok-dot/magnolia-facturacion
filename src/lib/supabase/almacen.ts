// Implementación del Almacen usando Supabase (con la llave de servidor).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ambiente } from "../arca/config";
import type { Almacen, Emisor } from "../facturador";
import type { Cobro } from "../mercadopago";
import { descifrar } from "../secretos";

export function clienteServidor(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function almacenSupabase(db: SupabaseClient): Almacen {
  return {
    async ticketGuardado(usuarioId, ambiente) {
      const t = ok(await db.from("tickets_arca").select("token, sign, vence").eq("usuario_id", usuarioId).eq("ambiente", ambiente).maybeSingle());
      return t ? { token: t.token, sign: t.sign, vence: t.vence } : null;
    },
    async guardarTicket(usuarioId, ambiente, t) {
      ok(await db.from("tickets_arca").upsert({ usuario_id: usuarioId, ambiente, ...t }));
    },
    async cobrosAFacturar(usuarioId) {
      const filas = ok(await db.from("cobros").select("id, dia, importe").eq("usuario_id", usuarioId).eq("estado", "a_facturar").order("fecha_hora"));
      return (filas ?? []).map((f) => ({ id: f.id, dia: f.dia, importe: Number(f.importe) }));
    },
    async ultimaFechaEmitida(usuarioId, puntoVenta, ambiente) {
      const f = ok(await db.from("facturas").select("fecha").eq("usuario_id", usuarioId).eq("punto_venta", puntoVenta).eq("ambiente", ambiente).order("numero", { ascending: false }).limit(1).maybeSingle());
      return f?.fecha ?? null;
    },
    async marcarEnviando(cobroId) {
      ok(await db.from("cobros").update({ estado: "enviando", mensaje: null }).eq("id", cobroId));
    },
    async guardarFactura(cobroId, f) {
      const cobro = ok(await db.from("cobros").select("usuario_id").eq("id", cobroId).single());
      ok(await db.from("facturas").insert({
        usuario_id: cobro!.usuario_id, cobro_id: cobroId, ambiente: f.ambiente, punto_venta: f.puntoVenta,
        numero: f.numero, fecha: f.fecha, importe: f.importe, cae: f.cae, cae_vence: f.caeVence,
        fuera_de_termino: f.fueraDeTermino,
      }));
      ok(await db.from("cobros").update({ estado: "facturado", mensaje: null }).eq("id", cobroId));
    },
    async marcarError(cobroId, mensaje, reintentable) {
      ok(await db.from("cobros").update({ estado: "error", mensaje: (reintentable ? "" : "[VERIFICAR EN ARCA] ") + mensaje }).eq("id", cobroId));
    },
  };
}

/** Guarda cobros nuevos; los que ya estaban no se tocan. */
export async function guardarCobros(db: SupabaseClient, usuarioId: string, cobros: Cobro[]): Promise<number> {
  if (cobros.length === 0) return 0;
  const filas = cobros.map((c) => ({
    usuario_id: usuarioId, mp_id: c.mpId, dia: c.dia, fecha_hora: c.fechaHora,
    importe: c.importe, origen: c.origen, detalle: c.detalle, estado: c.estado,
  }));
  const r = ok(await db.from("cobros").upsert(filas, { onConflict: "usuario_id,mp_id", ignoreDuplicates: true }).select("id"));
  return r?.length ?? 0;
}

export interface EmisorCompleto extends Emisor {
  nombre: string;
  mpToken: string | null;
  facturarAutomatico: boolean;
}

/** Un emisor con sus secretos, o null si todavía no terminó de configurar. */
export async function traerEmisor(db: SupabaseClient, usuarioId: string): Promise<EmisorCompleto | null> {
  const todos = await traerEmisores(db, usuarioId);
  return todos[0] ?? null;
}

/** Trae a los emisores con sus secretos descifrados (solo en el servidor). */
export async function traerEmisores(db: SupabaseClient, soloUsuario?: string): Promise<EmisorCompleto[]> {
  let qe = db.from("emisores").select("*");
  let qs = db.from("secretos").select("*");
  if (soloUsuario) {
    qe = qe.eq("usuario_id", soloUsuario);
    qs = qs.eq("usuario_id", soloUsuario);
  }
  const emisores = ok(await qe);
  const secretos = ok(await qs);
  const res: EmisorCompleto[] = [];
  for (const e of emisores ?? []) {
    const s = (secretos ?? []).find((x) => x.usuario_id === e.usuario_id);
    const ambiente = e.ambiente as Ambiente;
    const cert = ambiente === "produccion" ? s?.certificado_real : s?.certificado_prueba;
    if (!s?.clave_privada || !cert || !e.punto_venta) continue; // todavía no terminó de configurar
    res.push({
      usuarioId: e.usuario_id, nombre: e.nombre, cuit: e.cuit, puntoVenta: e.punto_venta, ambiente,
      certificadoPem: descifrar(cert), clavePem: descifrar(s.clave_privada),
      mpToken: s.mp_token ? descifrar(s.mp_token) : null, facturarAutomatico: e.facturar_automatico,
    });
  }
  return res;
}


/**
 * El cruce con facturas a mano es solo para lo anterior al sistema: se aplica a cobros
 * de antes del día en que el sistema emitió su primera factura real. Desde ahí en
 * adelante todo lo factura el sistema y no hace falta cruzar (evita confusiones con
 * facturas de efectivo del mismo monto). Sin facturas reales todavía, se cruza todo.
 */
async function corteConciliacion(db: SupabaseClient, usuarioId: string): Promise<string | null> {
  const { data } = await db.from("facturas").select("creado_en").eq("usuario_id", usuarioId).eq("ambiente", "produccion")
    .order("creado_en").limit(1).maybeSingle();
  if (!data?.creado_en) return null;
  return new Date(new Date(data.creado_en).getTime() - 3 * 3600_000).toISOString().slice(0, 10); // día en Argentina
}

/**
 * Marca como "ya_facturado" los cobros pendientes que coinciden con un comprobante
 * hecho a mano en ARCA (importado desde Mis Comprobantes). Devuelve cuántos marcó.
 */
export async function conciliarUsuario(db: SupabaseClient, usuarioId: string, puntoVentaSistema: number | null): Promise<number> {
  const { conciliar, DIAS_DESPUES } = await import("../conciliacion");
  const corte = await corteConciliacion(db, usuarioId);
  let qc = db.from("cobros").select("id, dia, importe")
    .eq("usuario_id", usuarioId).in("estado", ["revisar", "a_facturar"]).eq("no_conciliar", false).limit(5000);
  if (corte) qc = qc.lt("dia", corte);
  const cobros = ok(await qc) ?? [];
  if (cobros.length === 0) return 0;
  const minDia = cobros.reduce((m, c) => (c.dia < m ? c.dia : m), cobros[0].dia);
  const maxDia = cobros.reduce((m, c) => (c.dia > m ? c.dia : m), cobros[0].dia);
  const hasta = new Date(Date.parse(`${maxDia}T12:00:00Z`) + DIAS_DESPUES * 86400_000).toISOString().slice(0, 10);

  let q = db.from("comprobantes_arca").select("id, fecha, importe, punto_venta, numero_desde")
    .eq("usuario_id", usuarioId).gt("importe", 0).gte("fecha", minDia).lte("fecha", hasta).limit(10000);
  if (puntoVentaSistema) q = q.neq("punto_venta", puntoVentaSistema); // las del sistema no son "a mano"
  const comprobantes = ok(await q) ?? [];
  if (comprobantes.length === 0) return 0;

  // Sacar los comprobantes que ya están asociados a otro cobro
  const ids = comprobantes.map((c) => c.id);
  const usados = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const r = ok(await db.from("cobros").select("comprobante_id").in("comprobante_id", ids.slice(i, i + 300))) ?? [];
    r.forEach((x) => usados.add(x.comprobante_id as string));
  }
  const libres = comprobantes.filter((c) => !usados.has(c.id)).map((c) => ({ id: c.id, fecha: c.fecha, importe: Number(c.importe) }));
  const pares = conciliar(cobros.map((c) => ({ id: c.id, dia: c.dia, importe: Number(c.importe) })), libres);

  const porId = new Map(comprobantes.map((c) => [c.id, c]));
  for (const p of pares) {
    const c = porId.get(p.comprobanteId)!;
    const num = `${String(c.punto_venta).padStart(5, "0")}-${String(c.numero_desde).padStart(8, "0")}`;
    ok(await db.from("cobros").update({
      estado: "ya_facturado", comprobante_id: p.comprobanteId,
      mensaje: `Factura a mano ${num} del ${c.fecha.split("-").reverse().join("/")}`,
    }).eq("id", p.cobroId).in("estado", ["revisar", "a_facturar"]));
  }
  return pares.length;
}

export interface PosibleDuplicado {
  cobroId: string;
  dia: string;
  importe: number;
  facturaSistema: string; // número de la factura que hizo el sistema
  facturaMano: string; // número de la factura hecha a mano
  fechaMano: string;
}

/** Cobros que el sistema ya facturó y que además coinciden con una factura hecha a mano. */
export async function posiblesDuplicados(db: SupabaseClient, usuarioId: string, puntoVentaSistema: number | null): Promise<PosibleDuplicado[]> {
  const { conciliar, DIAS_DESPUES } = await import("../conciliacion");
  const corte = await corteConciliacion(db, usuarioId);
  let qf = db.from("cobros").select("id, dia, importe, facturas(punto_venta, numero, ambiente)")
    .eq("usuario_id", usuarioId).eq("estado", "facturado").limit(5000);
  if (corte) qf = qf.lt("dia", corte); // solo lo de antes del sistema puede tener factura a mano
  const facturados = ok(await qf) ?? [];
  const reales = facturados
    .map((c) => ({ ...c, f: (Array.isArray(c.facturas) ? c.facturas[0] : c.facturas) as { punto_venta: number; numero: number; ambiente: string } | null }))
    .filter((c) => c.f?.ambiente === "produccion");
  if (reales.length === 0) return [];
  const minDia = reales.reduce((m, c) => (c.dia < m ? c.dia : m), reales[0].dia);
  const maxDia = reales.reduce((m, c) => (c.dia > m ? c.dia : m), reales[0].dia);
  const hasta = new Date(Date.parse(`${maxDia}T12:00:00Z`) + DIAS_DESPUES * 86400_000).toISOString().slice(0, 10);
  let q = db.from("comprobantes_arca").select("id, fecha, importe, punto_venta, numero_desde")
    .eq("usuario_id", usuarioId).gt("importe", 0).gte("fecha", minDia).lte("fecha", hasta).limit(10000);
  if (puntoVentaSistema) q = q.neq("punto_venta", puntoVentaSistema);
  const manos = ok(await q) ?? [];
  const pares = conciliar(
    reales.map((c) => ({ id: c.id, dia: c.dia, importe: Number(c.importe) })),
    manos.map((m) => ({ id: m.id, fecha: m.fecha, importe: Number(m.importe) })),
  );
  const nro = (pv: number, n: number) => `${String(pv).padStart(5, "0")}-${String(n).padStart(8, "0")}`;
  return pares.map((p) => {
    const c = reales.find((x) => x.id === p.cobroId)!;
    const m = manos.find((x) => x.id === p.comprobanteId)!;
    return {
      cobroId: c.id, dia: c.dia, importe: Number(c.importe),
      facturaSistema: nro(c.f!.punto_venta, c.f!.numero), facturaMano: nro(m.punto_venta, m.numero_desde), fechaMano: m.fecha,
    };
  });
}
