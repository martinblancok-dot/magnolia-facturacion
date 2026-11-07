// Importa ventas viejas de Aronium (el archivo lo arma scripts/aronium_a_json.py). Solo Martín y Sofi.
// Es seguro repetirlo: cada venta tiene un id fijo y si ya está, no se vuelve a cargar.
import { NextResponse } from "next/server";
import { claveCodigo } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export const maxDuration = 60;

type Item = { n: number; codigos: string[]; sku: string | null; nombre: string; cantidad: number; precio_unitario: number; total: number; costo: number | null };
type Venta = { id: string; numero: string; creada_en: string; medio_pago: string; total: number; total_lista: number; items: Item[] };
const MEDIOS = ["efectivo", "transferencia", "debito", "credito", "cuotas", "qr"];

async function soloDuenio() {
  const u = await usuarioDeLaSesion();
  if (!u) return null;
  return (await perfilDe(u.id)).rol === "duenio" ? u : null;
}

export async function POST(req: Request) {
  if (!(await soloDuenio())) return NextResponse.json({ error: "Solo Martín y Sofi pueden importar." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { local?: number; ventas?: Venta[] } | null;
  const local = Number(b?.local);
  if (![1, 2].includes(local) || !Array.isArray(b?.ventas) || b!.ventas.length > 500) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const ventas = b!.ventas.filter((v) => /^[0-9a-f-]{36}$/i.test(v.id) && !isNaN(Date.parse(v.creada_en)) && MEDIOS.includes(v.medio_pago) && Array.isArray(v.items));
  const db = clienteServidor();

  // Productos del sistema por código de barras (interno u original) y por SKU
  const codigos = [...new Set(ventas.flatMap((v) => v.items.flatMap((i) => i.codigos ?? [])))];
  const skus = [...new Set(ventas.flatMap((v) => v.items.map((i) => i.sku).filter(Boolean) as string[]))];
  const porCodigo = new Map<string, string>(), porSku = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += 300) {
    const lote = codigos.slice(i, i + 300);
    const [{ data: p }, alt] = await Promise.all([
      db.from("productos").select("id, barcode").in("barcode", lote),
      db.from("producto_codigos").select("producto_id, clave").in("clave", lote.map(claveCodigo)),
    ]);
    for (const x of p ?? []) porCodigo.set(claveCodigo(x.barcode), x.id);
    for (const x of alt.data ?? []) if (!porCodigo.has(x.clave)) porCodigo.set(x.clave, x.producto_id);
  }
  for (let i = 0; i < skus.length; i += 300) {
    const { data } = await db.from("productos").select("id, sku").in("sku", skus.slice(i, i + 300));
    for (const x of data ?? []) if (!porSku.has(x.sku.toLowerCase())) porSku.set(x.sku.toLowerCase(), x.id);
  }
  const producto = (i: Item) => {
    for (const c of i.codigos ?? []) { const id = porCodigo.get(claveCodigo(c)); if (id) return id; }
    return i.sku ? porSku.get(i.sku.toLowerCase()) ?? null : null;
  };

  // Ventas: las que ya estaban no se tocan
  const filas = ventas.map((v) => ({
    id: v.id, local_id: local, terminal: `Aronium ${String(v.numero ?? "").slice(0, 30)}`, creada_en: v.creada_en, medio_pago: v.medio_pago,
    total: Number(v.total), total_lista: Number(v.total_lista), origen: "aronium",
  }));
  const { data: nuevas, error } = await db.from("ventas").upsert(filas, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (error) return NextResponse.json({ error: /origen/.test(error.message) ? "Falta correr la migración 0022_ventas_importadas.sql en Supabase." : error.message }, { status: 500 });
  const cargar = new Set((nuevas ?? []).map((x) => x.id));
  const items = ventas.filter((v) => cargar.has(v.id)).flatMap((v) => v.items.map((i) => {
    const pid = producto(i);
    const cod = i.codigos?.[0] ?? null;
    return {
      venta_id: v.id, n: i.n, producto_id: pid, barcode: cod, sku: i.sku, nombre: String(i.nombre).slice(0, 200),
      cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), total: Number(i.total), costo: i.costo,
    };
  }));
  for (let i = 0; i < items.length; i += 1000) {
    const r = await db.from("venta_items").insert(items.slice(i, i + 1000));
    if (r.error) {
      // si fallan los productos de una venta, no queda la venta a medias
      await db.from("ventas").delete().in("id", [...cargar]);
      return NextResponse.json({ error: r.error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ recibidas: ventas.length, nuevas: cargar.size, conProducto: items.filter((x) => x.producto_id).length, items: items.length });
}

/** Lo que ya está importado, por local y mes (para comparar con Aronium). */
export async function GET() {
  if (!(await soloDuenio())) return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  const db = clienteServidor();
  const res: Record<string, Record<string, { ventas: number; total: number }>> = {};
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("ventas").select("local_id, creada_en, total").eq("origen", "aronium").order("id").range(i, i + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const v of data ?? []) {
      const m = new Date(Date.parse(v.creada_en) - 3 * 3600_000).toISOString().slice(0, 7);
      const x = ((res[v.local_id] ??= {})[m] ??= { ventas: 0, total: 0 });
      x.ventas++; x.total = Math.round((x.total + Number(v.total)) * 100) / 100;
    }
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json(res);
}
