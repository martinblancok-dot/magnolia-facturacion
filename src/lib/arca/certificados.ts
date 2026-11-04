// Revisa los archivos que carga cada uno antes de guardarlos.
import forge from "node-forge";

/** Acepta el certificado en texto (PEM) o en binario (DER) y lo devuelve en PEM. */
export function normalizarCertificado(contenido: Buffer): string {
  const texto = contenido.toString("utf8").trim();
  if (texto.includes("-----BEGIN CERTIFICATE-----")) {
    return forge.pki.certificateToPem(forge.pki.certificateFromPem(texto));
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(texto) && texto.length > 200) {
    // solo el bloque base64, sin encabezados
    const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(texto.replace(/\s+/g, ""))));
    return forge.pki.certificateToPem(cert);
  }
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(contenido.toString("binary"))));
  return forge.pki.certificateToPem(cert);
}

export interface InfoCertificado {
  alias: string;
  vence: Date;
  cuit: string | null;
}

export function infoCertificado(pem: string): InfoCertificado {
  const c = forge.pki.certificateFromPem(pem);
  const cn = c.subject.getField("CN")?.value ?? "";
  const serie = (c.subject.attributes.find((a) => a.type === "2.5.4.5")?.value as string | undefined) ?? "";
  return { alias: cn, vence: c.validity.notAfter, cuit: serie.replace(/\D/g, "") || null };
}

export function normalizarClave(contenido: Buffer): string {
  const k = forge.pki.privateKeyFromPem(contenido.toString("utf8"));
  return forge.pki.privateKeyToPem(k);
}

/** ¿La clave privada corresponde a este certificado? */
export function claveCorresponde(clavePem: string, certPem: string): boolean {
  const k = forge.pki.privateKeyFromPem(clavePem) as forge.pki.rsa.PrivateKey;
  const c = forge.pki.certificateFromPem(certPem).publicKey as forge.pki.rsa.PublicKey;
  return k.n.equals(c.n) && k.e.equals(c.e);
}
