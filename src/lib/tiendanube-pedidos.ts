// Pedidos de la tienda online (Tiendanube) → sistema.
// - Cada producto sale del local que más unidades tiene (si empatan, el local donde retira el cliente).
// - El stock se descuenta al entrar el pedido y se devuelve si se cancela.
// - La caja de ese local ve el aviso para prepararlo cuando el pago está aprobado.
// Entran por dos caminos: el aviso inmediato de Tiendanube (webhook) y una revisión en la
// tarea automática por si algún aviso se perdió. Procesar el mismo pedido dos veces no duplica nada.
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CredencialesTN, tn } from "./tiendanube";

export type EstadoPedido = "pendiente_pago" | "a_preparar" | "preparado" | "entregado" | "cancelado";

export const NOMBRE_ESTADO: Record<EstadoPedido, string> = {
  pendiente_pago: "Esperando el pago",
  a_preparar: "A preparar",
  preparado: "Preparado",
  entregado: "Entregado / despachado",
  cancelado: "Cancelado",
};

/** Lo que usamos de un pedido de Tiendanube (la API manda mucho más). */
export interface PedidoTN {
  id: number;
  number: number;
  status?: string;                 // open | closed | cancelled
  payment_status?: string;         // pending | authorized | paid | voided | refunded | abandoned
  shipping_status?: string;        // unpacked | unfulfilled | fulfilled | shipped | delivered …
  created_at: string;
  updated_at?: string;
  paid_at?: string | null;
  total?: string | number;
  gateway_name?: string | null;
  payment_details?: { method?: string | null } | null;
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  note?: string | null;
  shipping_pickup_type?: string | null;   // ship | pickup
  shipping_option?: string | null;
  shipping_pickup_details?: { name?: string | null; address?: Record<string, unknown> | null } | null;
  shipping_address?: { address?: string | null; number?: string | null; floor?: string | null; locality?: string | null; city?: string | null; province?: string | null; zipcode?: string | null } | null;
  products?: { product_id?: number; variant_id?: number; name?: string | Record<string, string>; quantity?: number | string; price?: number | string; sku?: string | null; barcode?: string | null }[];
}

/** Local donde retira el cliente, según el nombre o la dirección del punto de retiro. */
export function localDeRetiro(p: Pick<PedidoTN, "shipping_pickup_type" | "shipping_option" | "shipping_pickup_details">): number | null {
  if (p.shipping_pickup_type !== "pickup") return null;
  const texto = [p.shipping_option, p.shipping_pickup_details?.name, JSON.stringify(p.shipping_pickup_details?.address ?? "")]
    .filter(Boolean).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b784\b|beauty/.test(texto)) return 2;
  if (/\b1031\b|home|deco/.test(texto)) return 1;
  return null;
}

/** De qué local sale un producto: el que más unidades tiene; si empatan, donde retira el cliente, si no Home. */
export function elegirLocal(stockPorLocal: Partial<Record<number, number>>, preferido: number | null): number {
  const locales = [1, 2];
  const cant = (l: number) => Number(stockPorLocal[l] ?? 0);
  const max = Math.max(...locales.map(cant));
  const candidatos = locales.filter((l) => cant(l) === max);
  if (preferido && candidatos.includes(preferido)) return preferido;
  return candidatos[0];
}

/** Estado del pedido en el sistema según lo que dice Tiendanube y lo que ya se hizo en el local. */
export function siguienteEstado(actual: EstadoPedido | null, p: { cancelado: boolean; pagado: boolean; despachado: boolean }): EstadoPedido {
  if (p.cancelado) return "cancelado";
  if (actual === "entregado") return actual;
  if (p.despachado) return "entregado";
  if (actual === "cancelado") return p.pagado ? "a_preparar" : "pendiente_pago"; // lo reabrieron en Tiendanube
  if (actual === "preparado") return actual;
  if (p.pagado) return "a_preparar";
  return actual === "a_preparar" ? actual : "pendiente_pago";
}

const nombreProducto = (n: unknown) => (typeof n === "string" ? n : n && typeof n === "object" ? String((n as Record<string, string>).es ?? Object.values(n)[0] ?? "") : "");

function leerPedido(p: PedidoTN) {
  const pagado = ["paid", "authorized"].includes(String(p.payment_status));
  const cancelado = p.status === "cancelled" || ["voided", "refunded", "abandoned"].includes(String(p.payment_status));
  const despachado = ["shipped", "delivered"].includes(String(p.shipping_status)) || p.status === "closed";
  const retiro = p.shipping_pickup_type === "pickup";
  const dir = p.shipping_address;
  return {
    pagado, cancelado, despachado,
    fila: {
      numero: Number(p.number),
      pago: p.payment_status ?? null,
      medio: p.payment_details?.method || p.gateway_name || null,
      entrega: retiro ? "retiro" : "envio",
      entrega_detalle: (retiro ? p.shipping_pickup_details?.name || p.shipping_option : p.shipping_option) ?? null,
      retira_local: localDeRetiro(p),
      cliente: p.customer?.name || p.contact_name || null,
      telefono: p.contact_phone || p.customer?.phone || null,
      email: p.contact_email || p.customer?.email || null,
      direccion: !retiro && dir ? [[dir.address, dir.number].filter(Boolean).join(" "), dir.floor, dir.locality, dir.city, dir.province, dir.zipcode && `CP ${dir.zipcode}`].filter(Boolean).join(", ") : null,
      nota: p.note || null,
      total: Number(p.total) || 0,
      creado_en: p.created_at,
      actualizado_tn: p.updated_at ?? p.created_at,
    },
  };
}

type Prod = { id: string; tn_producto_id: number | null; tn_variante_id: number | null; sku: string; barcode: string; stock: { local_id: number; cantidad: number }[] };

/** Guarda o actualiza un pedido. Devuelve qué pasó, para el informe. */
export async function guardarPedido(db: SupabaseClient, p: PedidoTN): Promise<"nuevo" | "actualizado" | "sin cambios" | "cancelado"> {
  const { pagado, cancelado, despachado, fila } = leerPedido(p);
  const { data: previo, error: errPrevio } = await db.from("pedidos_web").select("estado, stock_descontado, actualizado_tn").eq("id", p.id).maybeSingle();
  if (errPrevio) throw new Error(/pedidos_web/.test(errPrevio.message) ? "Falta correr la migración 0028_pedidos_online.sql en Supabase." : errPrevio.message);
  const ahora = new Date().toISOString();

  if (!previo) {
    // Productos del sistema que corresponden a los del pedido
    const items = p.products ?? [];
    const variantes = items.map((i) => Number(i.variant_id)).filter(Boolean);
    const productosTN = items.map((i) => Number(i.product_id)).filter(Boolean);
    const codigos = items.flatMap((i) => [i.sku, i.barcode]).filter((x): x is string => !!x);
    const encontrados: Prod[] = [];
    const sel = "id, tn_producto_id, tn_variante_id, sku, barcode, stock(local_id, cantidad)";
    if (variantes.length) encontrados.push(...(((await db.from("productos").select(sel).in("tn_variante_id", variantes)).data ?? []) as unknown as Prod[]));
    if (productosTN.length) encontrados.push(...(((await db.from("productos").select(sel).in("tn_producto_id", productosTN)).data ?? []) as unknown as Prod[]));
    if (codigos.length) encontrados.push(...(((await db.from("productos").select(sel).in("barcode", codigos)).data ?? []) as unknown as Prod[]));
    const buscar = (i: (typeof items)[number]) =>
      encontrados.find((x) => i.variant_id && Number(x.tn_variante_id) === Number(i.variant_id))
      ?? encontrados.find((x) => i.product_id && Number(x.tn_producto_id) === Number(i.product_id))
      ?? encontrados.find((x) => (i.barcode && x.barcode === i.barcode) || (i.sku && (x.barcode === i.sku || x.sku === i.sku)));

    const estado = siguienteEstado(null, { cancelado, pagado, despachado });
    const { error } = await db.from("pedidos_web").insert({
      id: p.id, ...fila, estado,
      pagado_en: pagado ? p.paid_at ?? ahora : null,
      cancelado_en: estado === "cancelado" ? ahora : null,
      entregado_en: estado === "entregado" ? ahora : null,
    });
    if (error) {
      if (/duplicate key/.test(error.message)) return "sin cambios"; // entró por el otro camino al mismo tiempo
      throw new Error(error.message);
    }
    const filas = items.map((i, n) => {
      const prod = buscar(i);
      const stock = Object.fromEntries((prod?.stock ?? []).map((s) => [s.local_id, Number(s.cantidad)]));
      return {
        pedido_id: p.id, n: n + 1, producto_id: prod?.id ?? null,
        nombre: nombreProducto(i.name) || "Producto", sku: i.sku || i.barcode || null,
        cantidad: Math.max(1, Number(i.quantity) || 1), precio: Number(i.price) || 0,
        local_id: elegirLocal(stock, fila.retira_local),
      };
    });
    if (filas.length) {
      const { error: e2 } = await db.from("pedidos_web_items").insert(filas);
      if (e2) { await db.from("pedidos_web").delete().eq("id", p.id); throw new Error(e2.message); }
    }
    if (estado !== "cancelado") {
      const { error: e3 } = await db.rpc("stock_pedido_web", { p_pedido: p.id, p_signo: -1 });
      if (e3) throw new Error(e3.message);
    }
    return "nuevo";
  }

  const actual = previo.estado as EstadoPedido;
  const estado = siguienteEstado(actual, { cancelado, pagado, despachado });
  const cambios: Record<string, unknown> = { ...fila, estado };
  if (pagado && actual === "pendiente_pago") cambios.pagado_en = p.paid_at ?? ahora;
  if (estado === "entregado" && actual !== "entregado") cambios.entregado_en = ahora;
  if (estado === "cancelado" && actual !== "cancelado") cambios.cancelado_en = ahora;
  // Los productos y el local de cada uno no se cambian una vez que entró el pedido
  const { error } = await db.from("pedidos_web").update(cambios).eq("id", p.id);
  if (error) throw new Error(error.message);
  if (estado === "cancelado" && previo.stock_descontado) {
    const { error: e } = await db.rpc("stock_pedido_web", { p_pedido: p.id, p_signo: 1 });
    if (e) throw new Error(e.message);
    return "cancelado";
  }
  if (actual === "cancelado" && estado !== "cancelado" && !previo.stock_descontado) {
    const { error: e } = await db.rpc("stock_pedido_web", { p_pedido: p.id, p_signo: -1 });
    if (e) throw new Error(e.message);
  }
  return estado !== actual || fila.actualizado_tn !== previo.actualizado_tn ? "actualizado" : "sin cambios";
}

/** Trae un pedido de Tiendanube por id y lo guarda. */
export async function procesarPedidoTN(db: SupabaseClient, c: CredencialesTN, id: number) {
  const p = await tn<PedidoTN>(c, `/orders/${id}`);
  return guardarPedido(db, p);
}

const CLAVE_REVISION = "tn_pedidos_revisado";

/** Revisa los pedidos que cambiaron desde la última vez (por si se perdió algún aviso). */
export async function revisarPedidosTN(db: SupabaseClient, c: CredencialesTN, hastaMs = 30_000) {
  const limite = Date.now() + hastaMs;
  const { data } = await db.from("ajustes").select("valor").eq("clave", CLAVE_REVISION).maybeSingle();
  // Primera vez: últimos 7 días. Después, desde la última revisión menos una hora de margen.
  const desde = new Date((data?.valor ? Date.parse(data.valor) : Date.now() - 7 * 86400_000) - 3600_000).toISOString();
  const inicio = new Date().toISOString();
  const res = { nuevos: 0, actualizados: 0, cancelados: 0, errores: [] as string[] };
  let completo = true;
  for (let page = 1; page <= 20; page++) {
    if (Date.now() > limite) { completo = false; break; }
    let lista: PedidoTN[] = [];
    try { lista = await tn<PedidoTN[]>(c, `/orders?updated_at_min=${encodeURIComponent(desde)}&per_page=50&page=${page}`); }
    catch (e) { if (/respondió 404/.test((e as Error).message)) break; throw e; } // 404 = no hay más páginas
    for (const p of lista) {
      try {
        const r = await guardarPedido(db, p);
        if (r === "nuevo") res.nuevos++; else if (r === "actualizado") res.actualizados++; else if (r === "cancelado") res.cancelados++;
      } catch (e) { completo = false; res.errores.push(`#${p.number}: ${(e as Error).message.slice(0, 150)}`); }
    }
    if (lista.length < 50) break;
  }
  if (completo) await db.from("ajustes").upsert({ clave: CLAVE_REVISION, valor: inicio, actualizado_en: inicio });
  return res;
}

export const EVENTOS_PEDIDOS = ["order/created", "order/paid", "order/updated", "order/cancelled", "order/fulfilled"];

/** Pide a Tiendanube que avise al sistema cada vez que entra o cambia un pedido. */
export async function registrarAvisosTN(c: CredencialesTN, base: string): Promise<{ creados: number; ya: number }> {
  const url = `${base.replace(/\/$/, "")}/api/tiendanube/webhooks/pedidos`;
  const actuales = await tn<{ id: number; event: string; url: string }[]>(c, "/webhooks").catch(() => []);
  let creados = 0, ya = 0;
  for (const ev of EVENTOS_PEDIDOS) {
    const mismos = actuales.filter((w) => w.event === ev);
    if (mismos.some((w) => w.url === url)) { ya++; continue; }
    for (const w of mismos) await tn(c, `/webhooks/${w.id}`, { method: "DELETE" }).catch(() => null); // dirección vieja
    await tn(c, "/webhooks", { method: "POST", body: { event: ev, url } });
    creados++;
  }
  return { creados, ya };
}

// ---------------------------------------------------------------- en el local

export interface PedidoCaja {
  id: number; numero: number; cliente: string | null; telefono: string | null;
  entrega: "envio" | "retiro"; entrega_detalle: string | null; retira_local: number | null;
  /** a_preparar = hay productos de este local sin preparar; retirar = está listo y lo retiran acá */
  accion: "preparar" | "retirar";
  items: { n: number; nombre: string; sku: string | null; cantidad: number; preparado: boolean; sinStock: boolean }[];
}

/** Pedidos online que tiene que atender la caja de un local. */
export async function pedidosParaCaja(db: SupabaseClient, local: number): Promise<PedidoCaja[]> {
  const { data, error } = await db.from("pedidos_web")
    .select("id, numero, estado, cliente, telefono, entrega, entrega_detalle, retira_local, pedidos_web_items(n, nombre, sku, cantidad, local_id, producto_id, preparado_en)")
    .in("estado", ["a_preparar", "preparado"]).order("creado_en").limit(30);
  if (error) return [];
  const out: PedidoCaja[] = [];
  for (const p of data ?? []) {
    const todos = (p.pedidos_web_items ?? []) as { n: number; nombre: string; sku: string | null; cantidad: number; local_id: number | null; producto_id: string | null; preparado_en: string | null }[];
    const mios = todos.filter((i) => i.local_id === local);
    const faltan = mios.some((i) => !i.preparado_en);
    const retiraAca = p.entrega === "retiro" && p.retira_local === local && p.estado === "preparado";
    if (!(p.estado === "a_preparar" && faltan) && !retiraAca) continue;
    out.push({
      id: Number(p.id), numero: p.numero, cliente: p.cliente, telefono: p.telefono,
      entrega: p.entrega as "envio" | "retiro", entrega_detalle: p.entrega_detalle, retira_local: p.retira_local,
      accion: retiraAca && !faltan ? "retirar" : "preparar",
      items: (retiraAca ? todos : mios).sort((a, b) => a.n - b.n).map((i) => ({ n: i.n, nombre: i.nombre, sku: i.sku, cantidad: Number(i.cantidad), preparado: !!i.preparado_en, sinStock: !i.producto_id })),
    });
  }
  return out;
}

/** Marca como preparados los productos de un local; si ya está todo, el pedido queda "Preparado". */
export async function marcarPreparado(db: SupabaseClient, id: number, local: number, usuario: string) {
  const ahora = new Date().toISOString();
  const { error } = await db.from("pedidos_web_items").update({ preparado_en: ahora, preparado_por: usuario })
    .eq("pedido_id", id).eq("local_id", local).is("preparado_en", null);
  if (error) throw new Error(error.message);
  const { data: resto } = await db.from("pedidos_web_items").select("n").eq("pedido_id", id).is("preparado_en", null);
  if (!resto?.length) await db.from("pedidos_web").update({ estado: "preparado", preparado_en: ahora }).eq("id", id).eq("estado", "a_preparar");
  return { completo: !resto?.length };
}

/** El cliente lo retiró (o se despachó): el pedido queda entregado. */
export async function marcarEntregado(db: SupabaseClient, id: number, usuario: string) {
  const ahora = new Date().toISOString();
  await db.from("pedidos_web_items").update({ preparado_en: ahora, preparado_por: usuario }).eq("pedido_id", id).is("preparado_en", null);
  const { data, error } = await db.from("pedidos_web").update({ estado: "entregado", entregado_en: ahora, entregado_por: usuario })
    .eq("id", id).in("estado", ["a_preparar", "preparado"]).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
