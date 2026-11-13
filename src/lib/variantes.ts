// Variantes de color: lectura de la columna "Colores" y códigos internos por color.
// El SKU y el código de barras del producto NO cambian nunca; cada color tiene un código interno aparte
// (SKU + "-" + 3 letras del color, ej. 1954/3-NEG) que se usa solo dentro del sistema y en la tienda online.

export interface VarianteExistente { id: string; color: string; sku_variante: string; activo: boolean }

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const clave = (color: string) => sinAcentos(color).trim().toLowerCase().replace(/\s+/g, " ");

/** "negro, Verde agua ,  negro" → ["Negro", "Verde agua"] (sin repetidos, primera letra en mayúscula). */
export function separarColores(valor: unknown): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of String(valor ?? "").split(/[,;\n]/)) {
    const t = parte.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!t || vistos.has(clave(t))) continue;
    vistos.add(clave(t));
    out.push(t[0].toUpperCase() + t.slice(1));
  }
  return out;
}

/** 3 letras del color en mayúscula, sin acentos (Café → CAF, Verde agua → VER). */
export function letrasColor(color: string): string {
  const l = sinAcentos(color).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (l || "COL").slice(0, 3);
}

/**
 * Qué hacer con los colores de un producto: los que hay que crear (con su código), reactivar y desactivar.
 * Los códigos que ya existen no se tocan. Si dos colores dan las mismas letras: VER, VER2, VER3…
 */
export function planVariantes(sku: string, colores: string[], existentes: VarianteExistente[]) {
  const porColor = new Map(existentes.map((v) => [clave(v.color), v]));
  const usados = new Set(existentes.map((v) => v.sku_variante));
  const quiere = new Set(colores.map(clave));
  const crear: { color: string; sku_variante: string; orden: number }[] = [];
  const reactivar: string[] = [];
  const orden: { id: string; orden: number }[] = [];
  colores.forEach((color, i) => {
    const ya = porColor.get(clave(color));
    if (ya) {
      if (!ya.activo) reactivar.push(ya.id);
      orden.push({ id: ya.id, orden: i });
      return;
    }
    const base = `${sku}-${letrasColor(color)}`;
    let codigo = base;
    for (let n = 2; usados.has(codigo); n++) codigo = `${base}${n}`;
    usados.add(codigo);
    crear.push({ color, sku_variante: codigo, orden: i });
  });
  const desactivar = existentes.filter((v) => v.activo && !quiere.has(clave(v.color))).map((v) => v.id);
  return { crear, reactivar, desactivar, orden };
}

/** Colores de cada producto en la caja: producto_id → [[variante_id, color, foto?], …] (solo los activos, en orden). */
export type ColorCaja = [string, string] | [string, string, string];
export type VariantesCaja = Record<string, ColorCaja[]>;
