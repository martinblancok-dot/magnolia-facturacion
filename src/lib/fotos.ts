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
