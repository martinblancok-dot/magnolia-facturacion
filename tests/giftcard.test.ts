import { describe, expect, it } from "vitest";
import { armarVentaGiftcard, armarVentaNuevaGiftcard, cobroConGiftcard, totales, validarVenta, type ItemCarrito } from "@/lib/caja";

const items: ItemCarrito[] = [
  { producto_id: "11111111-1111-1111-1111-111111111111", barcode: "1", sku: "A", nombre: "Plato", cantidad: 2, lista: 10000, efectivo: 8500 },
  { producto_id: "22222222-2222-2222-2222-222222222222", barcode: "2", sku: "B", nombre: "Taza", cantidad: 1, lista: 20000, efectivo: 17000 },
];
const ID = "33333333-3333-3333-3333-333333333333", GC = "44444444-4444-4444-4444-444444444444";

describe("gift card", () => {
  it("vender: se cobra el valor sin descuento, con cualquier medio", () => {
    const v = armarVentaNuevaGiftcard(50000, "debito", 1, "t", null, ID, GC);
    expect(v.total).toBe(50000);
    expect(v.items[0].nombre).toBe("Gift card 44444444");
    expect(validarVenta(v)).toBeNull();
  });

  it("alcanza: precio del medio con que se pagó la tarjeta y sobra saldo", () => {
    const c = cobroConGiftcard(items, { saldo: 50000, medio_origen: "efectivo" }, "efectivo");
    expect(c.precioGc).toBe(34000); // precios de efectivo
    expect(c).toMatchObject({ usa: 34000, falta: 0, saldoQueda: 16000 });
    const v = armarVentaGiftcard(items, { id: GC, codigo: "44444444", saldo: 50000, medio_origen: "efectivo" }, "efectivo", 1, "t", null, ID);
    expect(v).toMatchObject({ medio_pago: "giftcard", total: 0, giftcard_monto: 34000 });
    expect(validarVenta(v)).toBeNull();
  });

  it("tarjeta pagada con débito: 10% en los productos", () => {
    expect(cobroConGiftcard(items, { saldo: 100000, medio_origen: "debito" }, "efectivo").usa).toBe(totales(items, "debito").total);
  });

  it("falta: la diferencia se cobra al precio del otro medio", () => {
    // tarjeta de efectivo con $17.000: cubre la mitad (precio efectivo 34.000); la otra mitad en cuotas = 40.000 / 2
    const gc = { id: GC, codigo: "44444444", saldo: 17000, medio_origen: "efectivo" as const };
    const c = cobroConGiftcard(items, gc, "cuotas");
    expect(c).toMatchObject({ usa: 17000, falta: 20000, saldoQueda: 0, ajuste: 3000 });
    const v = armarVentaGiftcard(items, gc, "cuotas", 1, "t", null, ID);
    expect(v).toMatchObject({ medio_pago: "cuotas", total: 20000, giftcard_monto: 17000 });
    expect(validarVenta(v)).toBeNull();
    // al revés: tarjeta a precio de lista, la diferencia en efectivo tiene un ajuste a favor del cliente
    const v2 = armarVentaGiftcard(items, { ...gc, medio_origen: "cuotas", saldo: 20000 }, "efectivo", 1, "t", 30000, ID);
    expect(v2).toMatchObject({ medio_pago: "efectivo", total: 17000, paga_con: 30000 });
    expect(v2.items.at(-1)!.total).toBe(-3000);
    expect(validarVenta(v2)).toBeNull();
  });

  it("no acepta montos negativos sin gift card", () => {
    const v = armarVentaGiftcard(items, { id: GC, codigo: "x", saldo: 20000, medio_origen: "cuotas" }, "efectivo", 1, "t", null, ID);
    expect(validarVenta({ ...v, giftcard_monto: 0, giftcard_id: null, total: v.total + 20000 })).not.toBeNull();
  });
});
