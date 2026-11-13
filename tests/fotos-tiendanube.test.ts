import { describe, expect, it } from "vitest";
import { buscarColor, buscarProducto, decidir, versionesChicas } from "@/lib/tiendanube-fotos";

const prod = (id: string, sku: string, tn: number | null = null) => ({ id, sku, barcode: `B${id}`, tn_producto_id: tn, imagen_url: null, tn_imagen: null });
const productos = [prod("1", "ZA5977", 500), prod("2", "E2743/5"), prod("3", "BR9116")];
const porTN = new Map(productos.filter((p) => p.tn_producto_id).map((p) => [p.tn_producto_id!, p]));
const porCodigo = new Map<string, typeof productos>();
for (const p of productos) for (const k of [p.sku.toLowerCase().replace(/\//g, "-"), p.barcode.toLowerCase()]) porCodigo.set(k, [p]);

describe("fotos desde Tiendanube", () => {
  it("miniaturas de la CDN: cambia el tamaño del final del nombre", () => {
    expect(versionesChicas("//dcdn-us.mitiendanube.com/stores/001/products/vaso-abc-1024-1024.webp")).toEqual([
      "https://dcdn-us.mitiendanube.com/stores/001/products/vaso-abc-240-0.webp",
      "https://dcdn-us.mitiendanube.com/stores/001/products/vaso-abc-480-0.webp",
    ]);
    expect(versionesChicas("https://x.com/foto.jpg")).toEqual([]);
  });

  it("producto: por el id publicado, por SKU (con barra o guion) o por el SKU sin el sufijo de color", () => {
    expect(buscarProducto({ id: 500, variants: [] }, porTN, porCodigo)?.id).toBe("1");
    expect(buscarProducto({ id: 9, variants: [{ id: 1, sku: "E2743-5" }] }, porTN, porCodigo)?.id).toBe("2");
    expect(buscarProducto({ id: 9, variants: [{ id: 1, sku: "BR9116-AMB" }, { id: 2, sku: "BR9116-RAY" }] }, porTN, porCodigo)?.id).toBe("3");
    expect(buscarProducto({ id: 9, variants: [{ id: 1, sku: "XX1" }] }, porTN, porCodigo)).toBeNull();
  });

  it("color: por id, por código, por nombre (sin tildes) o por el sufijo", () => {
    const col = (id: string, color: string, sv: string, tn: number | null = null) => ({ id, producto_id: "1", color, sku_variante: sv, tn_variante_id: tn, imagen_url: null, tn_imagen: null });
    const colores = [col("a", "Rosa tornasolado", "ZA5977-ROS"), col("b", "Ámbar", "ZA5977-AMB"), col("c", "Aqua tornasolado", "ZA5977-AQU", 77)];
    expect(buscarColor({ id: 77, sku: "otro" }, colores)?.id).toBe("c");
    expect(buscarColor({ id: 1, sku: "za5977-ros" }, colores)?.id).toBe("a");
    expect(buscarColor({ id: 1, sku: "", values: [{ es: "ambar" }] }, colores)?.id).toBe("b");
    expect(buscarColor({ id: 1, sku: "OTRO-AQU" }, colores)?.id).toBe("c");
    expect(buscarColor({ id: 1, sku: "ZA5977-VIO", values: [{ es: "Violeta" }] }, colores)).toBeNull();
  });

  it("reemplaza solo si no tiene foto o si la de la tienda cambió; las cargadas a mano no se tocan", () => {
    expect(decidir({ imagen_url: null, tn_imagen: null }, "a.jpg")).toBe("poner");
    expect(decidir({ imagen_url: "x", tn_imagen: "a.jpg" }, "a.jpg")).toBe("igual");
    expect(decidir({ imagen_url: "x", tn_imagen: "a.jpg" }, "b.jpg")).toBe("poner");
    expect(decidir({ imagen_url: "x", tn_imagen: null }, "b.jpg")).toBe("propia");
  });
});
