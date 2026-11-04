import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

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

/** Manda un pedido SOAP y devuelve el contenido del <Body> ya convertido a objeto. */
export async function llamarSoap(url: string, accion: string, cuerpo: string): Promise<Record<string, unknown>> {
  const sobre =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion },
    body: sobre,
  });
  const texto = await res.text();
  const doc = leerXml(texto) as { Envelope?: { Body?: Record<string, unknown> } };
  const body = doc.Envelope?.Body;
  if (!body) throw new Error(`Respuesta inesperada de ARCA (HTTP ${res.status}): ${texto.slice(0, 300)}`);
  const falla = body.Fault as { faultstring?: string } | undefined;
  if (falla) throw new Error(`ARCA respondió con error: ${falla.faultstring ?? "sin detalle"}`);
  return body;
}
