import { describe, expect, it } from "vitest";
import { armarVentaDividida, cobroDividido, totales, validarVenta, type ItemCarrito } from "@/lib/caja";
import { cruzarPagos, resumenTurno } from "@/lib/cierre";

const items: ItemCarrito[] = [
  { producto_id: "11111111-1111-1111-1111-111111111111", barcode: "1", sku: "A", nombre: "Plato", cantidad: 2, lista: 30000, efectivo: 25500 },
  { producto_id: "22222222-2222-2222-2222-222222222222", barcode: "2", sku: "B", nombre: "Taza", cantidad: 1, lista: 20000, efectivo: 17000 },
];
const ID = "33333333-3333-3333-3333-333333333333";

describe("pago en dos medios", () => {
  it("cada parte va al precio de su medio", () => {
    const ef = totales(items, "efectivo").total, tr = totales(items, "transferencia").total;
    const c = cobroDividido(items, "efectivo", 50000, "transferencia")!;
    expect(c.usa).toBe(50000);
    expect(c.falta).toBe(Math.round(tr * (1 - 50000 / ef)));
    expect(c.total).toBe(50000 + c.falta);
    expect(c.total).toBeGreaterThan(ef);
    expect(c.total).toBeLessThan(tr);
  });
  it("arma una venta válida con las dos partes", () => {
    const v = armarVentaDividida(items, "efectivo", 50000, "transferencia", 1, "t", 60000, ID)!;
    expect(v.medio_pago).toBe("transferencia");
    expect(v.pagos).toEqual([{ medio: "efectivo", monto: 50000 }, { medio: "transferencia", monto: v.total - 50000 }]);
    expect(v.paga_con).toBe(60000);
    expect(validarVenta(v)).toBeNull();
    expect(validarVenta({ ...v, pagos: [{ medio: "efectivo", monto: 50000 }, { medio: "transferencia", monto: 1 }] })).toMatch(/no suma/);
  });
  it("no divide si el primer monto cubre todo o es cero", () => {
    expect(cobroDividido(items, "efectivo", 999999, "transferencia")).toBeNull();
    expect(cobroDividido(items, "efectivo", 0, "transferencia")).toBeNull();
  });
  it("el cierre cuenta cada parte en su medio y cruza solo la transferencia", () => {
    const v = armarVentaDividida(items, "efectivo", 50000, "transferencia", 1, "t", null, ID)!;
    const venta = { id: ID, creada_en: "2026-11-06T13:00:00Z", medio_pago: v.medio_pago, total: v.total, pagos: v.pagos };
    const r = resumenTurno(10000, [venta], []);
    expect(r.porMedio.efectivo.total).toBe(50000);
    expect(r.porMedio.transferencia.total).toBe(v.total - 50000);
    expect(r.efectivoEsperado).toBe(60000);
    expect(r.total).toBe(v.total);
    const x = cruzarPagos([venta], [{ id: "c1", fecha_hora: "2026-11-06T13:02:00Z", importe: v.total - 50000, origen: "transferencia" }]);
    expect(x.encontrados).toHaveLength(1);
    expect(x.ventasSinCobro).toHaveLength(0);
  });
});
