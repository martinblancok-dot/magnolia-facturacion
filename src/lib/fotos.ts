// Miniaturas de productos: nombres de archivo y direcciones.
// Las miniaturas se llaman como el SKU del producto (la barra / se cambia por guion: 1954/3 → 1954-3.webp).

export const BUCKET_FOTOS = "productos-miniaturas";
export const LADO_MINIATURA = 300;      // px
export const MAX_BYTES_MINIATURA = 40 * 1024;

/** Nombre del archivo en la carpeta de miniaturas (sin la extensión). */
export function nombreFoto(sku: string | null | undefined, barcode: string): string {
  const base = (sku?.trim() || barcode.trim()).replace(/\//g, "-").replace(/[^A-Za-z0-9._-]/g, "_");
  return base.replace(/^[._]+/, "") || "producto";
}

/** Nombre del archivo que eligió el usuario, sin carpeta ni extensión (ej. "fotos/Cam1030.JPG" → "Cam1030"). */
export function codigoDeArchivo(archivo: string): string {
  return archivo.split(/[\\/]/).pop()!.replace(/\.(jpe?g|png|webp)$/i, "").trim();
}

/** SKUs posibles para un nombre de archivo: tal cual y con los guiones como barra (1954-3 → 1954/3). */
export function skusPosibles(codigo: string): string[] {
  const c = codigo.trim();
  return [...new Set([c, c.replace(/-/g, "/")])].filter(Boolean);
}

/** Lo que viaja a la caja: solo el final de la dirección (para no repetir la parte común miles de veces). */
export function rutaCorta(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(`/${BUCKET_FOTOS}/`);
  return i >= 0 ? url.slice(i + BUCKET_FOTOS.length + 2) : url;
}

/** Dirección completa de una miniatura a partir de lo que tiene la caja. */
export function urlFoto(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  if (/^https?:\/\//.test(ruta)) return ruta;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/${BUCKET_FOTOS}/${ruta}` : null;
}

// ---------- Carga masiva desde la carpeta de fotos finales ----------
// Regla: solo la foto del producto solo (termina en "-1.jpg"); nunca las "-2-ambiente.jpg".
// El producto se busca por el comienzo del nombre del archivo: el SKU más largo que coincida
// ("EC9864-2-vaso-1.jpg" va a EC9864-2 y no a EC9864). Si un SKU tiene varias fotos "-1",
// la principal es la primera en orden alfabético y cada una se asocia a su color si el nombre lo dice.

export type ProductoIndice = { id: string; sku: string; barcode: string; nombre: string; colores: { id: string; color: string; sku_variante: string }[] };
export type FotoPlan = {
  archivo: string;
  estado: "ok" | "varios" | "sin_producto";
  productos: ProductoIndice[];   // 1 si está claro; varios si hay más de un producto con ese SKU
  principal: boolean;            // va como miniatura del producto
  color?: { id: string; color: string; sku_variante: string } | null; // color que corresponde (si se encontró)
  sinColor?: boolean;            // el producto tiene colores pero el nombre no dice cuál
};

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const skuPlano = (sku: string) => sku.trim().toLowerCase().replace(/\//g, "-");

/** ¿Es la foto del producto solo? (termina en -1.jpg / .jpeg / .png / .webp) */
export const esFotoProducto = (archivo: string) => /-1\.(jpe?g|png|webp)$/i.test(archivo.split(/[\\/]/).pop() ?? "");

/** Palabras normalizadas: minúsculas, sin tildes; guiones y espacios separan igual. */
const palabras = (s: string) => plano(s).split("-").filter(Boolean);

/**
 * Qué tan bien una parte del nombre del archivo corresponde a un color. 0 = no corresponde.
 * Vale si palabras seguidas del archivo coinciden con palabras seguidas del color, por ejemplo:
 *   "rosa" → "Rosa tornasolado" (comienzo del color), "flores-verdes" → "Flores verdes" (el color entero),
 *   "rayada" → "Transparente rayada" (una palabra del color).
 * Puntaje: más palabras coincidentes gana; a igual cantidad, gana si coincide con el comienzo del color
 * y después si cubre el color entero.
 */
export function puntajeColor(restoArchivo: string, color: string): number {
  const a = palabras(restoArchivo), c = palabras(color);
  if (!a.length || !c.length) return 0;
  let mejor = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < c.length; j++) {
      let n = 0;
      while (i + n < a.length && j + n < c.length && a[i + n] === c[j + n]) n++;
      if (!n) continue;
      const p = n * 100 + (j === 0 ? 10 : 0) + (j === 0 && n === c.length ? 5 : 0);
      if (p > mejor) mejor = p;
    }
  }
  return mejor;
}

/** El color que mejor corresponde al nombre del archivo; null si ninguno o si dos empatan (no se adivina). */
export function colorDeArchivo<C extends { color: string }>(restoArchivo: string, colores: C[]): C | null {
  const puntajes = colores.map((c) => ({ c, p: puntajeColor(restoArchivo, c.color) })).filter((x) => x.p > 0).sort((x, y) => y.p - x.p);
  if (!puntajes.length) return null;
  if (puntajes[1] && puntajes[1].p === puntajes[0].p) return null; // empate: mejor que lo elijas vos
  return puntajes[0].c;
}

export function planFotos(archivos: string[], productos: ProductoIndice[]): { plan: FotoPlan[]; ignoradas: string[] } {
  const ignoradas: string[] = [];
  const porSku = new Map<string, ProductoIndice[]>();
  for (const p of productos) {
    const k = skuPlano(p.sku || p.barcode);
    if (k) porSku.set(k, [...(porSku.get(k) ?? []), p]);
  }
  const skus = [...porSku.keys()].sort((a, b) => b.length - a.length); // el más largo primero

  type Leida = { archivo: string; sku: string | null; resto: string };
  const leidas: Leida[] = [];
  for (const a of archivos) {
    if (!esFotoProducto(a)) { ignoradas.push(a); continue; }
    const nombre = codigoDeArchivo(a).toLowerCase();
    const sku = skus.find((s) => nombre === s || nombre.startsWith(`${s}-`)) ?? null;
    leidas.push({ archivo: a, sku, resto: sku ? plano(nombre.slice(sku.length)).replace(/(^|-)1$/, "") : "" /* lo que está entre el SKU y "-1" */ });
  }
  leidas.sort((x, y) => codigoDeArchivo(x.archivo).localeCompare(codigoDeArchivo(y.archivo)));

  const plan: FotoPlan[] = [];
  const yaPrincipal = new Set<string>();
  for (const l of leidas) {
    if (!l.sku) { plan.push({ archivo: l.archivo, estado: "sin_producto", productos: [], principal: false }); continue; }
    const lista = porSku.get(l.sku)!;
    const principal = !yaPrincipal.has(l.sku);
    yaPrincipal.add(l.sku);
    if (lista.length > 1) { plan.push({ archivo: l.archivo, estado: "varios", productos: lista, principal: true }); continue; }
    const p = lista[0];
    const color = colorDeArchivo(l.resto, p.colores);
    plan.push({ archivo: l.archivo, estado: "ok", productos: [p], principal, color, sinColor: !color && p.colores.length > 0 });
  }
  return { plan, ignoradas };
}

// ---------- Importar miniaturas ya hechas (carpeta FINALES/miniaturas + _variantes-colores.csv) ----------
// Columnas del CSV: foto_producto, sku_base, color, sufijo, sku_variante, miniatura, principal_del_grupo.
// Sin sufijo → foto del producto. Con sufijo → foto del color (y también del producto si principal_del_grupo = "si").

export type FilaCsvFotos = { sku_base: string; color: string; sufijo: string; sku_variante: string; miniatura: string; principal: boolean };
export type Importacion = {
  fila: FilaCsvFotos;
  estado: "listo" | "sku_no_encontrado" | "sku_repetido" | "sin_archivo" | "color_no_encontrado";
  producto?: ProductoIndice;
  color?: { id: string; color: string; sku_variante: string } | null;
  principal: boolean;   // va como foto del producto
};

/** Lee un CSV simple (con comillas opcionales). */
export function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [], campo = "", comillas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === "," || ch === ";") { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((c) => c.trim())) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo);
  if (fila.some((c) => c.trim())) filas.push(fila);
  return filas;
}

export function leerCsvFotos(texto: string): FilaCsvFotos[] {
  const [titulos, ...resto] = leerCsv(texto);
  if (!titulos) return [];
  const col = (n: string) => titulos.findIndex((t) => t.trim().toLowerCase() === n);
  const c = { sku: col("sku_base"), color: col("color"), sufijo: col("sufijo"), skuVar: col("sku_variante"), mini: col("miniatura"), principal: col("principal_del_grupo") };
  if (c.sku < 0 || c.mini < 0) throw new Error("El CSV no tiene las columnas sku_base y miniatura.");
  const v = (f: string[], i: number) => (i >= 0 ? (f[i] ?? "").trim() : "");
  return resto.map((f) => ({
    sku_base: v(f, c.sku), color: v(f, c.color), sufijo: v(f, c.sufijo), sku_variante: v(f, c.skuVar), miniatura: v(f, c.mini),
    principal: /^(si|sí|s|yes|1|true)$/i.test(v(f, c.principal)),
  })).filter((f) => f.sku_base && f.miniatura);
}

export function planImportacion(filas: FilaCsvFotos[], archivos: string[], productos: ProductoIndice[]): Importacion[] {
  const hay = new Set(archivos.map((a) => (a.split(/[\\/]/).pop() ?? "").toLowerCase()));
  const porSku = new Map<string, ProductoIndice[]>();
  for (const p of productos) {
    const k = skuPlano(p.sku || p.barcode);
    if (k) porSku.set(k, [...(porSku.get(k) ?? []), p]);
  }
  return filas.map((fila): Importacion => {
    const conColor = !!fila.sufijo;
    const principal = !conColor || fila.principal;
    if (!hay.has(fila.miniatura.toLowerCase())) return { fila, estado: "sin_archivo", principal };
    const lista = porSku.get(skuPlano(fila.sku_base)) ?? [];
    if (!lista.length) return { fila, estado: "sku_no_encontrado", principal };
    if (lista.length > 1) return { fila, estado: "sku_repetido", principal };
    const producto = lista[0];
    if (!conColor) return { fila, estado: "listo", producto, color: null, principal };
    // El color: por su código interno o por el nombre (sin importar mayúsculas ni acentos)
    const color = producto.colores.find((c) => skuPlano(c.sku_variante) === skuPlano(fila.sku_variante))
      ?? producto.colores.find((c) => plano(c.color) === plano(fila.color)) ?? null;
    if (!color) return { fila, estado: principal ? "listo" : "color_no_encontrado", producto, color: null, principal };
    return { fila, estado: "listo", producto, color, principal };
  });
}
