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
    leidas.push({ archivo: a, sku, resto: sku ? plano(nombre.slice(sku.length)) : "" });
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
    // Color: el más largo cuyo nombre aparece entero en el archivo ("verde-agua" gana a "verde")
    const texto = `-${l.resto}-`;
    const color = [...p.colores].sort((a, b) => plano(b.color).length - plano(a.color).length)
      .find((c) => plano(c.color) && texto.includes(`-${plano(c.color)}-`)) ?? null;
    plan.push({ archivo: l.archivo, estado: "ok", productos: [p], principal, color, sinColor: !color && p.colores.length > 0 });
  }
  return { plan, ignoradas };
}
