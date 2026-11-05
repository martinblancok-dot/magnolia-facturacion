import { describe, expect, it } from "vitest";
import type { ProductoImportado } from "@/lib/catalogo";
import { compararCatalogo, hashToken, tokenCorrecto, type ProductoSistema } from "@/lib/planilla";

const sis = (b: string, extra: Partial<ProductoSistema> = {}): ProductoSistema => ({
  id: "id-" + b, barcode: b, sku: "S" + b, nombre: "Prod " + b, categoria: "Otros", proveedor: "Camwa", costo: 100,
  precio_lista: 1000, precio_efectivo: 850, activo: true, hoja: "Camwa", baja: null, ...extra,
});
const pla = (b: string, extra: Partial<ProductoImportado> = {}): ProductoImportado => ({
  barcode: b, sku: "S" + b, nombre: "Prod " + b, categoria: "Otros", proveedor: "Camwa", costo: 100,
  precio_lista: 1000, precio_efectivo: 850, hoja: "Camwa", ...extra,
});

describe("sincronización con la planilla", () => {
  it("detecta nuevos, cambios y bajas", () => {
    const r = compararCatalogo([sis("1"), sis("2"), sis("3")], [pla("1"), pla("2", { precio_lista: 1200, precio_efectivo: 1020 }), pla("4")]);
    expect(r.nuevos.map((p) => p.barcode)).toEqual(["4"]);
    expect(r.cambios).toEqual([{ id: "id-2", datos: { precio_lista: 1200, precio_efectivo: 1020 } }]);
    expect(r.bajas).toEqual(["id-3"]);
  });
  it("no pisa lo que se editó en el sistema y todavía no llegó a la planilla", () => {
    const r = compararCatalogo([sis("1", { nombre: "Nuevo nombre", costo: 150 })], [pla("1", { precio_lista: 1100 })], new Set(["1"]));
    expect(r.cambios).toEqual([{ id: "id-1", datos: { precio_lista: 1100 } }]);
  });
  it("reactiva lo que vuelve a la planilla, pero no lo eliminado en el sistema", () => {
    const r = compararCatalogo([sis("1", { activo: false, baja: "planilla" }), sis("2", { activo: false, baja: "sistema" })], [pla("1"), pla("2")]);
    expect(r.cambios).toEqual([{ id: "id-1", datos: { activo: true, baja: null } }]);
  });
  it("los productos cargados solo en el sistema no se dan de baja", () => {
    expect(compararCatalogo([sis("9", { hoja: null })], [pla("1")]).bajas).toEqual([]);
  });
  it("si la planilla llega casi vacía, no da de baja nada", () => {
    const muchos = Array.from({ length: 100 }, (_, i) => sis(String(i)));
    const r = compararCatalogo(muchos, [pla("1")]);
    expect(r.bajas).toEqual([]);
    expect(r.bajasFrenadas).toBe(99);
  });
  it("token", () => {
    expect(tokenCorrecto("abc", hashToken("abc"))).toBe(true);
    expect(tokenCorrecto("abd", hashToken("abc"))).toBe(false);
    expect(tokenCorrecto(null, hashToken("abc"))).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { SCRIPT_PLANILLA } from "@/lib/planilla-script";
it("el script que se muestra es igual a planilla/Magnolia.gs", () => {
  expect(SCRIPT_PLANILLA).toBe(readFileSync("planilla/Magnolia.gs", "utf8"));
});
