import { describe, expect, it } from "vitest";
import { numeroWhatsapp, textoResumen } from "@/lib/resumen-cierre";

describe("resumen del cierre", () => {
  it("arma el texto", () => {
    const t = textoResumen({
      local: "Magnolia Home", abierta_en: "2026-11-05T12:00:00Z", cerrada_en: "2026-11-05T23:30:00Z", cerradoPor: "Juli",
      resumen: { total: 150000, cantidad: 6, anuladas: 1, ticketPromedio: 25000, efectivoEsperado: 80000, retiros: 0, gastos: 5000, ingresos: 0,
        porMedio: { efectivo: { total: 65000, cantidad: 3 }, debito: { total: 85000, cantidad: 3 }, credito: { total: 0, cantidad: 0 } } },
      fondo: 20000, contado: 79000, diferencia: -1000, deja: 20000, sinCobro: 1, top: [{ nombre: "Taza", cantidad: 4 }],
      apertura: { diferencia: -2000, nota: "se llevó cambio" },
    });
    expect(t).toContain("Al abrir faltaban $2.000 respecto del cierre anterior (se llevó cambio)");
    expect(t).toContain("*Cierre Magnolia Home*");
    expect(t).toContain("09:00 a 20:30");
    expect(t).toContain("*Ventas: $150.000* (6, 1 anuladas)");
    expect(t).toContain("• Efectivo: $65.000 (3)");
    expect(t).not.toContain("Crédito");
    expect(t).toContain("faltan $1.000");
    expect(t).toContain("se retiró $59.000");
    expect(t).toContain("gastos $5.000");
    expect(t).toContain("4 × Taza");
  });
  it("normaliza números", () => {
    expect(numeroWhatsapp("2625 15 123456")).toBe("5492625123456");
    expect(numeroWhatsapp("+54 9 2625 123456")).toBe("5492625123456");
    expect(numeroWhatsapp("02625-123456")).toBe("5492625123456");
    expect(numeroWhatsapp("123")).toBeNull();
  });
});
