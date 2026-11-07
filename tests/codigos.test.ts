import { describe, expect, it } from "vitest";
import { buscar, claveCodigo, porCodigo, type ProductoCaja } from "@/lib/caja";
import { leerHojas, separarCodigos } from "@/lib/catalogo";
import { compararCodigos } from "@/lib/planilla";

const ENC = ["Articulo Prov", "Proveedor", "Articulo Interno", "Producto", "Precio unitario", "Precio sugerido", "precio descuento", "Barcode", "Categoria", "Barcode original (completo)"];

describe("planilla: columna Barcode original", () => {
  it("lee el código original (número o texto) y deja vacío lo que no tiene", () => {
    const r = leerHojas([{ sheet: "Nala Marroquineria", data: [ENC,
      ["0467", "NALA", "NA0467", "Mochila Amayra NA0467", "27790", 50530, 42950, "2240000004677", "Mochilas", 6196787000983],
      ["1198", "NALA", "NA1198", "Cartera NA1198", "26790", 48710, 41400, "2240000011987", "Carteras", ""],
      ["7572", "NALA", "NA7572", "Cartera Trendy NA7572", "23500", 42730, 36320, "2240000075727", "Carteras", " 4790010320750 "],
    ] }]);
    expect(r.productos.map((p) => p.codigos)).toEqual([["6196787000983"], [], ["4790010320750"]]);
  });
  it("separa varios códigos en una celda", () => {
    expect(separarCodigos("6196787000983, 4790010320750")).toEqual(["6196787000983", "4790010320750"]);
  });
  it("Jean Cartier sigue igual: su código con letras y símbolos es el código principal", () => {
    const r = leerHojas([{ sheet: "Jean Cartier", data: [ENC.slice(0, 9), ["0067", "JC", "0067/1-4", "Toalla 0067/1-4", "1000", 3000, 2550, "0067/1-4", "Toallas"]] }]);
    expect(r.productos[0]).toMatchObject({ barcode: "0067/1-4", codigos: [] });
  });
});

describe("sincronizar códigos sin pisar nada", () => {
  const productos = [
    { id: "A", barcode: "2240000004677", nombre: "Mochila", hoja: "Nala" },
    { id: "B", barcode: "2240000011987", nombre: "Cartera", hoja: "Nala" },
    { id: "C", barcode: "2240000075727", nombre: "Trendy", hoja: "Nala" },
  ];
  it("agrega los nuevos", () => {
    const c = compararCodigos([{ barcode: "2240000004677", nombre: "Mochila", codigos: ["6196787000983"] }], productos, [], ["Nala"]);
    expect(c).toEqual({ agregar: [{ codigo: "6196787000983", producto_id: "A" }], quitar: [], repetidos: [] });
  });
  it("si dos filas tienen el mismo código, avisa y no lo carga en ninguna", () => {
    const c = compararCodigos([
      { barcode: "2240000004677", nombre: "Mochila", codigos: ["6196787000983"] },
      { barcode: "2240000011987", nombre: "Cartera", codigos: ["06196787000983"] },
    ], productos, [], ["Nala"]);
    expect(c.agregar).toEqual([]);
    expect(c.repetidos[0].detalle).toMatch(/dos filas/);
  });
  it("si ya es de otro producto, avisa y no lo cambia", () => {
    const c = compararCodigos([{ barcode: "2240000011987", nombre: "Cartera", codigos: ["6196787000983"] }], productos,
      [{ codigo: "6196787000983", producto_id: "A", origen: "sistema" }], ["Nala"]);
    expect(c.agregar).toEqual([]);
    expect(c.quitar).toEqual([]);
    expect(c.repetidos[0].detalle).toMatch(/Mochila/);
  });
  it("no deja usar el código interno de otro producto", () => {
    const c = compararCodigos([{ barcode: "2240000004677", nombre: "Mochila", codigos: ["2240000075727"] }], productos, [], ["Nala"]);
    expect(c.agregar).toEqual([]);
    expect(c.repetidos[0].detalle).toMatch(/interno de "Trendy"/);
  });
  it("si lo borran de la planilla, se quita (los cargados en el sistema no)", () => {
    const c = compararCodigos([{ barcode: "2240000004677", nombre: "Mochila", codigos: [] }], productos, [
      { codigo: "6196787000983", producto_id: "A", origen: "planilla" },
      { codigo: "7790000000001", producto_id: "A", origen: "sistema" },
    ], ["Nala"]);
    expect(c.quitar).toEqual(["6196787000983"]);
  });
});

describe("caja: cualquier código encuentra el mismo producto", () => {
  const cat: ProductoCaja[] = [
    ["A", "2240000004677", "NA0467", "Mochila Amayra NA0467", 50530, 42950, "Mochilas", "Nala", ["6196787000983"]],
    ["B", "0067/1-4", "0067/1-4", "Toalla Jean Cartier", 3000, 2550, null, "Jean Cartier"],
  ];
  it("interno y original", () => {
    expect(buscar(cat, "2240000004677").exacto?.[0]).toBe("A");
    expect(buscar(cat, "6196787000983").exacto?.[0]).toBe("A");
    expect(buscar(cat, "06196787000983").exacto?.[0]).toBe("A"); // lector que agrega un 0
    expect(porCodigo(cat, " 6196787000983 ")?.[0]).toBe("A");
  });
  it("Jean Cartier con letras y símbolos", () => {
    expect(buscar(cat, "0067/1-4").exacto?.[0]).toBe("B");
  });
  it("por nombre y SKU sigue igual", () => {
    expect(buscar(cat, "mochila").resultados[0][0]).toBe("A");
    expect(buscar(cat, "na0467").exacto?.[0]).toBe("A");
  });
  it("normaliza", () => {
    expect(claveCodigo("0012345")).toBe("12345");
    expect(claveCodigo("0067/1-4")).toBe("0067/1-4");
  });
});
