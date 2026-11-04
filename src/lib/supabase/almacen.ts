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

/** Trae a todos los emisores con sus secretos descifrados (solo en el servidor). */
export async function traerEmisores(db: SupabaseClient): Promise<EmisorCompleto[]> {
  const emisores = ok(await db.from("emisores").select("*"));
  const secretos = ok(await db.from("secretos").select("*"));
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
