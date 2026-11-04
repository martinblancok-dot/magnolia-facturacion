// Lee el archivo que se baja de ARCA → "Mis Comprobantes" → "Emitidos" (Excel o CSV)
// y lo convierte en una lista de comprobantes con su importe en pesos.
import { readSheet } from "read-excel-file/node";

export interface ComprobanteARCA {
  tipo: number; // 11 = Factura C, 13 = Nota de Crédito C, etc.
  tipoTexto: string;
  puntoVenta: number;
  desde: number;
  hasta: number;
  fecha: string; // AAAA-MM-DD
  importe: number; // en pesos; negativo para notas de crédito
  cae: string | null;
}

const NOMBRES_TIPO: Record<number, string> = {
  11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C", 15: "Recibo C",
  83: "Tique", 109: "Tique C", 110: "Tique Nota de Crédito", 111: "Tique Factura C",
  114: "Tique Nota de Crédito C", 117: "Tique Nota de Débito C",
  211: "Factura de Crédito Electrónica C", 212: "Nota de Débito Electrónica C", 213: "Nota de Crédito Electrónica C",
};

const normal = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "1.234,56" / "1234,56" / "1234.56" / 1234.56 → número */
export function numeroAR(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/\$|\s/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** dd/mm/aaaa, aaaa-mm-dd, Date o número de serie de Excel → AAAA-MM-DD */
export function fechaISO(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400_000).toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function tipoDe(v: unknown): { tipo: number; texto: string } | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,3})/);
  if (m) {
    const tipo = Number(m[1]);
    const texto = s.replace(/^\d+\s*-?\s*/, "") || NOMBRES_TIPO[tipo] || `Tipo ${tipo}`;
    return { tipo, texto };
  }
  const n = normal(s);
  for (const [cod, nombre] of Object.entries(NOMBRES_TIPO)) if (normal(nombre) === n) return { tipo: Number(cod), texto: nombre };
  return null;
}

const esNotaDeCredito = (tipo: number, texto: string) => [3, 8, 13, 53, 110, 112, 113, 114, 203, 208, 213].includes(tipo) || /credito/i.test(normal(texto)) && /nota/i.test(normal(texto));

function leerCSV(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = (lineas.find((l) => /fecha/i.test(l)) ?? lineas[0] ?? "").split(";").length > 3 ? ";" : ",";
  return lineas.map((l) => {
    const celdas: string[] = [];
    let actual = "", comillas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (comillas && l[i + 1] === '"') { actual += '"'; i++; } else comillas = !comillas;
      } else if (c === sep && !comillas) { celdas.push(actual); actual = ""; }
      else actual += c;
    }
    celdas.push(actual);
    return celdas;
  });
}

export async function leerMisComprobantes(archivo: Buffer, nombre: string): Promise<{ comprobantes: ComprobanteARCA[]; ignoradas: number }> {
  const filas: unknown[][] = /\.xlsx$/i.test(nombre) ? ((await readSheet(archivo)) as unknown[][]) : leerCSV(archivo.toString("utf8"));

  // Buscar la fila de títulos (la primera fila del Excel de ARCA es un título general)
  const iTitulos = filas.findIndex((f) => f.some((c) => normal(c).startsWith("fecha")) && f.some((c) => normal(c).includes("total")));
  if (iTitulos < 0) throw new Error("No reconozco el archivo. Tiene que ser el de Mis Comprobantes → Emitidos.");
  const t = filas[iTitulos].map(normal);
  const col = (prueba: (h: string) => boolean) => t.findIndex(prueba);
  const c = {
    fecha: col((h) => h.startsWith("fecha")),
    tipo: col((h) => h.startsWith("tipo") && !h.includes("doc") && !h.includes("cambio")),
    pv: col((h) => h.includes("puntodeventa") || h === "ptovta"),
    desde: col((h) => h.includes("numerodesde") || h === "numero" || h === "nro"),
    hasta: col((h) => h.includes("numerohasta")),
    total: col((h) => h === "imptotal" || h === "importetotal" || h === "total"),
    moneda: col((h) => h === "moneda"),
    cambio: col((h) => h.includes("tipocambio") || h.includes("tipodecambio")),
    cae: col((h) => h.includes("codautorizacion") || h === "cae"),
  };
  if ([c.fecha, c.tipo, c.pv, c.desde, c.total].some((i) => i < 0)) {
    throw new Error("Al archivo le faltan columnas (fecha, tipo, punto de venta, número o total). Bajalo de nuevo desde Mis Comprobantes.");
  }

  const comprobantes: ComprobanteARCA[] = [];
  let ignoradas = 0;
  for (const f of filas.slice(iTitulos + 1)) {
    const fecha = fechaISO(f[c.fecha]);
    const tipo = tipoDe(f[c.tipo]);
    const pv = Math.trunc(numeroAR(f[c.pv]));
    const desde = Math.trunc(numeroAR(f[c.desde]));
    if (!fecha || !tipo || !pv || !desde) { ignoradas++; continue; }
    const hasta = c.hasta >= 0 ? Math.trunc(numeroAR(f[c.hasta])) || desde : desde;
    let importe = Math.abs(numeroAR(f[c.total]));
    const moneda = c.moneda >= 0 ? String(f[c.moneda] ?? "").trim().toUpperCase() : "";
    if (moneda && !["PES", "$", "ARS"].includes(moneda) && c.cambio >= 0) importe *= numeroAR(f[c.cambio]) || 1;
    if (esNotaDeCredito(tipo.tipo, tipo.texto)) importe = -importe;
    comprobantes.push({
      tipo: tipo.tipo, tipoTexto: tipo.texto, puntoVenta: pv, desde, hasta, fecha,
      importe: Math.round(importe * 100) / 100,
      cae: c.cae >= 0 ? String(f[c.cae] ?? "").trim() || null : null,
    });
  }
  return { comprobantes, ignoradas };
}
