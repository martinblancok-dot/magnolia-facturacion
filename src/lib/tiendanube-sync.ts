// Sincronización sistema → tienda online (Tiendanube).
// - El sistema manda: nombre y categoría solo al crear; precio de lista y stock siempre.
// - Fotos y descripción se cargan en Tiendanube y nunca se pisan.
// - Stock online = el del local con más unidades, menos 1 de margen (si queda 1 sola, se publica 1).
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CredencialesTN, tn } from "./tiendanube";

/** Categorías de la tienda: principal → subcategorías (así están creadas en Tiendanube). */
export const ARBOL_TIENDA: Record<string, string[]> = {
  "Cocina": ["Utensilios", "Cocción", "Pavas y cafeteras", "Tablas", "Fuentes y tuppers", "Frascos y condimenteros", "Termos y mates"],
  "Mesa": ["Platos", "Bowls y ensaladeras", "Copas y vasos", "Mugs y tazas", "Fruteras", "Manteles"],
  "Cama": ["Sábanas", "Acolchados y edredones"],
  "Baño": ["Sets y dispensers", "Cortinas de baño"],
  "Living": ["Almohadones", "Cortinas"],
  "Decoración": ["Velas", "Home spray y difusores", "Floreros", "Espejos", "Lámparas", "Cuadros"],
  "Accesorios y moda": [],
  "Carteras, billeteras y mochilas": [],
};
/** Todas, para elegir en las equivalencias (las subcategorías ya incluyen su principal al publicar). */
export const CATEGORIAS_TIENDA = Object.entries(ARBOL_TIENDA).flatMap(([p, hijas]) => [p, ...hijas]);

/** Unidades a mostrar online según el stock de cada local. */
export function stockOnline(cantidades: number[]): number {
  const max = Math.max(0, ...cantidades.map((c) => Math.floor(Number(c) || 0)));
  return max >= 2 ? max - 1 : max;
}

/** Sugerencia de categoría de la tienda para una categoría del sistema (se puede cambiar a mano). */
export function sugerirCategoria(cat: string): string | null {
  const c = cat.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const reglas: [RegExp, string][] = [
    [/carter|billeter|mochil|bolso|rinon|neceser|monedero|marroquin/, "Carteras, billeteras y mochilas"],
    [/bijou|\baros?\b|collar|pulser|anillo|accesori|pelo|hebill|vincha|panuelo|bufand|lente|reloj|moda|beauty|maquill|cosmet/, "Accesorios y moda"],
    [/pava|cafeter/, "Pavas y cafeteras"],
    [/termo|\bmates?\b|bombill/, "Termos y mates"],
    [/frasco|condiment|especier/, "Frascos y condimenteros"],
    [/tabla/, "Tablas"],
    [/fuente|tupper|hermetic/, "Fuentes y tuppers"],
    [/olla|sarten|cacerol|coccion|bifera|budinera|tartera|asadera/, "Cocción"],
    [/utensil|cuchar|espatul|cucharon|pinza|rallador|colador|cuchill|secaplato/, "Utensilios"],
    [/mug|taza|jarro/, "Mugs y tazas"],
    [/copa|vaso/, "Copas y vasos"],
    [/bowl|ensalader|compotera/, "Bowls y ensaladeras"],
    [/frutera/, "Fruteras"],
    [/mantel|individual|camino de mesa|servillet/, "Manteles"],
    [/plato|vajilla/, "Platos"],
    [/sabana|juego de cama/, "Sábanas"],
    [/acolchad|edred|cubrecama|frazada/, "Acolchados y edredones"],
    [/cortina.*bano|bano.*cortina/, "Cortinas de baño"],
    [/dispenser|set de bano|jabon|portacepillo/, "Sets y dispensers"],
    [/almohad|funda/, "Almohadones"],
    [/cortina/, "Cortinas"],
    [/vela/, "Velas"],
    [/home spray|difusor|aroma|sahum/, "Home spray y difusores"],
    [/florero|jarron/, "Floreros"],
    [/espejo/, "Espejos"],
    [/lampar|velador|ilumin/, "Lámparas"],
    [/cuadro|lamina|portarretrat/, "Cuadros"],
    [/cocina|bazar|repost/, "Cocina"],
    [/mesa/, "Mesa"],
    [/cama|dormit|blanquer/, "Cama"],
    [/bano|toall/, "Baño"],
    [/living|alfombra|manta|puff|mueble/, "Living"],
    [/deco|maceta|planta|adorno|canasto|cesto/, "Decoración"],
  ];
  for (const [re, t] of reglas) if (re.test(c)) return t;
  return null;
}

type FilaProducto = {
  id: string; nombre: string; sku: string; barcode: string; categoria: string | null; precio_lista: number; activo: boolean;
  publicar_web: boolean; tn_producto_id: number | null; tn_variante_id: number | null; tn_precio: number | null; tn_stock: number | null; tn_publicado: boolean | null;
  stock: { local_id: number; cantidad: number }[];
  producto_variantes?: FilaColor[];
};
type FilaColor = {
  id: string; color: string; sku_variante: string; activo: boolean; orden: number;
  tn_variante_id: number | null; tn_precio: number | null; tn_stock: number | null;
  stock_variantes: { local_id: number; cantidad: number }[];
};

type TNCategoria = { id: number; name: Record<string, string> | string; parent: number | null };
type IdsCat = Map<string, number[]>; // nombre → [id, ids de sus padres]
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
async function idsCategorias(c: CredencialesTN, nombres: string[]): Promise<IdsCat> {
  const lista: TNCategoria[] = [];
  for (let page = 1; page < 20; page++) {
    const p = await llamar<TNCategoria[]>(c, `/categories?per_page=200&page=${page}`).catch(() => [] as TNCategoria[]);
    lista.push(...p);
    if (p.length < 200) break;
  }
  const mapa = new Map(lista.map((x) => [nombreCat(x).trim().toLowerCase(), x.id]));
  const padre = new Map(lista.map((x) => [x.id, x.parent || 0]));
  const out: IdsCat = new Map();
  for (const n of nombres) {
    let id = mapa.get(n.toLowerCase());
    if (!id) {
      const nueva = await llamar<TNCategoria>(c, "/categories", { method: "POST", body: { name: { es: n } } });
      id = nueva.id;
      mapa.set(n.toLowerCase(), id);
    }
    const cadena = [id];
    for (let p = padre.get(id) ?? 0, i = 0; p && i < 5; p = padre.get(p) ?? 0, i++) cadena.push(p);
    out.set(n, cadena);
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

  const base = "id, nombre, sku, barcode, categoria, precio_lista, activo, publicar_web, tn_producto_id, tn_variante_id, tn_precio, tn_stock, tn_publicado, stock(local_id, cantidad)";
  const traer = (cols: string) => {
    let q = db.from("productos").select(cols).or("publicar_web.eq.true,tn_producto_id.not.is.null").limit(5000);
    if (opciones.soloIds?.length) q = q.in("id", opciones.soloIds);
    return q;
  };
  // Con colores si ya está la migración 0032
  let r = await traer(`${base}, producto_variantes(id, color, sku_variante, activo, orden, tn_variante_id, tn_precio, tn_stock, stock_variantes(local_id, cantidad))`);
  if (r.error && /producto_variantes/.test(r.error.message)) r = await traer(base);
  if (r.error) throw new Error(r.error.message);
  const productos = (r.data ?? []) as unknown as FilaProducto[];

  // Qué hay que hacer con cada uno
  const tareas = productos.map((p) => {
    const quiere = p.publicar_web && p.activo;
    const precio = Math.round(Number(p.precio_lista) * 100) / 100;
    const stock = stockOnline((p.stock ?? []).map((s) => Number(s.cantidad)));
    const crear = quiere && !p.tn_producto_id;
    const visibilidad = !!p.tn_producto_id && (p.tn_publicado ?? true) !== quiere;
    const plan = planColoresTN(p.producto_variantes ?? [], precio);
    const conColores = plan.activos.length > 0;
    const variante = !!p.tn_producto_id && quiere && (conColores
      ? plan.cambios.length > 0
      : Number(p.tn_precio) !== precio || Number(p.tn_stock) !== stock);
    return { p, quiere, precio, stock, crear, visibilidad, variante, plan, conColores };
  }).filter((t) => t.crear || t.visibilidad || t.variante);

  // Categorías (solo para los que hay que crear)
  let cats: IdsCat = new Map();
  const aCrear = tareas.filter((t) => t.crear);
  if (aCrear.length) {
    const { data: eq } = await db.from("tn_categorias").select("categoria, tn_categoria");
    const equivalencia = new Map((eq ?? []).map((e) => [String(e.categoria), e.tn_categoria as string | null]));
    const nombres = [...new Set(aCrear.map((t) => (t.p.categoria ? equivalencia.get(t.p.categoria) ?? sugerirCategoria(t.p.categoria) : null)).filter((x): x is string => !!x))];
    cats = await idsCategorias(c, nombres);
    for (const t of aCrear) (t as typeof t & { catIds?: number[] }).catIds = (() => {
      const n = t.p.categoria ? equivalencia.get(t.p.categoria) ?? sugerirCategoria(t.p.categoria) : null;
      return n ? cats.get(n) : undefined;
    })();
  }

  for (const t of tareas) {
    if (Date.now() > limite) { res.pendientes++; continue; }
    const { p } = t;
    const cambios: Record<string, unknown> = { tn_sincronizado_en: new Date().toISOString(), tn_error: null };
    try {
      if (t.crear && t.conColores) {
        // Producto con colores: atributo "Color" y una variante por color (con el código interno de cada color)
        const catIds = (t as typeof t & { catIds?: number[] }).catIds;
        const nuevo = await llamar<{ id: number; variants: { id: number; sku: string | null }[] }>(c, "/products", {
          method: "POST",
          body: {
            name: { es: p.nombre },
            published: true,
            ...(catIds?.length ? { categories: catIds } : {}),
            attributes: [{ es: "Color" }],
            variants: t.plan.activos.map((v) => ({ price: t.precio.toFixed(2), stock: v.stockOnline, sku: v.sku_variante, barcode: p.barcode, values: [{ es: v.color }] })),
          },
        });
        for (const v of t.plan.activos) {
          const tnv = nuevo.variants?.find((x) => x.sku === v.sku_variante);
          if (tnv) await db.from("producto_variantes").update({ tn_variante_id: tnv.id, tn_precio: t.precio, tn_stock: v.stockOnline }).eq("id", v.id);
        }
        Object.assign(cambios, { tn_producto_id: nuevo.id, tn_variante_id: null, tn_precio: t.precio, tn_stock: t.stock, tn_publicado: true });
        res.creados++;
      } else if (t.crear) {
        const catIds = (t as typeof t & { catIds?: number[] }).catIds;
        const nuevo = await llamar<{ id: number; variants: { id: number }[] }>(c, "/products", {
          method: "POST",
          body: {
            name: { es: p.nombre },
            published: true,
            ...(catIds?.length ? { categories: catIds } : {}),
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
        if (t.variante && t.conColores) {
          await actualizarColoresTN(db, c, p, t.plan, t.precio);
          Object.assign(cambios, { tn_variante_id: null, tn_precio: t.precio, tn_stock: t.stock });
          res.actualizados++;
        } else if (t.variante && p.tn_variante_id) {
          await llamar(c, `/products/${p.tn_producto_id}/variants/${p.tn_variante_id}`, { method: "PUT", body: { price: t.precio.toFixed(2), stock: t.stock } });
          Object.assign(cambios, { tn_precio: t.precio, tn_stock: t.stock });
          res.actualizados++;
        }
      }
    } catch (e) {
      const m = (e as Error).message;
      // Si lo borraron en Tiendanube, se olvida el id y la próxima vuelta se vuelve a crear
      if (/respondió 404/.test(m)) {
        Object.assign(cambios, { tn_producto_id: null, tn_variante_id: null, tn_precio: null, tn_stock: null, tn_publicado: null, tn_error: "No estaba en la tienda: se vuelve a crear." });
        if (p.producto_variantes?.length) await db.from("producto_variantes").update({ tn_variante_id: null, tn_precio: null, tn_stock: null }).eq("producto_id", p.id);
      }
      else { cambios.tn_error = m.slice(0, 300); res.errores++; if (res.detalleErrores.length < 5) res.detalleErrores.push(`${p.nombre}: ${m.slice(0, 120)}`); }
    }
    await db.from("productos").update(cambios).eq("id", p.id);
  }
  return res;
}

/** Qué colores hay que crear o actualizar en la tienda. Los colores dados de baja quedan con stock 0 (no se borran). */
export function planColoresTN(colores: FilaColor[], precio: number) {
  const activos = colores.filter((v) => v.activo).sort((a, b) => a.orden - b.orden || a.color.localeCompare(b.color))
    .map((v) => ({ ...v, stockOnline: stockOnline((v.stock_variantes ?? []).map((s) => Number(s.cantidad))) }));
  const cambios = [
    ...activos.filter((v) => !v.tn_variante_id || Number(v.tn_precio) !== precio || Number(v.tn_stock) !== v.stockOnline),
    ...colores.filter((v) => !v.activo && v.tn_variante_id && Number(v.tn_stock) !== 0).map((v) => ({ ...v, stockOnline: 0 })),
  ];
  return { activos, cambios };
}

/** Producto ya publicado: crea los colores que faltan y actualiza precio y stock de cada uno. */
async function actualizarColoresTN(db: SupabaseClient, c: CredencialesTN, p: FilaProducto, plan: ReturnType<typeof planColoresTN>, precio: number) {
  const ruta = `/products/${p.tn_producto_id}`;
  const yaTieneColores = (p.producto_variantes ?? []).some((v) => v.tn_variante_id);
  let reusar = !yaTieneColores ? p.tn_variante_id : null; // la variante única que tenía antes de tener colores
  if (!yaTieneColores) await llamar(c, ruta, { method: "PUT", body: { attributes: [{ es: "Color" }] } });
  for (const v of plan.cambios) {
    const datos = { price: precio.toFixed(2), stock: v.stockOnline };
    let id = v.tn_variante_id;
    if (id) {
      await llamar(c, `${ruta}/variants/${id}`, { method: "PUT", body: datos });
    } else if (reusar) {
      await llamar(c, `${ruta}/variants/${reusar}`, { method: "PUT", body: { ...datos, sku: v.sku_variante, values: [{ es: v.color }] } });
      id = reusar;
      reusar = null;
    } else {
      const nueva = await llamar<{ id: number }>(c, `${ruta}/variants`, { method: "POST", body: { ...datos, sku: v.sku_variante, barcode: p.barcode, values: [{ es: v.color }] } });
      id = nueva.id;
    }
    await db.from("producto_variantes").update({ tn_variante_id: id, tn_precio: precio, tn_stock: v.stockOnline }).eq("id", v.id);
  }
}
