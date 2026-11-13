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
