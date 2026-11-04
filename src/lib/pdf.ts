// PDF de la factura con el QR que exige ARCA.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { fechaCorta, numeroFactura, pesos } from "./formato";

export interface DatosPDF {
  emisor: { nombre: string; cuit: string; domicilio?: string | null; ingresosBrutos?: string | null; inicioActividades?: string | null };
  factura: { puntoVenta: number; numero: number; fecha: string; importe: number; cae: string; caeVence: string; ambiente: string };
}

const cuitConGuiones = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

/** Dirección del QR según la especificación de ARCA (versión 1). */
export function urlQR(d: DatosPDF): string {
  const datos = {
    ver: 1, fecha: d.factura.fecha, cuit: Number(d.emisor.cuit), ptoVta: d.factura.puntoVenta, tipoCmp: 11,
    nroCmp: d.factura.numero, importe: Number(d.factura.importe.toFixed(2)), moneda: "PES", ctz: 1,
    tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: Number(d.factura.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos)).toString("base64")}`;
}

export async function generarPDF(d: DatosPDF): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const hoja = pdf.addPage([595, 842]); // A4
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const gris = rgb(0.4, 0.4, 0.4);
  const t = (texto: string, x: number, y: number, tam = 10, f = normal, color = rgb(0, 0, 0)) =>
    hoja.drawText(texto, { x, y, size: tam, font: f, color });
  const linea = (y: number) => hoja.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: gris });

  // Encabezado
  hoja.drawRectangle({ x: 40, y: 690, width: 515, height: 110, borderWidth: 0.7, borderColor: gris });
  hoja.drawRectangle({ x: 277, y: 755, width: 40, height: 40, borderWidth: 0.7, borderColor: gris, color: rgb(1, 1, 1) });
  t("C", 289, 765, 26, negrita);
  t("COD. 011", 281, 747, 7, normal, gris);
  t("ORIGINAL", 270, 805, 9, negrita);

  t(d.emisor.nombre.toUpperCase(), 52, 770, 13, negrita);
  t(d.emisor.domicilio ?? "", 52, 752, 9);
  t("Condición frente al IVA: Responsable Monotributo", 52, 738, 9);

  t("FACTURA", 340, 775, 16, negrita);
  t(`Punto de venta y número: ${numeroFactura(d.factura.puntoVenta, d.factura.numero)}`, 340, 755, 9);
  t(`Fecha de emisión: ${fechaCorta(d.factura.fecha)}`, 340, 741, 9);
  t(`CUIT: ${cuitConGuiones(d.emisor.cuit)}`, 340, 727, 9);
  t(`Ingresos Brutos: ${d.emisor.ingresosBrutos ?? cuitConGuiones(d.emisor.cuit)}`, 340, 713, 9);
  if (d.emisor.inicioActividades) t(`Inicio de actividades: ${fechaCorta(d.emisor.inicioActividades)}`, 340, 699, 9);

  // Receptor
  t("Cliente: Consumidor Final", 52, 665, 10, negrita);
  t("Condición frente al IVA: Consumidor Final", 52, 650, 9);
  t("Condición de venta: Contado", 340, 650, 9);
  linea(635);

  // Detalle
  t("Descripción", 52, 615, 9, negrita);
  t("Cant.", 380, 615, 9, negrita);
  t("Importe", 490, 615, 9, negrita);
  linea(607);
  t("Venta de mercadería", 52, 590, 10);
  t("1", 388, 590, 10);
  const imp = pesos(d.factura.importe);
  t(imp, 545 - normal.widthOfTextAtSize(imp, 10), 590, 10);
  linea(200);
  const total = `TOTAL: ${imp}`;
  t(total, 545 - negrita.widthOfTextAtSize(total, 13), 178, 13, negrita);

  // CAE + QR
  const png = await QRCode.toBuffer(urlQR(d), { margin: 1, width: 300 });
  const qr = await pdf.embedPng(png);
  hoja.drawImage(qr, { x: 40, y: 50, width: 110, height: 110 });
  t("Comprobante autorizado por ARCA", 165, 135, 10, negrita);
  t(`CAE: ${d.factura.cae}`, 165, 118, 10);
  t(`Vencimiento del CAE: ${fechaCorta(d.factura.caeVence)}`, 165, 103, 10);
  if (d.factura.ambiente !== "produccion") {
    t("COMPROBANTE DE PRUEBA - SIN VALIDEZ FISCAL", 165, 80, 11, negrita, rgb(0.7, 0.1, 0.1));
  }
  return pdf.save();
}
