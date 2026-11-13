// Fotos desde Tiendanube → sistema (para no cargar las fotos dos veces).
// - Foto del producto: la principal de Tiendanube (images[0]).
// - Foto de cada color: la imagen de su variante (image_id); si no tiene, la principal.
// - Se usa la miniatura que ya da la CDN de Tiendanube (-240-0 / -480-0); si no existe,
//   se baja la foto y se achica a 300x300 en el bucket, como las demás.
// - Una foto que se cargó a mano en el sistema no se pisa. Una que vino de Tiendanube se
//   actualiza solo si en Tiendanube cambió.
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { BUCKET_FOTOS, LADO_MINIATURA, MAX_BYTES_MINIATURA } from "./fotos";
import { type CredencialesTN, tn } from "./tiendanube";

type ImagenTN = { id: number; src: string; position?: number };
type ValorTN = Record<string, string> | string;
export type ProductoTN = {
  id: number;
  name?: ValorTN;
  images?: ImagenTN[];
  variants?: { id: number; sku?: string | null; barcode?: string | null; image_id?: number | null; values?: ValorTN[] }[];
};

type ProdSis = { id: string; sku: string | null; barcode: string; tn_producto_id: number | null; imagen_url: string | null; tn_imagen: string | null };
type VarSis = { id: string; producto_id: string; color: string; sku_variante: string; tn_variante_id: number | null; imagen_url: string | null; tn_imagen: string | null };

export interface ResultadoFotosTN {
  actualizadas: number;          // productos y colores con foto nueva o cambiada
  sinCambios: number;
  propias: number;               // ya tenían una foto cargada en el sistema: no se tocaron
  skuNoEncontrado: { nombre: string; skus: string[] }[];
  errores: string[];
  pendientes: boolean;           // se cortó por tiempo; sigue en la próxima vuelta
}

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const clave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\//g, "-");
const texto = (v: ValorTN | undefined) => (!v ? "" : typeof v === "string" ? v : v.es ?? Object.values(v)[0] ?? "");
const https = (src: string) => (src.startsWith("//") ? `https:${src}` : src.replace(/^http:/, "https:"));

/** Versiones chicas que da la CDN: "...-1024-1024.jpg" → "...-240-0.jpg" y "...-480-0.jpg". */
export function versionesChicas(src: string): string[] {
  const u = https(src);
  if (!/-\d+-\d+\.[a-z0-9]+(\?.*)?$/i.test(u)) return [];
  return ["240-0", "480-0"].map((t) => u.replace(/-\d+-\d+(\.[a-z0-9]+)(\?.*)?$/i, `-${t}$1`));
}

/** Producto del sistema que corresponde a uno de Tiendanube: por id publicado, por SKU/código, o por el SKU sin el sufijo de color. */
export function buscarProducto(p: ProductoTN, porTN: Map<number, ProdSis>, porCodigo: Map<string, ProdSis[]>): ProdSis | null {
  const ya = porTN.get(p.id);
  if (ya) return ya;
  const codigos = (p.variants ?? []).flatMap((v) => [v.sku, v.barcode]).map(clave).filter(Boolean);
  for (const c of codigos) { const l = porCodigo.get(c); if (l?.length === 1) return l[0]; }
  // ZA5977-ROS → ZA5977
  for (const c of codigos) {
    const base = c.replace(/-[a-z]+\d*$/, "");
    if (base !== c) { const l = porCodigo.get(base); if (l?.length === 1) return l[0]; }
  }
  return null;
}

/** Color del sistema que corresponde a una variante de Tiendanube. */
export function buscarColor(v: NonNullable<ProductoTN["variants"]>[number], colores: VarSis[]): VarSis | null {
  if (!colores.length) return null;
  const sku = clave(v.sku);
  const nombre = plano(texto(v.values?.[0]));
  const sufijo = sku.includes("-") ? sku.split("-").pop()! : "";
  return colores.find((c) => c.tn_variante_id && Number(c.tn_variante_id) === Number(v.id))
    ?? (sku ? colores.find((c) => clave(c.sku_variante) === sku) : undefined)
    ?? (nombre ? colores.find((c) => plano(c.color) === nombre) : undefined)
    ?? (sufijo && /^[a-z]+\d*$/.test(sufijo) ? colores.find((c) => clave(c.sku_variante).split("-").pop() === sufijo) : undefined)
    ?? null;
}

async function existe(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok && (r.headers.get("content-type") ?? "image").startsWith("image");
  } catch { return false; }
}

/** URL que se guarda: la miniatura de la CDN si existe; si no, una copia achicada en el bucket. */
async function miniaturaDe(db: SupabaseClient, src: string, nombre: string): Promise<string> {
  for (const u of versionesChicas(src)) if (await existe(u)) return u;
  const r = await fetch(https(src), { cache: "no-store" });
  if (!r.ok) throw new Error(`no se pudo bajar la foto (${r.status})`);
  const base = sharp(Buffer.from(await r.arrayBuffer()), { failOn: "none" }).rotate()
    .resize(LADO_MINIATURA, LADO_MINIATURA, { fit: "cover", position: "centre" }).flatten({ background: "#F5F2EE" });
  let webp: Buffer | null = null;
  for (const q of [82, 72, 62, 52, 42]) { const b = await base.clone().webp({ quality: q }).toBuffer(); if (b.length <= MAX_BYTES_MINIATURA) { webp = b; break; } }
  if (!webp) throw new Error("la foto no se pudo achicar");
  const ruta = `tn/${nombre}.webp`;
  const { error } = await db.storage.from(BUCKET_FOTOS).upload(ruta, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return `${db.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl}?v=${Date.now().toString(36)}`;
}

/** ¿Hay que poner esta foto? Sí si no tiene, o si la que tiene vino de Tiendanube y cambió. */
export function decidir(actual: { imagen_url: string | null; tn_imagen: string | null }, src: string): "poner" | "igual" | "propia" {
  if (!actual.imagen_url) return "poner";
  if (!actual.tn_imagen) return "propia";
  return actual.tn_imagen === src ? "igual" : "poner";
}

export async function traerFotosTN(db: SupabaseClient, c: CredencialesTN, opciones: { hastaMs?: number } = {}): Promise<ResultadoFotosTN> {
  const limite = Date.now() + (opciones.hastaMs ?? 50_000);
  const res: ResultadoFotosTN = { actualizadas: 0, sinCambios: 0, propias: 0, skuNoEncontrado: [], errores: [], pendientes: false };

  // Productos y colores del sistema
  const prods: ProdSis[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("productos").select("id, sku, barcode, tn_producto_id, imagen_url, tn_imagen").eq("activo", true).order("id").range(i, i + 999);
    if (error) throw new Error(/tn_imagen/.test(error.message) ? "Falta correr la migración 0034_fotos_tiendanube.sql en Supabase." : error.message);
    prods.push(...((data ?? []) as ProdSis[]));
    if (!data || data.length < 1000) break;
  }
  const vars: VarSis[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("producto_variantes").select("id, producto_id, color, sku_variante, tn_variante_id, imagen_url, tn_imagen").eq("activo", true).order("id").range(i, i + 999);
    if (error) break; // sin colores todavía
    vars.push(...((data ?? []) as VarSis[]));
    if (!data || data.length < 1000) break;
  }
  const porTN = new Map(prods.filter((p) => p.tn_producto_id).map((p) => [Number(p.tn_producto_id), p]));
  const porCodigo = new Map<string, ProdSis[]>();
  for (const p of prods) for (const k of new Set([clave(p.sku), clave(p.barcode)].filter(Boolean))) porCodigo.set(k, [...(porCodigo.get(k) ?? []), p]);
  const coloresDe = new Map<string, VarSis[]>();
  for (const v of vars) coloresDe.set(v.producto_id, [...(coloresDe.get(v.producto_id) ?? []), v]);

  const ahora = () => new Date().toISOString();
  for (let page = 1; page < 100; page++) {
    if (Date.now() > limite) { res.pendientes = true; break; }
    let lista: ProductoTN[];
    try { lista = await tn<ProductoTN[]>(c, `/products?per_page=200&page=${page}&fields=id,name,images,variants`); }
    catch (e) { if (/respondió 404/.test((e as Error).message)) break; throw e; }
    for (const p of lista) {
      if (Date.now() > limite) { res.pendientes = true; break; }
      const imagenes = [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const principal = imagenes[0];
      if (!principal) continue; // sin fotos en la tienda
      const prod = buscarProducto(p, porTN, porCodigo);
      if (!prod) {
        res.skuNoEncontrado.push({ nombre: texto(p.name) || `Producto ${p.id}`, skus: (p.variants ?? []).map((v) => v.sku ?? "").filter(Boolean) });
        continue;
      }
      try {
        // Foto del producto
        const src = https(principal.src);
        const d = decidir(prod, src);
        if (d === "poner") {
          const url = await miniaturaDe(db, src, `${p.id}-${principal.id}`);
          await db.from("productos").update({ imagen_url: url, tn_imagen: src, actualizado_en: ahora() }).eq("id", prod.id);
          res.actualizadas++;
        } else if (d === "igual") res.sinCambios++; else res.propias++;

        // Foto de cada color
        const colores = coloresDe.get(prod.id) ?? [];
        for (const v of p.variants ?? []) {
          const color = buscarColor(v, colores);
          if (!color) continue;
          const img = imagenes.find((x) => Number(x.id) === Number(v.image_id)) ?? principal;
          const srcV = https(img.src);
          const dv = decidir(color, srcV);
          if (dv === "poner") {
            const url = await miniaturaDe(db, srcV, `${p.id}-${img.id}`);
            await db.from("producto_variantes").update({ imagen_url: url, tn_imagen: srcV, actualizado_en: ahora() }).eq("id", color.id);
            await db.from("productos").update({ actualizado_en: ahora() }).eq("id", prod.id); // que la caja baje la foto nueva
            res.actualizadas++;
          } else if (dv === "igual") res.sinCambios++; else res.propias++;
        }
      } catch (e) {
        if (res.errores.length < 10) res.errores.push(`${texto(p.name)}: ${(e as Error).message}`);
      }
    }
    if (res.pendientes || lista.length < 200) break;
  }
  await db.from("ajustes").upsert({ clave: "tn_fotos_ultima", valor: JSON.stringify({ cuando: ahora(), ...res, skuNoEncontrado: res.skuNoEncontrado.slice(0, 100) }), actualizado_en: ahora() });
  return res;
}

/** En la sincronización automática: como mucho una vez por hora (recorrer toda la tienda lleva tiempo). */
export async function traerFotosSiToca(db: SupabaseClient, c: CredencialesTN, hastaMs: number): Promise<ResultadoFotosTN | null> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "tn_fotos_ultima").maybeSingle();
  try {
    const u = data ? JSON.parse(data.valor) : null;
    if (u?.cuando && !u.pendientes && Date.now() - Date.parse(u.cuando) < 3600_000) return null;
  } catch {}
  return traerFotosTN(db, c, { hastaMs });
}
