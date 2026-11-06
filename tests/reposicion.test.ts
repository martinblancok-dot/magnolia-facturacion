import { describe, expect, it } from "vitest";
import { calcularReposicion, textoPedido } from "@/lib/reposicion";

const p = (id: string) => ({ id, sku: id.toUpperCase(), nombre: `Prod ${id}`, proveedor: "CAMWA", costo: 100 });

describe("reposición", () => {
  it("marca agotados, bajos, sugiere pedido y transferencia", () => {
    const stock = new Map<string, [number, number]>([["a", [0, 0]], ["b", [2, 10]], ["c", [5, 5]], ["d", [0, 6]]]);
    const vend = new Map<string, [number, number]>([["a", [6, 0]], ["b", [15, 0]], ["d", [9, 0]]]);
    const f = calcularReposicion([p("a"), p("b"), p("c"), p("d"), p("e")], stock, vend, { periodo: 30, cubrir: 30, alerta: 10 });
    const by = Object.fromEntries(f.map((x) => [x.id, x]));
    expect(by.e).toBeUndefined();
    expect(by.a.estado).toBe("agotado");
    expect(by.a.pedir).toBe(6);
    expect(by.c.estado).toBe("quieto");
    expect(by.b.estado).toBe("ok"); // 12 unidades a 0,5/día = 24 días
    expect(by.b.pasar).toEqual({ desde: 2, hasta: 1, cantidad: 3 }); // Home necesita 5 para 10 días, tiene 2
    expect(by.d.pasar).toEqual({ desde: 2, hasta: 1, cantidad: 3 });
    expect(f[0].id).toBe("a");
  });
  it("arma el texto del pedido", () => {
    expect(textoPedido("CAMWA", [{ sku: "X1", nombre: "Taza", cantidad: 6 }])).toContain("• 6 × Taza (X1)");
  });
});
