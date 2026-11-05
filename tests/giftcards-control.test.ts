import { describe, expect, it } from "vitest";
import { estadoGc, resumenUsos } from "@/lib/giftcards";

describe("control de gift cards", () => {
  it("estado", () => {
    expect(estadoGc({ monto: 1000, saldo: 1000, anulada: false })).toBe("sin-usar");
    expect(estadoGc({ monto: 1000, saldo: 300, anulada: false })).toBe("en-parte");
    expect(estadoGc({ monto: 1000, saldo: 0, anulada: false })).toBe("agotada");
    expect(estadoGc({ monto: 1000, saldo: 0, anulada: true })).toBe("anulada");
  });
  it("usos sin contar los devueltos al anular", () => {
    const r = resumenUsos([
      { giftcard_id: "g", venta_id: "v1", monto: -400, creado_en: "2026-11-01T10:00:00Z" },
      { giftcard_id: "g", venta_id: "v2", monto: -300, creado_en: "2026-11-02T10:00:00Z" },
      { giftcard_id: "g", venta_id: "v2", monto: 300, creado_en: "2026-11-02T11:00:00Z" },
      { giftcard_id: "g", venta_id: "v3", monto: -100, creado_en: "2026-11-03T10:00:00Z" },
    ]);
    expect(r.usos.map((u) => u.venta_id)).toEqual(["v1", "v3"]);
    expect(r.usado).toBe(500);
    expect(r.ultimoUso).toBe("2026-11-03T10:00:00Z");
  });
});
