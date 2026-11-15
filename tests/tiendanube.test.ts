import { describe, expect, it } from "vitest";
import { ARBOL_TIENDA, categoriaTienda, stockOnline, sugerirCategoria } from "@/lib/tiendanube-sync";

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
    expect(sugerirCategoria("CARTERAS")).toBe("Carteras y bolsos");
    expect(sugerirCategoria("Tazas y jarros")).toBe("Mugs y tazas");
    expect(sugerirCategoria("Sábanas")).toBe("Sábanas");
    expect(sugerirCategoria("Velas aromáticas")).toBe("Velas");
    expect(sugerirCategoria("Varios")).toBeNull();
  });

  it("subcategorías nuevas: por la categoría de la planilla o por el nombre del producto", () => {
    expect(sugerirCategoria("Aros/Aritos")).toBe("Aros");
    expect(sugerirCategoria("Mochilas/Morrales/Riñoneras")).toBe("Mochilas y riñoneras");
    expect(sugerirCategoria("Billeteras")).toBe("Billeteras");
    expect(sugerirCategoria("Toallas/Baño")).toBe("Toallas");
    expect(sugerirCategoria("Canastos/Organizadores")).toBe("Canastos y organizadores");
    expect(sugerirCategoria("Decoración navideña")).toBe("Navidad");
    expect(sugerirCategoria("Individuales/Alfombras deco")).toBe("Manteles");
    const eq = new Map<string, string | null>([["Termos/Botellas/Jarras", "Termos y mates"]]);
    expect(categoriaTienda("Termos/Botellas/Jarras", "Botella de vidrio ámbar 900 ml", eq)).toBe("Botellas y jarras");
    expect(categoriaTienda("Termos/Botellas/Jarras", "Jarra con tapa 1,5 L", eq)).toBe("Botellas y jarras");
    expect(categoriaTienda("Termos/Botellas/Jarras", "Termo acero 1 L", eq)).toBe("Termos y mates");
    expect(categoriaTienda("Individuales/Alfombras deco", "Alfombra yute 60x90", new Map())).toBe("Alfombras");
    expect(categoriaTienda("Cortinas/Manteles/Textil hogar", "Manta tejida sillón", new Map())).toBe("Mantas");
    expect(categoriaTienda("Tazas", "Jarro enlozado", new Map())).toBe("Mugs y tazas");
    expect(Object.entries(ARBOL_TIENDA).find(([, h]) => h.includes("Botellas y jarras"))?.[0]).toBe("Mesa");
  });
});

describe("modo catálogo", () => {
  it("manda sin control de stock y lo guarda como -1", async () => {
    const { planColoresTN, stockTN, STOCK_LIBRE } = await import("@/lib/tiendanube-sync");
    expect(stockTN(STOCK_LIBRE)).toBeNull();
    expect(stockTN(0)).toBe(0);
    expect(stockTN(5)).toBe(5);
    const colores = [
      { id: "a", color: "Rojo", sku_variante: "X-ROJ", activo: true, orden: 1, tn_variante_id: 10, tn_precio: 100, tn_stock: 0, stock_variantes: [{ local_id: 1, cantidad: 0 }] },
    ];
    const normal = planColoresTN(colores as never, 100);
    expect(normal.cambios).toHaveLength(0);
    const cat = planColoresTN(colores as never, 100, true);
    expect(cat.activos[0].stockOnline).toBe(STOCK_LIBRE);
    expect(cat.cambios).toHaveLength(1);
  });
});
