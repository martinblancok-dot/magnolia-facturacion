import { Agent, request } from "node:https";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

// Los servidores de producción de ARCA usan una configuración TLS vieja (clave DH chica)
// que Node rechaza por defecto ("dh key too small"). Bajamos el nivel de exigencia
// SOLO para las conexiones a ARCA; el certificado del servidor se sigue verificando.
const agenteARCA = new Agent({ ciphers: "DEFAULT@SECLEVEL=0", keepAlive: true, minVersion: "TLSv1.2" });

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function leerXml(xml: string): Record<string, unknown> {
  return parser.parse(xml);
}

function post(url: string, headers: Record<string, string>, cuerpo: string): Promise<{ status: number; texto: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", agent: agenteARCA, headers: { ...headers, "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 30_000 },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("ARCA tardó demasiado en responder")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(`No se pudo conectar con ARCA (${e.code ?? e.message})`)));
    req.end(cuerpo);
  });
}

/** Manda un pedido SOAP y devuelve el contenido del <Body> ya convertido a objeto. */
export async function llamarSoap(url: string, accion: string, cuerpo: string): Promise<Record<string, unknown>> {
  const sobre =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;

  const { status, texto } = await post(url, { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion }, sobre);
  const doc = leerXml(texto) as { Envelope?: { Body?: Record<string, unknown> } };
  const body = doc.Envelope?.Body;
  if (!body) throw new Error(`Respuesta inesperada de ARCA (HTTP ${status}): ${texto.slice(0, 300)}`);
  const falla = body.Fault as { faultstring?: string } | undefined;
  if (falla) throw new Error(`ARCA respondió con error: ${falla.faultstring ?? "sin detalle"}`);
  return body;
}
