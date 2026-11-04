// Direcciones de los servicios de ARCA.
// "homologacion" = entorno de prueba (facturas que no valen).
// "produccion"   = facturas reales.

export type Ambiente = "homologacion" | "produccion";

export const URLS: Record<Ambiente, { wsaa: string; wsfe: string }> = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

// Códigos fijos de ARCA que usamos
export const FACTURA_C = 11; // tipo de comprobante: Factura C (monotributo)
export const CONCEPTO_PRODUCTOS = 1; // venta de bienes
export const DOC_SIN_IDENTIFICAR = 99; // consumidor final sin DNI
export const COND_IVA_CONSUMIDOR_FINAL = 5;

// Por encima de este monto ARCA exige identificar al comprador (DNI/CUIT).
// Esas ventas no se facturan solas: quedan para revisar.
// IMPORTANTE: confirmar el valor vigente con el contador antes de pasar a producción.
export const UMBRAL_IDENTIFICACION = Number(process.env.UMBRAL_IDENTIFICACION ?? 10_000_000);

// Para venta de bienes, la fecha de la factura puede ser hasta 5 días anterior a hoy.
export const DIAS_ATRAS_PERMITIDOS = 5;
