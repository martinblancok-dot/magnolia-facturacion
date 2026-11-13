import { describe, expect, it } from "vitest";
import { codigoDeArchivo, nombreFoto, rutaCorta, skusPosibles, urlFoto } from "../src/lib/fotos";

describe("fotos de productos", () => {
  it("nombre del archivo a partir del SKU (barra → guion)", () => {
    expect(nombreFoto("Cam1030", "123")).toBe("Cam1030");
    expect(nombreFoto("1954/3", "123")).toBe("1954-3");
    expect(nombreFoto("", "7790001")).toBe("7790001");
    expect(nombreFoto("ARO BP 1204", "1")).toBe("ARO_BP_1204");
  });
  it("código a partir del archivo elegido", () => {
    expect(codigoDeArchivo("Cam1030.JPG")).toBe("Cam1030");
    expect(codigoDeArchivo("C:\\fotos\\1954-3.webp")).toBe("1954-3");
    expect(codigoDeArchivo("D00123.png")).toBe("D00123");
  });
  it("prueba el SKU tal cual y con barra en vez de guion", () => {
    expect(skusPosibles("1954-3")).toEqual(["1954-3", "1954/3"]);
    expect(skusPosibles("Cam1030")).toEqual(["Cam1030"]);
  });
  it("a la caja viaja solo el final de la dirección", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/productos-miniaturas/Cam1030.webp?v=k1";
    expect(rutaCorta(url)).toBe("Cam1030.webp?v=k1");
    expect(rutaCorta(null)).toBeNull();
    expect(urlFoto(url)).toBe(url);
  });
});
