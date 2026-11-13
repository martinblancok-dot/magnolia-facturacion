import { describe, expect, it } from "vitest";
import { esFotoProducto, planFotos, type ProductoIndice } from "@/lib/fotos";

const prod = (id: string, sku: string, colores: string[] = []): ProductoIndice => ({
  id, sku, barcode: `B${id}`, nombre: `Prod ${sku}`,
  colores: colores.map((c, i) => ({ id: `${id}-c${i}`, color: c, sku_variante: `${sku}-${c.slice(0, 3).toUpperCase()}` })),
});
const productos = [
  prod("1", "EC8651"), prod("2", "EC9864"), prod("3", "EC9864-2"), prod("4", "E2743-5"), prod("5", "CAM304888"),
  prod("6", "ZA5977", ["Rosa", "Azul", "Aqua", "Transparente"]), prod("7", "1954/3"), prod("8", "VE100", ["Verde", "Verde agua"]),
];
const carpeta = "FINALES/";

describe("fotos desde la carpeta FINALES", () => {
  it("solo las -1 (nunca las de ambiente)", () => {
    expect(esFotoProducto("EC8651-botella-verde-rayada-1.jpg")).toBe(true);
    expect(esFotoProducto("EC8651-botella-verde-rayada-2-ambiente.jpg")).toBe(false);
    expect(esFotoProducto("x/EC8651-1.JPG")).toBe(true);
    const r = planFotos(["EC8651-botella-1.jpg", "EC8651-botella-2-ambiente.jpg"], productos);
    expect(r.plan).toHaveLength(1);
    expect(r.ignoradas).toEqual(["EC8651-botella-2-ambiente.jpg"]);
  });

  it("gana el SKU más largo que coincide con el comienzo del nombre", () => {
    const { plan } = planFotos([
      `${carpeta}EC9864-2-vaso-alto-1.jpg`, `${carpeta}EC9864-vaso-1.jpg`, "E2743-5-taza-1.jpg", "cam304888-manta-1.jpeg", "1954-3-plato-1.png",
    ], productos);
    const sku = (a: string) => plan.find((p) => p.archivo.endsWith(a))!.productos[0].sku;
    expect(sku("EC9864-2-vaso-alto-1.jpg")).toBe("EC9864-2");
    expect(sku("EC9864-vaso-1.jpg")).toBe("EC9864");
    expect(sku("E2743-5-taza-1.jpg")).toBe("E2743-5");
    expect(sku("cam304888-manta-1.jpeg")).toBe("CAM304888");
    expect(sku("1954-3-plato-1.png")).toBe("1954/3");
  });

  it("no confunde un SKU con otro que empieza igual", () => {
    const { plan } = planFotos(["EC86510-otro-1.jpg"], productos);
    expect(plan[0].estado).toBe("sin_producto");
  });

  it("varias -1 del mismo SKU: la primera alfabética es la principal y cada una va a su color", () => {
    const { plan } = planFotos([
      "ZA5977-vaso-transparente-1.jpg", "ZA5977-vaso-azul-1.jpg", "ZA5977-vaso-rosa-1.jpg", "ZA5977-vaso-aqua-1.jpg", "ZA5977-vaso-violeta-1.jpg",
    ], productos);
    expect(plan.map((p) => [p.archivo, p.principal, p.color?.color ?? null])).toEqual([
      ["ZA5977-vaso-aqua-1.jpg", true, "Aqua"],
      ["ZA5977-vaso-azul-1.jpg", false, "Azul"],
      ["ZA5977-vaso-rosa-1.jpg", false, "Rosa"],
      ["ZA5977-vaso-transparente-1.jpg", false, "Transparente"],
      ["ZA5977-vaso-violeta-1.jpg", false, null],
    ]);
    expect(plan[4].sinColor).toBe(true);
  });

  it("el color más largo gana (verde agua antes que verde)", () => {
    const { plan } = planFotos(["VE100-jarra-verde-agua-1.jpg", "VE100-jarra-verde-1.jpg"], productos);
    expect(plan.map((p) => p.color?.color)).toEqual(["Verde", "Verde agua"]);
  });

  it("SKU repetido en dos productos: queda para elegir", () => {
    const { plan } = planFotos(["AA1-x-1.jpg"], [prod("a", "AA1"), prod("b", "AA1")]);
    expect(plan[0].estado).toBe("varios");
    expect(plan[0].productos).toHaveLength(2);
  });
});
