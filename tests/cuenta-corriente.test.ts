import { describe, expect, it } from "vitest";
import { armarVenta, armarVentaCambioCuenta, validarVenta, type CambioEnCurso, type ItemCarrito } from "@/lib/caja";
import { cruzarPagos, resumenTurno } from "@/lib/cierre";

const items: ItemCarrito[] = [
  { producto_id: "11111111-1111-1111-1111-111111111111", barcode: "1", sku: "A", nombre: "Plato", cantidad: 2, lista: 30000, efectivo: 25500 },
];
const ID = "33333333-3333-3333-3333-333333333333";
const CLI = "44444444-4444-4444-4444-444444444444";
const ORIG = "55555555-5555-5555-5555-555555555555";

describe("cuenta corriente", () => {
  it("vende a precio de lista y exige la clienta", () => {
    const v = { ...armarVenta(items, "cuenta", 1, "t", null, ID), cliente_cc_id: CLI };
    expect(v.total).toBe(60000);
    expect(validarVenta(v)).toBeNull();
    expect(validarVenta({ ...v, cliente_cc_id: undefined })).toMatch(/clienta/);
    expect(validarVenta({ ...armarVenta(items, "efectivo", 1, "t", null, ID), cliente_cc_id: CLI })).toMatch(/inválida/);
  });
  it("en un cambio lo devuelto se descuenta de la cuenta (total negativo)", () => {
    const c: CambioEnCurso = { venta_id: ORIG, codigo: "55555555", medio_precio: "cuenta", cliente_cc: { id: CLI, nombre: "Ana" },
      devoluciones: [{ producto_id: items[0].producto_id, barcode: "1", sku: "A", nombre: "Plato", cantidad: 1, precio: 30000 }] };
    const soloDevuelve = armarVentaCambioCuenta([], c, CLI, 1, "t", ID);
    expect(soloDevuelve.total).toBe(-30000);
    expect(soloDevuelve.medio_pago).toBe("cuenta");
    expect(validarVenta(soloDevuelve)).toBeNull();
    const conNuevo = armarVentaCambioCuenta([{ ...items[0], cantidad: 1, lista: 45000 }], c, CLI, 1, "t", ID);
    expect(conNuevo.total).toBe(15000);
    expect(validarVenta(conNuevo)).toBeNull();
  });
  it("una venta normal no puede tener total negativo", () => {
    const v = armarVenta(items, "efectivo", 1, "t", null, ID);
    expect(validarVenta({ ...v, total: -1 })).not.toBeNull();
  });
  it("no es efectivo esperado en el cierre ni se cruza con Mercado Pago", () => {
    const venta = { id: ID, creada_en: "2026-11-06T13:00:00Z", medio_pago: "cuenta" as const, total: 60000 };
    const r = resumenTurno(10000, [venta], []);
    expect(r.porMedio.cuenta.total).toBe(60000);
    expect(r.efectivoEsperado).toBe(10000);
    expect(cruzarPagos([venta], []).ventasSinCobro).toHaveLength(0);
  });
});
