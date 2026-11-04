import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generarPDF, urlQR, type DatosPDF } from "@/lib/pdf";

const d: DatosPDF = {
  emisor: { nombre: "Martín Blanco", cuit: "20393362406", domicilio: "San Martín 1031, General Alvear", inicioActividades: "2020-03-01" },
  factura: { puntoVenta: 3, numero: 42, fecha: "2026-11-03", importe: 25300.5, cae: "76441234567890", caeVence: "2026-11-13", ambiente: "homologacion" },
};

describe("PDF de factura", () => {
  it("el QR lleva los datos que pide ARCA", () => {
    const u = urlQR(d);
    expect(u.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    const json = JSON.parse(Buffer.from(u.split("p=")[1], "base64").toString());
    expect(json).toMatchObject({ ver: 1, cuit: 20393362406, ptoVta: 3, tipoCmp: 11, nroCmp: 42, importe: 25300.5, tipoCodAut: "E", codAut: 76441234567890 });
  });
  it("genera un PDF", async () => {
    const b = await generarPDF(d);
    expect(Buffer.from(b).subarray(0, 5).toString()).toBe("%PDF-");
    writeFileSync("/tmp/factura-ejemplo.pdf", b);
  });
});
