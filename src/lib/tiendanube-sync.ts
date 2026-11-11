// Sincronización sistema → tienda online (Tiendanube).
// - El sistema manda: nombre y categoría solo al crear; precio de lista y stock siempre.
// - Fotos y descripción se cargan en Tiendanube y nunca se pisan.
// - Stock online = el del local con más unidades, menos 1 de margen (si queda 1 sola, se publica 1).
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CredencialesTN, tn } from "./tiendanube";

export const CATEGORIAS_TIENDA = ["Cocina", "Mesa", "Cama", "Baño", "Living", "Decoración", "Accesorios y moda", "Carteras, billeteras y mochilas"];

/** Unidades a mostrar online según el stock de cada local. */
export function stockOnline(cantidades: number[]): number {
  const max = Math.max(0, ...cantidades.map((c) => Math.floor(Number(c) || 0)));
  return max >= 2 ? max - 1 : max;
}

/** Sugerencia de categoría de la tienda para una categoría del sistema (se puede cambiar a mano). */
export function sugerirCategoria(cat: string): string | null {
  const c = cat.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const reglas: [RegExp, string][] = [
    [/carter|billeter|mochil|bolso|riñon|rinon|neceser|monedero|marroquin/, "Carteras, billeteras y mochilas"],
    [/bijou|\baros?\b|collar|pulser|anillo|accesori|pelo|hebill|vincha|panuelo|bufand|lente|reloj|moda|beauty|maquill|cosmet/, "Accesorios y moda"],
    [/cocina|olla|sarten|utensil|cuchill|tabla|repost|especier|frasco|termo|mate|taza|jarro|vaso|copa|bazar/, "Cocina"],
    [/mesa|plato|bowl|fuente|individual|mantel|servillet|cubierto|bandeja/, "Mesa"],
    [/cama|sabana|acolchad|almohad|edred|frazada|manta|pie de cama|dormit/, "Cama"],
    [/bano|toall|alfombra de bano|cortina de bano|jabon|dispenser|higien/, "Baño"],
    [/living|almohadon|funda|alfombra|cortina|mueble|puff|silla|banco|manta/, "Living"],
    [/deco|vela|aroma|difusor|florero|maceta|planta|cuadro|espejo|portarretrat|adorno|canasto|cesto|lampar|velador/, "Decoración"],
  ];
  for (const [re, t] of reglas) if (re.test(c)) return t;
  return null;
}

type FilaProducto = {
  id: string; nombre: string; sku: string; barcode: string; categoria: string | null; precio_lista: number; activo: boolean;
  publicar_web: boolean; tn_producto_id: number | null; tn_variante_id: number | null; tn_precio: number | null; tn_stock: number | null; tn_publicado: boolean | null;
  stock: { local_id: number; cantidad: number }[];
};

type TNCategoria = { id: number; name: Record<string, string> | string; parent: number | null };
const nombreCat = (c: TNCategoria) => (typeof c.name === "string" ? c.name : c.name.es ?? Object.values(c.name)[0] ?? "");
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Llamada con pausa (la API permite ~2 por segundo) y reintento si responde "demasiadas". */
async function llamar<T>(c: CredencialesTN, ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      const r = await tn<T>(c, ruta, init);
      await espera(450);
      return r;
    } catch (e) {
      if (intento < 3 && /respondió 429/.test((e as Error).message)) { await espera(2000 * (intento + 1)); continue; }
      throw e;
    }
  }
}

/** Ids de las categorías de la tienda por nombre; crea las que falten. */
async function idsCategorias(c: CredencialesTN, nombres: string[]): Promise<Map<string, number>> {
  const lista: TNCategoria[] = [];
  for (let page = 1; page < 20; page++) {
    const p = await llamar<TNCategoria[]>(c, `/categories?per_page=200&page=${page}`).catch(() => [] as TNCategoria[]);
    lista.push(...p);
    if (p.length < 200) break;
  }
  const mapa = new Map(lista.map((x) => [nombreCat(x).trim().toLowerCase(), x.id]));
  const out = new Map<string, number>();
  for (const n of nombres) {
    let id = mapa.get(n.toLowerCase());
    if (!id) {
      const nueva = await llamar<TNCategoria>(c, "/categories", { method: "POST", body: { name: { es: n } } });
      id = nueva.id;
      mapa.set(n.toLowerCase(), id);
    }
    out.set(n, id);
  }
  return out;
}

export interface ResultadoSync { creados: number; actualizados: number; ocultos: number; errores: number; pendientes: number; detalleErrores: string[] }

/**
 * Lleva a la tienda lo que cambió. Trabaja hasta `hastaMs` (para no pasarse del tiempo de la tarea)
 * y deja el resto para la próxima vuelta.
 */
export async function sincronizarTienda(db: SupabaseClient, c: CredencialesTN, opciones: { hastaMs?: number; soloIds?: string[] } = {}): Promise<ResultadoSync> {
  const limite = Date.now() + (opciones.hastaMs ?? 90_000);
  const res: ResultadoSync = { creados: 0, actualizados: 0, ocultos: 0, errores: 0, pendientes: 0, detalleErrores: [] };

  let q = db.from("productos")
    .select("id, nombre, sku, barcode, categoria, precio_lista, activo, publicar_web, tn_producto_id, tn_variante_id, tn_precio, tn_stock, tn_publicado, stock(local_id, cantidad)")
    .or("publicar_web.eq.true,tn_producto_id.not.is.null")
    .limit(5000);
  if (opciones.soloIds?.length) q = q.in("id", opciones.soloIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const productos = (data ?? []) as unknown as FilaProducto[];

  // Qué hay que hacer con cada uno
  const tareas = productos.map((p) => {
    const quiere = p.publicar_web && p.activo;
    const precio = Math.round(Number(p.precio_lista) * 100) / 100;
    const stock = stockOnline((p.stock ?? []).map((s) => Number(s.cantidad)));
    const crear = quiere && !p.tn_producto_id;
    const visibilidad = !!p.tn_producto_id && (p.tn_publicado ?? true) !== quiere;
    const variante = !!p.tn_producto_id && quiere && (Number(p.tn_precio) !== precio || Number(p.tn_stock) !== stock);
    return { p, quiere, precio, stock, crear, visibilidad, variante };
  }).filter((t) => t.crear || t.visibilidad || t.variante);

  // Categorías (solo para los que hay que crear)
  let cats = new Map<string, number>();
  const aCrear = tareas.filter((t) => t.crear);
  if (aCrear.length) {
    const { data: eq } = await db.from("tn_categorias").select("categoria, tn_categoria");
    const equivalencia = new Map((eq ?? []).map((e) => [String(e.categoria), e.tn_categoria as string | null]));
    const nombres = [...new Set(aCrear.map((t) => (t.p.categoria ? equivalencia.get(t.p.categoria) ?? sugerirCategoria(t.p.categoria) : null)).filter((x): x is string => !!x))];
    cats = await idsCategorias(c, nombres);
    for (const t of aCrear) (t as typeof t & { catId?: number }).catId = (() => {
      const n = t.p.categoria ? equivalencia.get(t.p.categoria) ?? sugerirCategoria(t.p.categoria) : null;
      return n ? cats.get(n) : undefined;
    })();
  }

  for (const t of tareas) {
    if (Date.now() > limite) { res.pendientes++; continue; }
    const { p } = t;
    const cambios: Record<string, unknown> = { tn_sincronizado_en: new Date().toISOString(), tn_error: null };
    try {
      if (t.crear) {
        const catId = (t as typeof t & { catId?: number }).catId;
        const nuevo = await llamar<{ id: number; variants: { id: number }[] }>(c, "/products", {
          method: "POST",
          body: {
            name: { es: p.nombre },
            published: true,
            ...(catId ? { categories: [catId] } : {}),
            variants: [{ price: t.precio.toFixed(2), stock: t.stock, sku: p.sku || p.barcode, barcode: p.barcode }],
          },
        });
        Object.assign(cambios, { tn_producto_id: nuevo.id, tn_variante_id: nuevo.variants?.[0]?.id ?? null, tn_precio: t.precio, tn_stock: t.stock, tn_publicado: true });
        res.creados++;
      } else {
        if (t.visibilidad) {
          await llamar(c, `/products/${p.tn_producto_id}`, { method: "PUT", body: { published: t.quiere } });
          cambios.tn_publicado = t.quiere;
          if (!t.quiere) res.ocultos++;
        }
        if (t.variante && p.tn_variante_id) {
          await llamar(c, `/products/${p.tn_producto_id}/variants/${p.tn_variante_id}`, { method: "PUT", body: { price: t.precio.toFixed(2), stock: t.stock } });
          Object.assign(cambios, { tn_precio: t.precio, tn_stock: t.stock });
          res.actualizados++;
        }
      }
    } catch (e) {
      const m = (e as Error).message;
      // Si lo borraron en Tiendanube, se olvida el id y la próxima vuelta se vuelve a crear
      if (/respondió 404/.test(m)) Object.assign(cambios, { tn_producto_id: null, tn_variante_id: null, tn_precio: null, tn_stock: null, tn_publicado: null, tn_error: "No estaba en la tienda: se vuelve a crear." });
      else { cambios.tn_error = m.slice(0, 300); res.errores++; if (res.detalleErrores.length < 5) res.detalleErrores.push(`${p.nombre}: ${m.slice(0, 120)}`); }
    }
    await db.from("productos").update(cambios).eq("id", p.id);
  }
  return res;
}
