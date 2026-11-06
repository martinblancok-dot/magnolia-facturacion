import { describe, expect, it } from "vitest";
import { armarVenta, armarVentaCambio, cobroCambio, totales, validarVenta, type CambioEnCurso, type ItemCarrito } from "@/lib/caja";
import { descuentosPromo, type Promo } from "@/lib/promos";

const it1 = (extra: Partial<ItemCarrito> = {}): ItemCarrito => ({ producto_id: "11111111-1111-1111-1111-111111111111", barcode: "1", sku: "CAM1", nombre: "Frasco", cantidad: 2, lista: 10000, efectivo: 8500, categoria: "Frascos/Dispensers", proveedor: "Camwa", ...extra });
const it2 = (extra: Partial<ItemCarrito> = {}): ItemCarrito => ({ producto_id: "22222222-2222-2222-2222-222222222222", barcode: "2", sku: "PL5", nombre: "Taza", cantidad: 1, lista: 4000, efectivo: 3400, categoria: "Tazas", proveedor: "Plasticuer", ...extra });
const promo = (p: Partial<Promo>): Promo => ({ id: "p", nombre: "Promo", tipo: "segunda", pct: 50, n: 2, m: 1, alcance: "todo", valores: [], mismo_producto: true, ...p });
const ID = "33333333-3333-3333-3333-333333333333", GC = "44444444-4444-4444-4444-444444444444", ORIG = "55555555-5555-5555-5555-555555555555";

describe("promos", () => {
  it("50% en la 2da unidad, sumado al precio de efectivo", () => {
    const t = totales([it1(), it2()], "efectivo", { promos: [promo({})] });
    expect(t.sinDescuento).toBe(8500 * 2 + 3400);
    expect(t.descuento).toBe(4250);
    expect(t.total).toBe(8500 * 2 + 3400 - 4250);
  });
  it("por categoría (incluye subcategorías) y 3x2 mezclando productos", () => {
    expect(descuentosPromo([{ clave: "a", precio: 100, categoria: "Frascos/Dispensers", proveedor: null, sku: null }], [promo({ tipo: "porcentaje", pct: 10, alcance: "categoria", valores: ["frascos"] })])[0].monto).toBe(10);
    const u = [300, 200, 100].map((p, i) => ({ clave: String(i), precio: p, categoria: null, proveedor: "Camwa", sku: null }));
    expect(descuentosPromo(u, [promo({ tipo: "nxm", n: 3, m: 2, alcance: "proveedor", valores: ["camwa"], mismo_producto: false })])[0].monto).toBe(100);
  });
  it("descuento manual después de las promos y la venta valida", () => {
    const ext = { promos: [promo({})], descuento: { tipo: "pct" as const, valor: 10 } };
    const v = armarVenta([it1(), it2()], "efectivo", 1, "t", null, ID, new Date(), ext);
    expect(v.items.filter((i) => i.ajuste).map((i) => i.total)).toEqual([-4250, -1615]);
    expect(validarVenta(v)).toBeNull();
    expect(v.descuento?.valor).toBe(10);
  });
});

describe("cambios", () => {
  const cambio = (cant = 1, precio = 8500): CambioEnCurso => ({ venta_id: ORIG, codigo: "55555555", medio_precio: "efectivo", devoluciones: [{ ...it1(), cantidad: cant, precio }] });
  it("cambio exacto", () => {
    const v = armarVentaCambio([it1({ cantidad: 1, producto_id: "66666666-6666-6666-6666-666666666666" })], cambio(), "efectivo", 1, "t", null, ID, GC);
    expect(v).toMatchObject({ total: 0, medio_pago: "cambio", credito_cambio: 8500, giftcard_nueva: null });
    expect(v.items.at(-1)).toMatchObject({ cantidad: -1, total: -8500 });
    expect(validarVenta(v)).toBeNull();
  });
  it("lo nuevo sale más: paga la diferencia", () => {
    const v = armarVentaCambio([it1({ cantidad: 2 })], cambio(), "debito", 1, "t", null, ID, GC);
    expect(v.medio_pago).toBe("debito");
    expect(v.total).toBe(Math.round(totales([it1({ cantidad: 2 })], "debito").total / 2));
    expect(validarVenta(v)).toBeNull();
  });
  it("lo nuevo sale menos: el saldo queda en una gift card", () => {
    const r = cobroCambio([it2()], cambio(), "efectivo");
    expect(r.aFavor).toBe(8500 - 3400);
    const v = armarVentaCambio([it2()], cambio(), "efectivo", 1, "t", null, ID, GC);
    expect(v.giftcard_nueva).toMatchObject({ monto: 5100, medio: "efectivo" });
    expect(validarVenta(v)).toBeNull();
  });
  it("solo devolución: todo a gift card", () => {
    const v = armarVentaCambio([], cambio(2), "efectivo", 1, "t", null, ID, GC);
    expect(v.giftcard_nueva?.monto).toBe(17000);
    expect(validarVenta(v)).toBeNull();
  });
  it("no se puede inventar crédito", () => {
    const v = armarVentaCambio([it2()], cambio(), "efectivo", 1, "t", null, ID, GC);
    expect(validarVenta({ ...v, credito_cambio: 20000 })).not.toBeNull();
    expect(validarVenta({ ...v, cambio_de: null })).not.toBeNull();
  });
});
