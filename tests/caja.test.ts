import { describe, expect, it } from "vitest";
import { agregar, armarVenta, buscar, totales, validarVenta, type ItemCarrito, type ProductoCaja } from "@/lib/caja";
import { leerHojas } from "@/lib/catalogo";

const cat: ProductoCaja[] = [
  ["p1", "2000000010307", "Cam1030", "Frasco cilindro bambú extra Grande Cam1030", 14000, 11900, "Frascos"],
  ["p2", "2160000076787", "P7678", "Plato Linea moderna 27cm", 14890, 12660, "Vajilla"],
  ["p3", "0949/3Q-2", "0949/3Q", 'Kit Edredón "Ginebra" 0949/3Q', 174550, 148370, null],
];

describe("búsqueda en la caja", () => {
  it("el lector manda el código de barras exacto", () => {
    expect(buscar(cat, "2160000076787").exacto?.[0]).toBe("p2");
    expect(buscar(cat, "0949/3Q-2").exacto?.[0]).toBe("p3");
  });
  it("también por SKU sin importar mayúsculas", () => {
    expect(buscar(cat, "cam1030").exacto?.[0]).toBe("p1");
  });
  it("por palabras del nombre, sin acentos", () => {
    const r = buscar(cat, "bambu frasco");
    expect(r.exacto).toBeNull();
    expect(r.resultados.map((p) => p[0])).toEqual(["p1"]);
  });
});

describe("carrito y precios", () => {
  let items: ItemCarrito[] = [];
  items = agregar(items, cat[0]);
  items = agregar(items, cat[0]);
  items = agregar(items, cat[1]);
  it("suma cantidad si se escanea dos veces", () => {
    expect(items).toHaveLength(2);
    expect(items[0].cantidad).toBe(2);
  });
  it("efectivo usa el precio con 15%, tarjeta el de lista", () => {
    expect(totales(items, "efectivo").total).toBe(11900 * 2 + 12660);
    expect(totales(items, "credito").total).toBe(14000 * 2 + 14890);
    expect(totales(items, "efectivo").lista).toBe(14000 * 2 + 14890);
  });
  it("arma una venta válida para subir", () => {
    const v = armarVenta(items, "efectivo", 1, "t1", 40000, "0d9c2a4e-7b1f-4c55-9a3e-6f1d2b3c4d5e");
    expect(v.total).toBe(36460);
    expect(v.items[0]).toMatchObject({ cantidad: 2, precio_unitario: 11900, total: 23800 });
    expect(validarVenta(v)).toBeNull();
  });
  it("el servidor rechaza una venta con el total alterado", () => {
    const v = armarVenta(items, "debito", 2, "t1", null, "0d9c2a4e-7b1f-4c55-9a3e-6f1d2b3c4d5e");
    expect(validarVenta({ ...v, total: 1 })).toMatch(/total/);
    expect(validarVenta({ ...v, local_id: 9 })).toMatch(/local/);
  });
});

describe("importar Precios Deco", () => {
  const hojas = [
    { sheet: "Camwa", data: [
      ["Articulo Prov", "Proveedor", "Articulo Interno", "Producto", "Precio unitario", "Precio sugerido", "precio descuento", "Barcode", "Categoria"],
      ["1030", "Camwa", "Cam1030", "Frasco  cilindro", "7700", 14000, 11900, "2000000010307", "Frascos"],
      ["1031", "Camwa", "Cam1031", "Sin precio", "7700", null, null, "2000000010317", "Frascos"],
    ] },
    { sheet: "Plasticuer", data: [
      ["Articulo Prov", "Proveedor", "Articulo Interno", "Producto", "Precio unitario", "Precio sugerido", "precio descuento", "Barcode", "Categoria"],
      ["846", "Plasticuer", "PL846", "Tabla bambú", "20000", 40360, 34310, "2000000010307", "Otros"],
    ] },
    { sheet: "Todos Los Precios", data: [["Categoria", "SKU", "Nombre", "Costo", "Precio", "Precio con decuento", "Barcode"], ["x", "Cam1030", "Frasco", "1", 2, 3, "2000000010307"]] },
  ];
  it("lee solo pestañas de proveedor, avisa códigos repetidos y saltea filas sin precio", () => {
    const r = leerHojas(hojas);
    expect(r.hojas).toEqual(["Camwa", "Plasticuer"]);
    expect(r.productos).toHaveLength(1);
    expect(r.productos[0]).toMatchObject({ sku: "Cam1030", nombre: "Frasco cilindro", costo: 7700, precio_lista: 14000, precio_efectivo: 11900, proveedor: "Camwa" });
    expect(r.conflictos).toHaveLength(1);
    expect(r.salteadas).toBe(1);
  });
});
