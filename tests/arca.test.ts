/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { leerXml } from "@/lib/arca/soap";
import { crearTRA, firmarTRA, leerTicket } from "@/lib/arca/wsaa";
import { leerRespuestaCAE, xmlSolicitarCAE } from "@/lib/arca/wsfe";

function certificadoDePrueba() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 86400_000);
  const attrs = [{ name: "commonName", value: "magnolia-facturacion" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

const cred = { ambiente: "homologacion" as const, cuit: "20123456786", token: "TOK", sign: "SIG&" };

describe("WSAA (login de ARCA)", () => {
  it("arma el TRA con servicio y ventana de 20 minutos en hora argentina", () => {
    const tra = crearTRA("wsfe", new Date("2026-11-03T15:00:00Z"));
    expect(tra).toContain("<service>wsfe</service>");
    expect(tra).toContain("<generationTime>2026-11-03T11:50:00-03:00</generationTime>");
    expect(tra).toContain("<expirationTime>2026-11-03T12:10:00-03:00</expirationTime>");
  });

  it("firma el TRA y OpenSSL verifica la firma y el contenido", () => {
    const { certPem, keyPem } = certificadoDePrueba();
    const tra = crearTRA("wsfe");
    const cms = firmarTRA(tra, certPem, keyPem);
    const dir = mkdtempSync(join(tmpdir(), "cms-"));
    writeFileSync(join(dir, "f.der"), Buffer.from(cms, "base64"));
    writeFileSync(join(dir, "c.pem"), certPem);
    const salida = execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", join(dir, "f.der"), "-CAfile", join(dir, "c.pem"), "-purpose", "any"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    expect(salida).toBe(tra);
  });

  it("lee el ticket de la respuesta", () => {
    const t = leerTicket(
      `<?xml version="1.0"?><loginTicketResponse version="1.0"><header><expirationTime>2026-11-04T09:00:00.000-03:00</expirationTime></header><credentials><token>AAA</token><sign>BBB</sign></credentials></loginTicketResponse>`,
    );
    expect(t).toEqual({ token: "AAA", sign: "BBB", vence: "2026-11-04T09:00:00.000-03:00" });
  });
});

describe("WSFE (factura electrónica)", () => {
  it("arma una Factura C a consumidor final", () => {
    const xml = xmlSolicitarCAE(cred, { puntoVenta: 2, numero: 15, fecha: "2026-11-03", importe: 12500.5 });
    const d = leerXml(xml) as any;
    const det = d.FECAESolicitar.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(d.FECAESolicitar.FeCAEReq.FeCabReq).toEqual({ CantReg: "1", PtoVta: "2", CbteTipo: "11" });
    expect(det.CbteFch).toBe("20261103");
    expect(det.ImpTotal).toBe("12500.50");
    expect(det.ImpNeto).toBe("12500.50");
    expect(det.ImpIVA).toBe("0");
    expect(det.DocTipo).toBe("99");
    expect(det.CondicionIVAReceptorId).toBe("5");
    expect(xml).toContain("<ar:Sign>SIG&amp;</ar:Sign>");
  });

  it("no deja facturar importes en cero", () => {
    expect(() => xmlSolicitarCAE(cred, { puntoVenta: 2, numero: 1, fecha: "2026-11-03", importe: 0 })).toThrow();
  });

  it("lee una respuesta aprobada", () => {
    const body = (leerXml(`<s:Envelope xmlns:s="x"><s:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>
      <FeCabResp><Resultado>A</Resultado></FeCabResp>
      <FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>76441234567890</CAE><CAEFchVto>20261113</CAEFchVto></FECAEDetResponse></FeDetResp>
      </FECAESolicitarResult></FECAESolicitarResponse></s:Body></s:Envelope>`) as any).Envelope.Body;
    expect(leerRespuestaCAE(body)).toEqual({ aprobada: true, cae: "76441234567890", caeVence: "2026-11-13", mensajes: [] });
  });

  it("lee una respuesta rechazada con sus motivos", () => {
    const body = (leerXml(`<s:Envelope xmlns:s="x"><s:Body><FECAESolicitarResponse><FECAESolicitarResult>
      <FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>Fecha fuera de rango</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>
      </FECAESolicitarResult></FECAESolicitarResponse></s:Body></s:Envelope>`) as any).Envelope.Body;
    const r = leerRespuestaCAE(body);
    expect(r.aprobada).toBe(false);
    expect(r.mensajes).toEqual(["10016 Fecha fuera de rango"]);
  });
});
