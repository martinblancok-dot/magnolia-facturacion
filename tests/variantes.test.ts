import { describe, expect, it } from "vitest";
import { agregar, armarVenta, armarVentaCambio, type ProductoCaja } from "@/lib/caja";
import { leerHojas } from "@/lib/catalogo";
import { calcularReporte } from "@/lib/reportes";
import { planColoresTN } from "@/lib/tiendanube-sync";
import { letrasColor, planVariantes, separarColores } from "@/lib/variantes";

const taza: ProductoCaja = ["p1", "7790001", "1954/3", "Taza Nórdica 1954/3", 1000, 900, "Mugs"];

describe("columna Colores", () => {
  it("separa por comas, sin repetidos ni espacios de más", () => {
    expect(separarColores(" negro, Verde agua ,NEGRO,, café ")).toEqual(["Negro", "Verde agua", "Café"]);
    expect(separarColores("")).toEqual([]);
    expect(separarColores(null)).toEqual([]);
  });

  it("3 letras en mayúscula, sin acentos", () => {
    expect(letrasColor("Negro")).toBe("NEG");
    expect(letrasColor("Café")).toBe("CAF");
    expect(letrasColor("Verde agua")).toBe("VER");
    expect(letrasColor("Ñu")).toBe("NU");
  });

  it("la planilla trae los colores; sin la columna no se tocan", () => {
    const con = leerHojas([{ sheet: "Prov", data: [
      ["Articulo Interno", "Producto", "Precio sugerido", "Barcode", "Colores"],
      ["1954/3", "Taza", 1000, "7790001", "Negro, Blanco"],
      ["1955", "Plato", 2000, "7790002", ""],
    ] }]);
    expect(con.productos[0].colores).toEqual(["Negro", "Blanco"]);
    expect(con.productos[1].colores).toEqual([]);
    const sin = leerHojas([{ sheet: "Prov", data: [["Articulo Interno", "Producto", "Precio sugerido", "Barcode"], ["1954/3", "Taza", 1000, "7790001"]] }]);
    expect(sin.productos[0].colores).toBeUndefined();
  });
});

describe("códigos por color", () => {
  it("SKU + guion + 3 letras; si se repiten, VER, VER2", () => {
    const r = planVariantes("1954/3", ["Negro", "Verde", "Verde agua"], []);
    expect(r.crear.map((c) => c.sku_variante)).toEqual(["1954/3-NEG", "1954/3-VER", "1954/3-VER2"]);
  });

  it("los códigos que ya existen no cambian; un color que se saca se desactiva y si vuelve se reactiva", () => {
    const existentes = [
      { id: "a", color: "Negro", sku_variante: "1954/3-NEG", activo: true },
      { id: "b", color: "Verde", sku_variante: "1954/3-VER", activo: false },
      { id: "c", color: "Rojo", sku_variante: "1954/3-ROJ", activo: true },
    ];
    const r = planVariantes("1954/3", ["negro", "Verde", "Verdoso"], existentes);
    expect(r.crear).toEqual([{ color: "Verdoso", sku_variante: "1954/3-VER2", orden: 2 }]);
    expect(r.reactivar).toEqual(["b"]);
    expect(r.desactivar).toEqual(["c"]);
  });
});

describe("caja con colores", () => {
  it("cada color es una línea aparte, con el color en el nombre", () => {
    let it = agregar([], taza, 1, ["v1", "Negro"]);
    it = agregar(it, taza, 2, ["v2", "Blanco"]);
    it = agregar(it, taza, 1, ["v1", "Negro"]);
    expect(it.map((x) => [x.nombre, x.cantidad, x.variante_id])).toEqual([
      ["Taza Nórdica 1954/3 · Negro", 2, "v1"],
      ["Taza Nórdica 1954/3 · Blanco", 2, "v2"],
    ]);
  });

  it("la venta lleva el color de cada producto", () => {
    const v = armarVenta(agregar([], taza, 1, ["v1", "Negro"]), "efectivo", 1, "t", null, "00000000-0000-0000-0000-000000000001");
    expect(v.items[0]).toMatchObject({ producto_id: "p1", variante_id: "v1", color: "Negro" });
    const sin = armarVenta(agregar([], taza), "efectivo", 1, "t", null, "00000000-0000-0000-0000-000000000002");
    expect(sin.items[0].variante_id).toBeUndefined();
  });

  it("en un cambio, lo devuelto vuelve a su color", () => {
    const v = armarVentaCambio([], {
      venta_id: "x", codigo: "X", medio_precio: "efectivo",
      devoluciones: [{ producto_id: "p1", barcode: null, sku: null, nombre: "Taza · Negro", cantidad: 1, precio: 900, variante_id: "v1", color: "Negro" }],
    }, "efectivo", 1, "t", null, "00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000004");
    expect(v.items.find((i) => i.cantidad < 0)).toMatchObject({ variante_id: "v1", color: "Negro" });
  });
});

describe("reportes y tienda", () => {
  it("más vendidos: un producto con el detalle por color", () => {
    const r = calcularReporte([{
      id: "1", local_id: 1, creada_en: "2026-11-13T15:00:00Z", medio_pago: "efectivo", total: 3000, giftcard_monto: 0,
      items: [
        { producto_id: "p1", sku: "1954/3", nombre: "Taza · Negro", cantidad: 2, total: 2000, color: "Negro" },
        { producto_id: "p1", sku: "1954/3", nombre: "Taza · Blanco", cantidad: 1, total: 1000, color: "Blanco" },
      ],
    }], new Map());
    expect(r.masVendidos[0]).toMatchObject({ nombre: "Taza", unidades: 3, colores: { Negro: 2, Blanco: 1 } });
  });

  it("tienda: una variante por color; los colores dados de baja quedan en 0", () => {
    const base = { sku_variante: "", orden: 0, tn_precio: 1000 };
    const plan = planColoresTN([
      { ...base, id: "a", color: "Negro", activo: true, tn_variante_id: null, tn_stock: null, stock_variantes: [{ local_id: 1, cantidad: 5 }, { local_id: 2, cantidad: 1 }] },
      { ...base, id: "b", color: "Blanco", activo: true, tn_variante_id: 7, tn_stock: 0, stock_variantes: [{ local_id: 2, cantidad: 1 }] },
      { ...base, id: "c", color: "Rojo", activo: false, tn_variante_id: 8, tn_stock: 3, stock_variantes: [] },
    ], 1000);
    expect(plan.activos.map((v) => [v.color, v.stockOnline])).toEqual([["Blanco", 1], ["Negro", 4]]);
    expect(plan.cambios.map((v) => [v.id, v.stockOnline])).toEqual([["b", 1], ["a", 4], ["c", 0]]);
  });
});

describe("planilla real: BR9116, ZA5977 y PL304189", () => {
  it("la columna Colores se encuentra por el título en cualquier pestaña (no por posición)", () => {
    const r = leerHojas([
      { sheet: "Borlas", data: [["Proveedor", "Articulo Interno", "Producto", "Precio unitario", "Precio sugerido", "precio descuento", "Barcode", "Categoria", "Otra", "Colores"],
        ["Borlas", "BR9116", "Compotera labrada", 1000, 2000, 1700, "2170000091167", "Mesa", "", "Ámbar, Transparente rayada, Transparente tallada"]] },
      { sheet: "Zakka Deco", data: [["Colores", "Barcode", "Producto", "Articulo", "Precio sugerido"],
        ["Transparente, Rosa tornasolado, Azul tornasolado, Aqua tornasolado", "2100000059777", "Botella corcho", "ZA5977", 3000]] },
    ]);
    const br = r.productos.find((p) => p.sku === "BR9116")!;
    expect(br.colores).toEqual(["Ámbar", "Transparente rayada", "Transparente tallada"]);
    expect(planVariantes(br.sku, br.colores!, []).crear.map((c) => c.sku_variante)).toEqual(["BR9116-AMB", "BR9116-TRA", "BR9116-TRA2"]);
    expect(r.productos.find((p) => p.sku === "ZA5977")!.colores).toHaveLength(4);
  });
});

