import { describe, expect, it } from "vitest";
import { calcularReporte, type ProductoRep } from "@/lib/reportes";

const prods = new Map<string, ProductoRep>([
  ["a", { id: "a", costo: 4000, categoria: "Frascos/Dispensers", proveedor: "Camwa" }],
  ["b", { id: "b", costo: null, categoria: "Tazas", proveedor: "Plasticuer" }],
]);

describe("reportes", () => {
  it("ingreso con promos, costo, ganancia y devoluciones", () => {
    const r = calcularReporte([
      { id: "1", local_id: 1, creada_en: "2026-11-05T13:30:00Z", medio_pago: "efectivo", total: 15000, giftcard_monto: 0, items: [
        { producto_id: "a", sku: "A", nombre: "Frasco", cantidad: 2, total: 20000 },
        { producto_id: null, sku: null, nombre: "Promo: 2da al 50%", cantidad: 1, total: -5000 },
      ] },
      { id: "2", local_id: 2, creada_en: "2026-11-05T22:00:00Z", medio_pago: "debito", total: 3000, giftcard_monto: 0, items: [
        { producto_id: "b", sku: "B", nombre: "Taza", cantidad: 1, total: 3000 },
      ] },
      { id: "3", local_id: 1, creada_en: "2026-11-06T13:00:00Z", medio_pago: "efectivo", total: 10000, giftcard_monto: 0, items: [
        { producto_id: null, sku: null, nombre: "Gift card ABC", cantidad: 1, total: 10000 },
      ] },
    ], prods);
    expect(r.ingreso).toBe(18000);
    expect(r.cobrado).toBe(28000);
    expect(r.giftcardsVendidas).toBe(10000);
    expect(r.costo).toBe(8000);
    expect(r.ganancia).toBe(7000); // 15000 - 8000 (la taza no tiene costo)
    expect(r.porCategoria[0]).toMatchObject({ clave: "Frascos", unidades: 2, ingreso: 15000 });
    expect(r.porHora[10]).toBe(15000); // 13:30 UTC = 10:30 en Argentina
    expect(r.masVendidos[0].nombre).toBe("Frasco");
    expect(r.ticketPromedio).toBe(9000);
  });
});

describe("costos por medio de pago", () => {
  it("descuenta 20,3% de lo cobrado en cuotas de la ganancia", async () => {
    const { calcularReporte } = await import("@/lib/reportes");
    const v = { id: "v", local_id: 1, creada_en: "2026-11-07T15:00:00Z", medio_pago: "cuotas", total: 100000, giftcard_monto: 0,
      items: [{ producto_id: null, sku: "A", nombre: "Mochila", cantidad: 1, total: 100000, costo: 50000 }] };
    expect(calcularReporte([v], new Map()).ganancia).toBe(50000);
    const r = calcularReporte([v], new Map(), { cuotas: 20.3 });
    expect(Math.round(r.comisiones)).toBe(20300);
    expect(Math.round(r.ganancia)).toBe(29700);
    // pago dividido: solo la parte en cuotas paga el cargo
    const d = calcularReporte([{ ...v, medio_pago: "cuotas", pagos: [{ medio: "efectivo", monto: 50000 }, { medio: "cuotas", monto: 50000 }] }], new Map(), { cuotas: 20.3 });
    expect(Math.round(d.comisiones)).toBe(10150);
  });
});
