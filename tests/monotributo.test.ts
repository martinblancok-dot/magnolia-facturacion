import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerMisComprobantes, numeroAR } from "@/lib/mis-comprobantes";
import { periodosRecategorizacion, ultimos12 } from "@/lib/periodos";

const archivo = (n: string) => readFileSync(join(import.meta.dirname, "archivos", n));

describe("Mis Comprobantes", () => {
  it("lee el Excel de ARCA (con fila de título arriba)", async () => {
    const { comprobantes } = await leerMisComprobantes(archivo("mis-comprobantes.xlsx"), "mis-comprobantes.xlsx");
    expect(comprobantes).toHaveLength(4);
    expect(comprobantes[0]).toMatchObject({ tipo: 11, puntoVenta: 3, desde: 1, fecha: "2026-10-30", importe: 13905 });
    expect(comprobantes[1]).toMatchObject({ fecha: "2026-03-15", importe: 50000.5 });
    expect(comprobantes[2]).toMatchObject({ tipo: 13, importe: -10000 }); // nota de crédito resta
  });

  it("lee el CSV con ; y coma decimal, y convierte moneda extranjera", async () => {
    const { comprobantes } = await leerMisComprobantes(archivo("mis-comprobantes.csv"), "x.csv");
    expect(comprobantes.map((c) => c.importe)).toEqual([13905, -10000, 10500]);
  });

  it("rechaza un archivo que no es de Mis Comprobantes", async () => {
    await expect(leerMisComprobantes(Buffer.from("hola;chau\n1;2"), "x.csv")).rejects.toThrow(/No reconozco/);
  });

  it("entiende números argentinos", () => {
    expect(numeroAR("1.234.567,89")).toBe(1234567.89);
    expect(numeroAR("$ 500")).toBe(500);
    expect(numeroAR(12.5)).toBe(12.5);
  });
});

describe("períodos de recategorización", () => {
  const movs = [
    { fecha: "2025-08-10", importe: 20000 },
    { fecha: "2026-03-15", importe: 50000 },
    { fecha: "2026-03-20", importe: -10000 },
    { fecha: "2026-10-30", importe: 13905 },
  ];
  it("arma enero y julio con los 12 meses que corresponden", () => {
    const p = periodosRecategorizacion(movs, "2026-11-04");
    expect(p.map((x) => [x.nombre, x.desde, x.hasta, x.total, x.enCurso])).toEqual([
      ["Enero 2027", "2026-01", "2026-12", 53905, true],
      ["Julio 2026", "2025-07", "2026-06", 60000, false],
      ["Enero 2026", "2025-01", "2025-12", 20000, false],
    ]);
  });
  it("últimos 12 meses corridos", () => {
    expect(ultimos12(movs, "2026-11-04")).toBe(20000 + 50000 - 10000 + 13905 - 20000 + 0); // ago-25 queda afuera (dic-25 a nov-26)
  });
});

describe("tiques", () => {
  it("reconoce Tique C (109) y la nota de crédito de tique C (114)", async () => {
    const csv = '"Fecha";"Tipo";"Punto de Venta";"Número Desde";"Imp. Total"\n"03/11/2026";"109";"1";"500";"57276,00"\n"04/11/2026";"114";"1";"7";"1000,00"\n';
    const { comprobantes } = await leerMisComprobantes(Buffer.from(csv), "x.csv");
    expect(comprobantes.map((c) => [c.tipo, c.tipoTexto, c.importe])).toEqual([[109, "Tique C", 57276], [114, "Tique Nota de Crédito C", -1000]]);
  });
});
