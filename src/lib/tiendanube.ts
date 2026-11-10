// Conexión con la tienda online (Tiendanube).
// La app se crea en el portal de socios de Tiendanube; su número y su clave secreta van SOLO
// en Vercel (TIENDANUBE_APP_ID y TIENDANUBE_CLIENT_SECRET). El permiso de la tienda (access token,
// que no vence) se guarda cifrado en la tabla ajustes, clave "tiendanube".
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrar, descifrar } from "./secretos";

export const TN_API = "https://api.tiendanube.com/v1";
export const TN_AUTH = "https://www.tiendanube.com/apps";

export interface CredencialesTN { token: string; tienda: number; scope: string; conectada: string }

export function configTN() {
  const appId = process.env.TIENDANUBE_APP_ID?.trim() ?? "";
  const secreto = process.env.TIENDANUBE_CLIENT_SECRET?.trim() ?? "";
  return { appId, secreto, lista: !!appId && !!secreto };
}

export async function leerCredencialesTN(db: SupabaseClient): Promise<CredencialesTN | null> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "tiendanube").maybeSingle();
  if (!data?.valor) return null;
  try { return JSON.parse(descifrar(data.valor)) as CredencialesTN; } catch { return null; }
}

export async function guardarCredencialesTN(db: SupabaseClient, c: CredencialesTN) {
  const { error } = await db.from("ajustes").upsert({ clave: "tiendanube", valor: cifrar(JSON.stringify(c)), actualizado_en: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function borrarCredencialesTN(db: SupabaseClient) {
  await db.from("ajustes").delete().eq("clave", "tiendanube");
}

/** Cambia el código que manda Tiendanube (vale 30 segundos) por el permiso permanente de la tienda. */
export async function canjearCodigoTN(codigo: string): Promise<Omit<CredencialesTN, "conectada">> {
  const { appId, secreto } = configTN();
  const r = await fetch(`${TN_AUTH}/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: appId, client_secret: secreto, grant_type: "authorization_code", code: codigo }),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; user_id?: number | string; scope?: string; error_description?: string; error?: string };
  if (!r.ok || !d.access_token || !d.user_id) throw new Error(d.error_description || d.error || `Tiendanube respondió ${r.status}`);
  return { token: d.access_token, tienda: Number(d.user_id), scope: d.scope ?? "" };
}

/** Llamada a la API de Tiendanube con las credenciales guardadas. */
export async function tn<T = unknown>(c: CredencialesTN, ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${TN_API}/${c.tienda}${ruta}`, {
    method: init.method ?? "GET",
    headers: {
      Authentication: `bearer ${c.token}`,
      "User-Agent": "Magnolia sistema (soporte@casamagnolia.com.ar)",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (r.status === 401) throw new Error("Tiendanube rechazó el permiso: hay que volver a conectar la tienda.");
  if (!r.ok) throw new Error(`Tiendanube respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (r.status === 204 ? null : await r.json()) as T;
}
