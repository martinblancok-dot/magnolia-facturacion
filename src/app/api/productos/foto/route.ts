// Subir o quitar la miniatura de un producto. Solo Martín y Sofi (los dueños).
// POST (formulario): "foto" (la imagen achicada en la compu) y "producto_id" o "archivo" (nombre del archivo
//   para asociar solo: SKU, con guion en vez de barra, o código de barras).
// DELETE ?producto_id=…: quita la foto.
import sharp from "sharp";
import { NextResponse } from "next/server";
import { adminDesbloqueado } from "@/lib/admin";
import { claveCodigo } from "@/lib/caja";
import { BUCKET_FOTOS, LADO_MINIATURA, MAX_BYTES_MINIATURA, codigoDeArchivo, nombreFoto, rutaCorta, skusPosibles } from "@/lib/fotos";
import { clienteServidor } from "@/lib/supabase/almacen";

export const maxDuration = 30;

type Prod = { id: string; sku: string; barcode: string; nombre: string; imagen_url: string | null };
const COLS = "id, sku, barcode, nombre, imagen_url";

/** .webp de 300x300 y menos de 40 KB (baja la calidad de a poco hasta que entre). */
async function miniatura(entrada: Buffer): Promise<Buffer> {
  const base = sharp(entrada, { failOn: "none" }).rotate().resize(LADO_MINIATURA, LADO_MINIATURA, { fit: "cover", position: "centre" }).flatten({ background: "#F5F2EE" });
  for (const q of [82, 72, 62, 52, 42, 32]) {
    const b = await base.clone().webp({ quality: q, effort: 4 }).toBuffer();
    if (b.length <= MAX_BYTES_MINIATURA) return b;
  }
  throw new Error("La foto no se pudo achicar a menos de 40 KB");
}

/** Productos que corresponden a un nombre de archivo: primero por SKU, si no por código de barras. */
async function buscarPorArchivo(db: ReturnType<typeof clienteServidor>, archivo: string): Promise<Prod[]> {
  const codigo = codigoDeArchivo(archivo);
  if (!codigo) return [];
  const encontrados = new Map<string, Prod>();
  for (const sku of skusPosibles(codigo)) {
    // ilike sin comodines = igual sin importar mayúsculas (se escapan % y _ por si el nombre los tiene)
    const { data } = await db.from("productos").select(COLS).eq("activo", true).ilike("sku", sku.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(10);
    for (const p of data ?? []) encontrados.set(p.id, p as Prod);
  }
  if (encontrados.size) return [...encontrados.values()];
  const { data } = await db.from("productos").select(COLS).eq("activo", true).eq("barcode", codigo).limit(10);
  if (data?.length) return data as Prod[];
  // Códigos de barras numéricos: sin importar los ceros adelante
  const clave = claveCodigo(codigo);
  if (clave !== codigo) {
    const r = await db.from("productos").select(COLS).eq("activo", true).eq("barcode", clave).limit(10);
    if (r.data?.length) return r.data as Prod[];
  }
  return [];
}

export async function POST(req: Request) {
  if (!(await adminDesbloqueado())) return NextResponse.json({ error: "Solo Martín y Sofi pueden cargar fotos." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const foto = form?.get("foto");
  if (!(foto instanceof Blob) || !foto.size) return NextResponse.json({ error: "Falta la foto." }, { status: 400 });
  if (foto.size > 4 * 1024 * 1024) return NextResponse.json({ error: "La foto es muy pesada." }, { status: 400 });
  const db = clienteServidor();

  let producto: Prod | null = null;
  const id = String(form?.get("producto_id") ?? "");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Producto inválido." }, { status: 400 });
    const { data } = await db.from("productos").select(COLS).eq("id", id).maybeSingle();
    producto = (data as Prod) ?? null;
    if (!producto) return NextResponse.json({ estado: "sin_producto", error: "No existe ese producto." }, { status: 404 });
  } else {
    const archivo = String(form?.get("archivo") ?? "");
    const lista = await buscarPorArchivo(db, archivo);
    if (!lista.length) return NextResponse.json({ estado: "sin_producto", codigo: codigoDeArchivo(archivo) });
    // Más de un producto con ese código: no se elige solo, lo decide el usuario
    if (lista.length > 1) return NextResponse.json({ estado: "varios", codigo: codigoDeArchivo(archivo), productos: lista.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, nombre: p.nombre })) });
    producto = lista[0];
  }

  let webp: Buffer;
  try { webp = await miniatura(Buffer.from(await foto.arrayBuffer())); }
  catch (e) { return NextResponse.json({ error: `No se pudo convertir la foto: ${(e as Error).message}` }, { status: 400 }); }

  // reemplazar=0: si ya tiene foto, no se toca (para importar sin pisar lo que ya estaba)
  const reemplazar = form?.get("reemplazar") !== "0";
  const principal = form?.get("principal") !== "0";
  const ahora = new Date().toISOString();

  // Foto de un color (se llama como el código del color: 1954-3-NEG.webp)
  const varId = String(form?.get("variante_id") ?? "");
  let color: { id: string; color: string; url: string } | null = null;
  let colorYaTenia = false;
  if (varId) {
    if (!/^[0-9a-f-]{36}$/i.test(varId)) return NextResponse.json({ error: "Color inválido." }, { status: 400 });
    const { data: v, error: ev } = await db.from("producto_variantes").select("id, color, sku_variante, imagen_url").eq("id", varId).eq("producto_id", producto.id).maybeSingle();
    if (ev) return NextResponse.json({ error: /imagen_url/.test(ev.message) ? "Falta correr la migración 0033_fotos_colores.sql en Supabase." : ev.message }, { status: 500 });
    if (!v) return NextResponse.json({ error: "Ese color no es de ese producto." }, { status: 400 });
    if (v.imagen_url && !reemplazar) colorYaTenia = true;
    else {
      const rutaColor = `${nombreFoto(v.sku_variante, producto.barcode)}-${v.id.slice(0, 6)}.webp`;
      const { error: e1 } = await db.storage.from(BUCKET_FOTOS).upload(rutaColor, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
      const urlColor = `${db.storage.from(BUCKET_FOTOS).getPublicUrl(rutaColor).data.publicUrl}?v=${Date.now().toString(36)}`;
      await db.from("producto_variantes").update({ imagen_url: urlColor, actualizado_en: ahora }).eq("id", v.id);
      await db.from("producto_variantes").update({ tn_imagen: null }).eq("id", v.id); // cargada a mano: la de Tiendanube no la pisa
      color = { id: v.id, color: v.color, url: urlColor };
    }
  }
  const prodYaTenia = !!producto.imagen_url && !reemplazar;
  // Solo la del color (o la principal ya tenía y no se pisa)
  if (!principal || prodYaTenia) {
    if (color) await db.from("productos").update({ actualizado_en: ahora }).eq("id", producto.id); // que la caja baje la foto nueva
    const nada = !color && (colorYaTenia || prodYaTenia || !varId);
    return NextResponse.json({
      estado: nada ? "ya_tenia" : "ok", producto: { id: producto.id, sku: producto.sku, nombre: producto.nombre },
      url: color?.url ?? null, color, bytes: webp.length, reemplazo: false,
    });
  }

  // Se llama como el SKU. Si otro producto tiene el mismo SKU, se le agrega un pedacito del id para no pisarse.
  let ruta = `${nombreFoto(producto.sku, producto.barcode)}.webp`;
  if (producto.sku) {
    const { count } = await db.from("productos").select("id", { count: "exact", head: true }).ilike("sku", producto.sku.replace(/[%_\\]/g, (c) => `\\${c}`)).neq("id", producto.id);
    if (count) ruta = `${nombreFoto(producto.sku, producto.barcode)}-${producto.id.slice(0, 8)}.webp`;
  }
  const anterior = rutaCorta(producto.imagen_url)?.split("?")[0];
  const { error: errSubida } = await db.storage.from(BUCKET_FOTOS).upload(ruta, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
  if (errSubida) {
    const falta = /bucket/i.test(errSubida.message) && /not found/i.test(errSubida.message);
    return NextResponse.json({ error: falta ? "Falta correr la migración 0031_fotos_productos.sql en Supabase." : errSubida.message }, { status: 500 });
  }
  if (anterior && anterior !== ruta) await db.storage.from(BUCKET_FOTOS).remove([anterior]); // quedó con otro nombre
  // ?v= para que las compus no sigan mostrando la foto anterior si se reemplaza
  const url = `${db.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl}?v=${Date.now().toString(36)}`;
  const { error } = await db.from("productos").update({ imagen_url: url, actualizado_en: ahora }).eq("id", producto.id);
  if (!error) await db.from("productos").update({ tn_imagen: null }).eq("id", producto.id); // cargada a mano: la de Tiendanube no la pisa
  if (error) return NextResponse.json({ error: /imagen_url/.test(error.message) ? "Falta correr la migración 0031_fotos_productos.sql en Supabase." : error.message }, { status: 500 });
  return NextResponse.json({ estado: "ok", producto: { id: producto.id, sku: producto.sku, nombre: producto.nombre }, url, color, bytes: webp.length, reemplazo: !!producto.imagen_url });
}

export async function DELETE(req: Request) {
  if (!(await adminDesbloqueado())) return NextResponse.json({ error: "Solo Martín y Sofi pueden quitar fotos." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("producto_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Producto inválido." }, { status: 400 });
  const db = clienteServidor();
  const { data: p } = await db.from("productos").select(COLS).eq("id", id).maybeSingle();
  if (!p) return NextResponse.json({ error: "No existe ese producto." }, { status: 404 });
  const prod = p as Prod;
  const ruta = rutaCorta(prod.imagen_url)?.split("?")[0];
  if (ruta) await db.storage.from(BUCKET_FOTOS).remove([ruta]);
  const { error } = await db.from("productos").update({ imagen_url: null, actualizado_en: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
