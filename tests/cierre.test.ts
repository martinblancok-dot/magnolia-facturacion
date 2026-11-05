import { describe, expect, it } from "vitest";
import { cruzarPagos, resumenTurno, totalBilletes, type CobroMP, type VentaTurno } from "@/lib/cierre";

const v = (id: string, hora: string, medio: VentaTurno["medio_pago"], total: number, anulada = false): VentaTurno =>
  ({ id, creada_en: `2026-11-05T${hora}:00-03:00`, medio_pago: medio, total, anulada });
const c = (id: string, hora: string, origen: CobroMP["origen"], importe: number): CobroMP =>
  ({ id, fecha_hora: `2026-11-05T${hora}:00-03:00`, origen, importe });

describe("arqueo", () => {
  it("suma billetes y monedas", () => {
    expect(totalBilletes({ "20000": 2, "1000": 3, "100": 5 }, 70)).toBe(43570);
  });
  it("efectivo esperado = fondo + ventas en efectivo + ingresos − retiros − gastos (sin anuladas)", () => {
    const r = resumenTurno(
      20000,
      [v("a", "10:00", "efectivo", 15000), v("b", "11:00", "efectivo", 5000, true), v("c", "12:00", "debito", 9000)],
      [{ tipo: "retiro", monto: 10000 }, { tipo: "gasto", monto: 1500 }, { tipo: "ingreso", monto: 500 }],
    );
    expect(r.efectivoEsperado).toBe(20000 + 15000 + 500 - 10000 - 1500);
    expect(r.porMedio.debito).toEqual({ total: 9000, cantidad: 1 });
    expect(r.cantidad).toBe(2);
    expect(r.anuladas).toBe(1);
    expect(r.total).toBe(24000);
  });
});

describe("cruce con Mercado Pago", () => {
  it("encuentra el cobro del posnet y avisa la transferencia que no entró", () => {
    const r = cruzarPagos(
      [v("a", "10:00", "debito", 12600), v("b", "11:00", "transferencia", 18500), v("e", "11:30", "efectivo", 5000)],
      [c("x", "10:01", "posnet", 12600)],
    );
    expect(r.encontrados).toEqual([{ ventaId: "a", cobroId: "x", minutos: 1 }]);
    expect(r.ventasSinCobro.map((x) => x.id)).toEqual(["b"]); // el efectivo no se cruza
    expect(r.cobrosSinVenta).toEqual([]);
  });
  it("la transferencia puede llegar un rato antes de cargar la venta", () => {
    const r = cruzarPagos([v("b", "11:00", "transferencia", 18500)], [c("t", "10:20", "transferencia", 18500)]);
    expect(r.encontrados).toHaveLength(1);
  });
  it("no cruza un débito con una transferencia del mismo monto, ni montos distintos", () => {
    const r = cruzarPagos([v("a", "10:00", "debito", 5000)], [c("t", "10:00", "transferencia", 5000), c("p", "10:00", "posnet", 5400)]);
    expect(r.encontrados).toEqual([]);
    expect(r.cobrosSinVenta.map((x) => x.id).sort()).toEqual(["p", "t"]);
  });
  it("dos ventas iguales se llevan cada una el cobro más cercano", () => {
    const r = cruzarPagos(
      [v("a", "10:00", "credito", 9000), v("b", "15:00", "credito", 9000)],
      [c("y", "15:02", "posnet", 9000), c("x", "10:03", "posnet", 9000)],
    );
    expect(r.encontrados.map((e) => [e.ventaId, e.cobroId])).toEqual([["a", "x"], ["b", "y"]]);
  });
  it("las anuladas no se esperan en Mercado Pago", () => {
    expect(cruzarPagos([v("a", "10:00", "qr", 100, true)], []).ventasSinCobro).toEqual([]);
  });
});
