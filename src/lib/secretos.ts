// Cifrado de datos sensibles (clave privada, certificados, token de Mercado Pago)
// antes de guardarlos en la base de datos. La llave está en la variable SECRETOS_LLAVE.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function llave(): Buffer {
  const b64 = process.env.SECRETOS_LLAVE;
  if (!b64) throw new Error("Falta configurar SECRETOS_LLAVE");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("SECRETOS_LLAVE tiene que tener 32 bytes en base64");
  return k;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrar(guardado: string): string {
  const [iv, tag, datos] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", llave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}
