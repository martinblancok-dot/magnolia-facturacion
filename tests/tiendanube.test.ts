import { describe, expect, it } from "vitest";
import { stockOnline, sugerirCategoria } from "@/lib/tiendanube-sync";

describe("tienda online", () => {
  it("stock online: el local con más, menos 1; si queda 1 se publica 1", () => {
    expect(stockOnline([3, 1])).toBe(2);
    expect(stockOnline([1, 0])).toBe(1);
    expect(stockOnline([0, 0])).toBe(0);
    expect(stockOnline([-2])).toBe(0);
    expect(stockOnline([2.6, 5])).toBe(4);
    expect(stockOnline([])).toBe(0);
  });
  it("sugiere categorías por nombre", () => {
    expect(sugerirCategoria("CARTERAS")).toBe("Carteras, billeteras y mochilas");
    expect(sugerirCategoria("Tazas y jarros")).toBe("Mugs y tazas");
    expect(sugerirCategoria("Sábanas")).toBe("Sábanas");
    expect(sugerirCategoria("Velas aromáticas")).toBe("Velas");
    expect(sugerirCategoria("Varios")).toBeNull();
  });
});
