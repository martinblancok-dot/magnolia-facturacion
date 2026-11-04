// WSAA: el "login" de ARCA. Con el certificado y la clave privada se pide
// un ticket (token + sign) que dura ~12 horas y se usa para facturar.
import forge from "node-forge";
import { URLS, type Ambiente } from "./config";
import { leerXml, llamarSoap } from "./soap";

export interface Ticket {
  token: string;
  sign: string;
  vence: string; // fecha ISO
}

function isoArgentina(d: Date): string {
  // ARCA espera la hora con zona; usamos la de Argentina (-03:00)
  const local = new Date(d.getTime() - 3 * 3600_000);
  return local.toISOString().slice(0, 19) + "-03:00";
}

/** Arma el pedido de acceso (TRA) para un servicio, por ejemplo "wsfe". */
export function crearTRA(servicio: string, ahora = new Date()): string {
  const desde = new Date(ahora.getTime() - 10 * 60_000);
  const hasta = new Date(ahora.getTime() + 10 * 60_000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${isoArgentina(desde)}</generationTime>` +
    `<expirationTime>${isoArgentina(hasta)}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`
  );
}

/** Firma el TRA con el certificado (formato CMS/PKCS#7) y lo devuelve en base64. */
export function firmarTRA(tra: string, certificadoPem: string, clavePem: string): string {
  const cert = forge.pki.certificateFromPem(certificadoPem);
  const clave = forge.pki.privateKeyFromPem(clavePem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: clave,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/** Lee la respuesta de LoginCms y saca token, sign y vencimiento. */
export function leerTicket(loginCmsReturn: string): Ticket {
  const doc = leerXml(loginCmsReturn) as {
    loginTicketResponse?: { header?: { expirationTime?: string }; credentials?: { token?: string; sign?: string } };
  };
  const r = doc.loginTicketResponse;
  if (!r?.credentials?.token || !r.credentials.sign || !r.header?.expirationTime) {
    throw new Error("ARCA no devolvió un ticket válido");
  }
  return { token: r.credentials.token, sign: r.credentials.sign, vence: r.header.expirationTime };
}

/** Pide un ticket nuevo a ARCA. Ojo: ARCA rechaza pedir otro si el anterior sigue vigente,
 *  por eso el ticket se guarda y se reutiliza (ver obtenerTicket en facturador.ts). */
export async function pedirTicket(
  ambiente: Ambiente,
  certificadoPem: string,
  clavePem: string,
  servicio = "wsfe",
): Promise<Ticket> {
  const cms = firmarTRA(crearTRA(servicio), certificadoPem, clavePem);
  const body = await llamarSoap(
    URLS[ambiente].wsaa,
    "",
    `<wsaa:loginCms xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`,
  );
  const ret = (body.loginCmsResponse as { loginCmsReturn?: string } | undefined)?.loginCmsReturn;
  if (!ret) throw new Error("ARCA no devolvió respuesta al login");
  return leerTicket(ret);
}
