// Clave de administrador: protege editar/eliminar productos, ver costos e importar.
// La clave se guarda cifrada (scrypt). Al desbloquear queda una cookie firmada por 30 minutos.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { clienteServidor } from "./supabase/almacen";

const COOKIE = "magnolia_admin";
const DURACION_MIN = 30;

function llaveFirma(): Buffer {
  const k = process.env.SECRETOS_LLAVE;
  if (!k) throw new Error("Falta SECRETOS_LLAVE");
  return createHmac("sha256", Buffer.from(k, "base64")).update("magnolia-admin").digest();
}

export function cifrarPin(pin: string): string {
  const sal = randomBytes(16);
  return `${sal.toString("base64")}.${scryptSync(pin, sal, 32).toString("base64")}`;
}

export function pinCorrecto(pin: string, guardado: string): boolean {
  const [sal, hash] = guardado.split(".");
  if (!sal || !hash) return false;
  const a = scryptSync(pin, Buffer.from(sal, "base64"), 32);
  const b = Buffer.from(hash, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function firmarVencimiento(vence: number): string {
  return `${vence}.${createHmac("sha256", llaveFirma()).update(String(vence)).digest("base64url")}`;
}

export function vencimientoValido(valor: string | undefined, ahora = Date.now()): boolean {
  if (!valor) return false;
  const [v, firma] = valor.split(".");
  const vence = Number(v);
  if (!vence || vence < ahora || !firma) return false;
  const esperada = createHmac("sha256", llaveFirma()).update(v).digest("base64url");
  return esperada.length === firma.length && timingSafeEqual(Buffer.from(esperada), Buffer.from(firma));
}

export async function pinGuardado(): Promise<string | null> {
  const { data } = await clienteServidor().from("ajustes").select("valor").eq("clave", "pin_admin").maybeSingle();
  return data?.valor ?? null;
}

/** Editar productos, ver costos e importar: solo los administradores (Martín y Sofi), sin clave. */
export async function adminDesbloqueado(): Promise<boolean> {
  const { usuarioDeLaSesion, perfilDe } = await import("./supabase/sesion");
  const u = await usuarioDeLaSesion();
  return !!u && (await perfilDe(u.id)).rol === "duenio";
}

export async function abrirAdmin() {
  (await cookies()).set(COOKIE, firmarVencimiento(Date.now() + DURACION_MIN * 60_000), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: DURACION_MIN * 60, path: "/",
  });
}

export async function cerrarAdmin() {
  (await cookies()).delete(COOKIE);
}
