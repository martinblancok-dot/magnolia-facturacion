import { describe, expect, it } from "vitest";
import { leerCsvFotos, planImportacion, type ProductoIndice } from "@/lib/fotos";

const csv = `﻿foto_producto,sku_base,color,sufijo,sku_variante,miniatura,principal_del_grupo
AT3632-botella-transparente-900ml-1.jpg,AT3632,Transparente,,AT3632,AT3632.webp,
BR9116-compotera-labrada-ambar-1.jpg,BR9116,Ámbar,AMB,BR9116-AMB,BR9116-AMB.webp,si
BR9116-compotera-labrada-rayada-1.jpg,BR9116,Transparente rayada,RAY,BR9116-RAY,BR9116-RAY.webp,no
BR9116-compotera-labrada-tallada-1.jpg,BR9116,Transparente tallada,TAL,BR9116-TAL,BR9116-TAL.webp,no
E2743-5-vaso-mykonos-alto-clear-1.jpg,E2743-5,Transparente,,E2743-5,E2743-5.webp,
ZZ1-no-existe-1.jpg,ZZ1,Rojo,,ZZ1,ZZ1.webp,
EC8651-botella-verde-rayada-1.jpg,EC8651,Verde,,EC8651,EC8651.webp,
`;
const prod = (id: string, sku: string, colores: [string, string][] = []): ProductoIndice =>
  ({ id, sku, barcode: `B${id}`, nombre: sku, colores: colores.map(([color, sv], i) => ({ id: `${id}${i}`, color, sku_variante: sv })) });
// BR9116: el sistema generó TRA y TRA2 para "Transparente rayada/tallada" → se encuentran por el nombre del color
const productos = [prod("1", "AT3632"), prod("2", "BR9116", [["Ambar", "BR9116-AMB"], ["Transparente rayada", "BR9116-TRA"]]), prod("3", "E2743/5"), prod("4", "EC8651")];
const archivos = ["AT3632.webp", "BR9116-AMB.webp", "BR9116-RAY.webp", "BR9116-TAL.webp", "E2743-5.webp", "ZZ1.webp"];

describe("importar miniaturas con el CSV", () => {
  const filas = leerCsvFotos(csv);
  const plan = planImportacion(filas, archivos, productos);
  const de = (m: string) => plan.find((p) => p.fila.miniatura === m)!;

  it("lee el CSV (con BOM) y la columna principal_del_grupo", () => {
    expect(filas).toHaveLength(7);
    expect(filas[1]).toMatchObject({ sku_base: "BR9116", sufijo: "AMB", principal: true });
    expect(filas[2].principal).toBe(false);
  });

  it("sin sufijo → foto del producto (SKU con guion o barra)", () => {
    expect(de("AT3632.webp")).toMatchObject({ estado: "listo", principal: true, color: null });
    expect(de("E2743-5.webp").producto?.sku).toBe("E2743/5");
  });

  it("con sufijo → al color (por código o por nombre, sin acentos); la principal del grupo también al producto", () => {
    expect(de("BR9116-AMB.webp")).toMatchObject({ estado: "listo", principal: true, color: { color: "Ambar" } });
    expect(de("BR9116-RAY.webp")).toMatchObject({ estado: "listo", principal: false, color: { color: "Transparente rayada" } });
    expect(de("BR9116-TAL.webp").estado).toBe("color_no_encontrado");
  });

  it("SKU que no está y fotos que faltan", () => {
    expect(de("ZZ1.webp").estado).toBe("sku_no_encontrado");
    expect(de("EC8651.webp").estado).toBe("sin_archivo");
  });
});
