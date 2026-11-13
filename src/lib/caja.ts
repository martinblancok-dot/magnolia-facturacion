import { descuentosPromo, montoDescuentoManual, type DescuentoManual, type LineaDescuento, type Promo, type UnidadPromo } from "./promos";
// Lógica de la caja (se usa en el navegador y en el servidor).

export type MedioPago = "efectivo" | "transferencia" | "debito" | "credito" | "cuotas" | "qr" | "giftcard" | "cambio" | "cuenta" | "web";
export type TipoPrecio = "efectivo" | "diez" | "lista";

// efectivo: precio con 15% de la planilla · diez: 10% sobre lista · lista: sin descuento
// oculto: no aparece como botón en la caja (QR no se usa; la gift card tiene su propio botón)
export const MEDIOS: { id: MedioPago; nombre: string; precio: TipoPrecio; oculto?: boolean }[] = [
  { id: "efectivo", nombre: "Efectivo", precio: "efectivo" },
  { id: "transferencia", nombre: "Transferencia", precio: "diez" },
  { id: "debito", nombre: "Débito", precio: "diez" },
  { id: "credito", nombre: "Crédito 1 pago", precio: "diez" },
  { id: "cuotas", nombre: "Crédito en cuotas", precio: "lista" },
  { id: "qr", nombre: "QR Mercado Pago", precio: "lista", oculto: true },
  { id: "giftcard", nombre: "Gift card", precio: "lista", oculto: true },
  { id: "cambio", nombre: "Cambio", precio: "lista", oculto: true },
  // Solo para Martín y Sofi (la caja lo muestra únicamente a los dueños)
  { id: "cuenta", nombre: "Cuenta corriente", precio: "lista", oculto: true },
  // Ventas de la tienda online (no pasan por la caja; solo para reportes)
  { id: "web", nombre: "Tienda online", precio: "lista", oculto: true },
];
export const MEDIOS_CAJA = MEDIOS.filter((m) => !m.oculto);
export const nombreMedio = (id: string) => MEDIOS.find((m) => m.id === id)?.nombre ?? id;

/** 10% de descuento sobre lista, redondeado a $50 (como los precios de la planilla). */
export const conDiez = (lista: number) => Math.round((lista * 0.9) / 50) * 50;

/** Producto tal como viaja a la caja: [id, barcode, sku, nombre, lista, efectivo, categoria] */
/** [id, barcode, sku, nombre, lista, efectivo, categoria, proveedor] */
/** [id, código interno, sku, nombre, lista, efectivo, categoría, proveedor, códigos alternativos, foto (final de la dirección)] */
export type ProductoCaja = [string, string, string, string, number, number, string | null, (string | null)?, string[]?, (string | null)?];

/** Forma de comparar códigos de barras: sin espacios, mayúsculas y, si es solo números, sin ceros adelante. */
export function claveCodigo(c: string): string {
  const t = c.trim().replace(/\s+/g, "");
  return /^[0-9]+$/.test(t) ? t.replace(/^0+/, "") || "0" : t.toUpperCase();
}

// Índice de códigos (interno, alternativos y SKU) → producto. Se arma una vez por catálogo.
const indices = new WeakMap<ProductoCaja[], { codigos: Map<string, ProductoCaja>; skus: Map<string, ProductoCaja> }>();
function indice(catalogo: ProductoCaja[]) {
  let ix = indices.get(catalogo);
  if (!ix) {
    const codigos = new Map<string, ProductoCaja>(), skus = new Map<string, ProductoCaja>();
    for (const p of catalogo) {
      for (const c of [p[1], ...(p[8] ?? [])]) { const k = claveCodigo(c); if (!codigos.has(k)) codigos.set(k, p); }
      const s = p[2].trim().toLowerCase(); if (!skus.has(s)) skus.set(s, p);
    }
    ix = { codigos, skus };
    indices.set(catalogo, ix);
  }
  return ix;
}

/** El producto de un código de barras (interno o cualquier alternativo), o null. */
export function porCodigo(catalogo: ProductoCaja[], codigo: string): ProductoCaja | null {
  return indice(catalogo).codigos.get(claveCodigo(codigo)) ?? null;
}

export interface ItemCarrito {
  producto_id: string | null; // null = "varios" cargado a mano
  barcode: string | null;
  sku: string | null;
  nombre: string;
  cantidad: number;
  lista: number;
  efectivo: number;
  categoria?: string | null;
  proveedor?: string | null;
}

/** Promos y descuento manual que se aplican a la venta. */
export interface Extras {
  promos?: Promo[];
  descuento?: DescuentoManual | null;
}

export const redondear = (n: number) => Math.round(n * 100) / 100;

export function precioUnitario(item: ItemCarrito, medio: MedioPago): number {
  const m = MEDIOS.find((x) => x.id === medio)!;
  if (m.precio === "efectivo") return item.efectivo;
  if (m.precio === "diez") return conDiez(item.lista);
  return item.lista;
}

/** Promos y descuento manual de la venta, al precio de ese medio. */
export function descuentos(items: ItemCarrito[], medio: MedioPago, ext?: Extras): LineaDescuento[] {
  if (!ext || (!ext.promos?.length && !ext.descuento)) return [];
  const unidades: UnidadPromo[] = [];
  for (const it of items) {
    if (it.cantidad <= 0) continue;
    for (let k = 0; k < it.cantidad; k++) {
      unidades.push({ clave: it.producto_id ?? it.nombre, precio: precioUnitario(it, medio), categoria: it.categoria ?? null, proveedor: it.proveedor ?? null, sku: it.sku });
    }
  }
  const lineas = descuentosPromo(unidades, ext.promos ?? []);
  const sub = unidades.reduce((s, u) => s + u.precio, 0) - lineas.reduce((s, l) => s + l.monto, 0);
  const manual = montoDescuentoManual(ext.descuento, sub);
  if (manual > 0) lineas.push({ nombre: `Descuento${ext.descuento?.tipo === "pct" ? ` ${ext.descuento.valor}%` : ""}${ext.descuento?.motivo ? ` (${ext.descuento.motivo})` : ""}`, monto: manual, manual: true });
  return lineas;
}

export function totales(items: ItemCarrito[], medio: MedioPago, ext?: Extras) {
  let total = 0, lista = 0, efectivo = 0, diez = 0, unidades = 0;
  for (const it of items) {
    total += precioUnitario(it, medio) * it.cantidad;
    lista += it.lista * it.cantidad;
    efectivo += it.efectivo * it.cantidad;
    diez += conDiez(it.lista) * it.cantidad;
    unidades += it.cantidad;
  }
  const desc = descuentos(items, medio, ext);
  const descuento = desc.reduce((s, l) => s + l.monto, 0);
  return { total: redondear(total - descuento), sinDescuento: redondear(total), descuento, lineas: desc, lista: redondear(lista), efectivo: redondear(efectivo), diez: redondear(diez), unidades };
}

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Busca en el catálogo: primero coincidencia exacta de código de barras o SKU
 * (lo que manda el lector), si no, por palabras en el nombre o el SKU.
 */
export function buscar(catalogo: ProductoCaja[], texto: string, max = 30): { exacto: ProductoCaja | null; resultados: ProductoCaja[] } {
  const t = texto.trim();
  if (!t) return { exacto: null, resultados: [] };
  const tl = t.toLowerCase();
  const ix = indice(catalogo);
  const porCod = ix.codigos.get(claveCodigo(t)) ?? null;
  // Código de barras completo (interno u original, del lector o escrito): no hace falta lista
  if (porCod) return { exacto: porCod, resultados: [porCod] };
  const exacto = ix.skus.get(tl) ?? null;
  const palabras = normalizar(t).split(/\s+/).filter(Boolean);
  const encontrados: ProductoCaja[] = [];
  for (const p of catalogo) {
    if (p === exacto) continue;
    const hay = normalizar(`${p[3]} ${p[2]}`);
    if (palabras.every((w) => hay.includes(w))) {
      encontrados.push(p);
      if (encontrados.length >= 300) break;
    }
  }
  // Primero los que tienen el SKU que empieza con lo escrito (HA8 → HA8, HA80, HA81…)
  const empieza = (p: ProductoCaja) => (p[2].toLowerCase().startsWith(tl) ? 0 : 1);
  encontrados.sort((a, b) => empieza(a) - empieza(b) || a[2].length - b[2].length);
  const resultados = (exacto ? [exacto, ...encontrados] : encontrados).slice(0, max);
  return { exacto, resultados };
}

export function agregar(items: ItemCarrito[], p: ProductoCaja, cantidad = 1): ItemCarrito[] {
  const i = items.findIndex((x) => x.producto_id === p[0]);
  if (i >= 0) return items.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + cantidad } : x));
  return [...items, { producto_id: p[0], barcode: p[1], sku: p[2], nombre: p[3], cantidad, lista: p[4], efectivo: p[5], categoria: p[6] ?? null, proveedor: p[7] ?? null }];
}

export interface VentaParaSubir {
  id: string;
  turno_id?: string | null;
  local_id: number;
  terminal: string;
  creada_en: string;
  medio_pago: MedioPago;
  total: number;
  total_lista: number;
  paga_con: number | null;
  items: { producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio_unitario: number; total: number; ajuste?: boolean; descuento_manual?: boolean }[];
  /** Descuento manual aplicado (si lo pidió un colaborador, con su autorización). */
  descuento?: DescuentoManual | null;
  /** Cambio: venta original y crédito por lo que se devolvió. */
  cambio_de?: string | null;
  credito_cambio?: number;
  /** Venta a cuenta corriente: la clienta que la debe. */
  cliente_cc_id?: string | null;
  /** Pago dividido en dos medios (ej. parte en efectivo y el resto por transferencia). */
  pagos?: Pago[] | null;
  /** Venta de una gift card nueva: se crea al subir la venta. */
  giftcard_nueva?: { id: string; monto: number; medio: MedioPago; destinatario?: string | null } | null;
  /** Pago con gift card: cuánto se descuenta de su saldo (no entra a la caja). */
  giftcard_id?: string | null;
  giftcard_monto?: number;
  /** Venta de la caja de prueba (solo dueños): no toca stock ni aparece en ventas ni reportes. */
  prueba?: boolean;
}

// ---------- Gift cards ----------

export interface GiftCard {
  id: string;
  codigo: string;
  saldo: number;
  medio_origen: MedioPago; // cómo se pagó: define el descuento al usarla
}

/** Código de la gift card: las primeras 8 letras de su id. */
export const codigoGiftcard = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/**
 * Cuánto cubre la gift card y cuánto falta. Los productos van al precio del medio con que
 * se pagó la tarjeta; si el saldo no alcanza, la parte que falta se cobra al precio del otro medio.
 */
export function cobroConGiftcard(items: ItemCarrito[], gc: Pick<GiftCard, "saldo" | "medio_origen">, resto: MedioPago, ext?: Extras) {
  const precioGc = totales(items, gc.medio_origen, ext).total;
  const usa = redondear(Math.min(Math.max(gc.saldo, 0), precioGc));
  if (precioGc <= 0 || usa >= precioGc) return { precioGc, usa, falta: 0, ajuste: 0, saldoQueda: redondear(gc.saldo - usa) };
  const cubierto = usa / precioGc;
  const falta = Math.round(totales(items, resto, ext).total * (1 - cubierto)); // la parte que no cubre, al precio del otro medio
  const ajuste = redondear(falta - (precioGc - usa));
  return { precioGc, usa, falta, ajuste, saldoQueda: 0 };
}

export function armarVentaGiftcard(
  items: ItemCarrito[], gc: GiftCard, resto: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, ahora = new Date(), ext?: Extras,
): VentaParaSubir {
  const c = cobroConGiftcard(items, gc, resto, ext);
  const base = armarVenta(items, gc.medio_origen, local, terminal, null, id, ahora, ext);
  const lineas = [...base.items];
  if (c.ajuste !== 0) {
    lineas.push({ producto_id: null, barcode: null, sku: null, nombre: `Diferencia de precio pagada con ${nombreMedio(resto)}`, cantidad: 1, precio_unitario: c.ajuste, total: c.ajuste, ajuste: true });
  }
  const medio = c.falta > 0 ? resto : "giftcard";
  return {
    ...base, items: lineas, medio_pago: medio, total: c.falta,
    paga_con: medio === "efectivo" ? pagaCon : null, giftcard_id: gc.id, giftcard_monto: c.usa,
  };
}

// ---------- Pago dividido en dos medios ----------

export interface Pago { medio: MedioPago; monto: number }

/**
 * Paga una parte con un medio y el resto con otro. Lo que cubre el primer monto va al precio del primer medio;
 * lo que falta, al precio del segundo (ej. $50.000 en efectivo y el resto por transferencia con su descuento).
 */
export function cobroDividido(items: ItemCarrito[], primero: MedioPago, monto: number, resto: MedioPago, ext?: Extras) {
  const precio1 = totales(items, primero, ext).total;
  const usa = redondear(Math.min(Math.max(monto || 0, 0), precio1));
  if (precio1 <= 0 || usa <= 0 || usa >= precio1 || primero === resto) return null;
  const falta = Math.round(totales(items, resto, ext).total * (1 - usa / precio1));
  const ajuste = redondear(falta - (precio1 - usa));
  return { precio1, usa, falta, ajuste, total: redondear(usa + falta) };
}

export function armarVentaDividida(
  items: ItemCarrito[], primero: MedioPago, monto: number, resto: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, ahora = new Date(), ext?: Extras,
): VentaParaSubir | null {
  const c = cobroDividido(items, primero, monto, resto, ext);
  if (!c) return null;
  const base = armarVenta(items, primero, local, terminal, null, id, ahora, ext);
  const lineas = [...base.items];
  if (c.ajuste !== 0) {
    lineas.push({ producto_id: null, barcode: null, sku: null, nombre: `Diferencia de precio pagada con ${nombreMedio(resto)}`, cantidad: 1, precio_unitario: c.ajuste, total: c.ajuste, ajuste: true });
  }
  // El medio "principal" es el que no es efectivo: así el cruce con Mercado Pago lo encuentra
  const principal = primero !== "efectivo" ? primero : resto;
  return {
    ...base, items: lineas, medio_pago: principal, total: c.total,
    paga_con: primero === "efectivo" || resto === "efectivo" ? pagaCon : null,
    pagos: [{ medio: primero, monto: c.usa }, { medio: resto, monto: c.falta }],
  };
}

/** Las partes de una venta por medio de pago (una sola si no se dividió). */
export function partesPago(v: { medio_pago: string; total: number | string; pagos?: { medio: string; monto: number | string }[] | null }): { medio: MedioPago; monto: number }[] {
  if (Array.isArray(v.pagos) && v.pagos.length > 1) return v.pagos.map((p) => ({ medio: p.medio as MedioPago, monto: Number(p.monto) }));
  return [{ medio: v.medio_pago as MedioPago, monto: Number(v.total) }];
}

// ---------- Cambios y devoluciones ----------

export interface Devolucion { producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio: number }
export interface CambioEnCurso {
  venta_id: string;        // venta original
  codigo: string;
  medio_precio: MedioPago; // lo nuevo va al precio del medio con que se pagó la venta original
  devoluciones: Devolucion[];
  /** La venta original fue a cuenta corriente: el cambio se ajusta en la cuenta de la clienta. */
  cliente_cc?: { id: string; nombre: string } | null;
  /** Dentro de los días de cambio (si no, lo devuelto ya no se descuenta de la cuenta). */
  enPlazo?: boolean;
}

export const creditoCambio = (c: CambioEnCurso) => redondear(c.devoluciones.reduce((s, d) => s + d.precio * d.cantidad, 0));

/** Cuánto se cobra (o queda a favor) en un cambio: el crédito funciona como una gift card del medio original. */
export function cobroCambio(nuevos: ItemCarrito[], c: CambioEnCurso, resto: MedioPago, ext?: Extras) {
  const credito = creditoCambio(c);
  const r = cobroConGiftcard(nuevos, { saldo: credito, medio_origen: c.medio_precio }, resto, ext);
  return { ...r, credito, aFavor: r.saldoQueda };
}

export function armarVentaCambio(
  nuevos: ItemCarrito[], c: CambioEnCurso, resto: MedioPago, local: number, terminal: string, pagaCon: number | null,
  id: string, idGiftcard: string, ahora = new Date(), ext?: Extras,
): VentaParaSubir {
  const r = cobroCambio(nuevos, c, resto, ext);
  const base = armarVenta(nuevos, c.medio_precio, local, terminal, null, id, ahora, ext);
  const lineas = [...base.items];
  if (r.ajuste !== 0) {
    lineas.push({ producto_id: null, barcode: null, sku: null, nombre: `Diferencia de precio pagada con ${nombreMedio(resto)}`, cantidad: 1, precio_unitario: r.ajuste, total: r.ajuste, ajuste: true });
  }
  for (const d of c.devoluciones) {
    lineas.push({ producto_id: d.producto_id, barcode: d.barcode, sku: d.sku, nombre: `Devolución: ${d.nombre}`, cantidad: -d.cantidad, precio_unitario: d.precio, total: redondear(-d.cantidad * d.precio) });
  }
  const medio: MedioPago = r.falta > 0 ? resto : "cambio";
  return {
    ...base, items: lineas, medio_pago: medio, total: r.falta, paga_con: medio === "efectivo" ? pagaCon : null,
    cambio_de: c.venta_id, credito_cambio: r.credito,
    giftcard_nueva: r.aFavor > 0 ? { id: idGiftcard, monto: r.aFavor, medio: c.medio_precio } : null,
  };
}

/**
 * Cambio de una venta hecha a cuenta corriente: lo devuelto se descuenta de la deuda y lo nuevo se suma,
 * a precio de lista. El total puede ser negativo (la deuda baja). No genera gift card.
 */
export function armarVentaCambioCuenta(
  nuevos: ItemCarrito[], c: CambioEnCurso, cliente: string, local: number, terminal: string, id: string, ahora = new Date(), ext?: Extras,
): VentaParaSubir {
  const credito = creditoCambio(c);
  const base = armarVenta(nuevos, "cuenta", local, terminal, null, id, ahora, ext);
  const lineas = [...base.items];
  for (const d of c.devoluciones) {
    lineas.push({ producto_id: d.producto_id, barcode: d.barcode, sku: d.sku, nombre: `Devolución: ${d.nombre}`, cantidad: -d.cantidad, precio_unitario: d.precio, total: redondear(-d.cantidad * d.precio) });
  }
  return { ...base, items: lineas, medio_pago: "cuenta", total: redondear(base.total - credito), paga_con: null, cambio_de: c.venta_id, credito_cambio: credito, cliente_cc_id: cliente };
}

/** Venta de una gift card: se cobra el valor de la tarjeta, sin descuento, con el medio que sea. */
export function armarVentaNuevaGiftcard(
  monto: number, medio: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, idTarjeta: string, ahora = new Date(), destinatario?: string | null,
): VentaParaSubir {
  const m = redondear(monto);
  const para = (destinatario ?? "").trim().slice(0, 80) || null;
  return {
    id, local_id: local, terminal, creada_en: ahora.toISOString(), medio_pago: medio, total: m, total_lista: m,
    paga_con: medio === "efectivo" ? pagaCon : null,
    items: [{ producto_id: null, barcode: null, sku: null, nombre: `Gift card ${codigoGiftcard(idTarjeta)}${para ? ` · para ${para}` : ""}`, cantidad: 1, precio_unitario: m, total: m }],
    giftcard_nueva: { id: idTarjeta, monto: m, medio, destinatario: para },
  };
}

export function armarVenta(
  items: ItemCarrito[], medio: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, ahora = new Date(), ext?: Extras,
): VentaParaSubir {
  const t = totales(items, medio, ext);
  return {
    id, local_id: local, terminal, creada_en: ahora.toISOString(), medio_pago: medio,
    total: t.total, total_lista: t.lista, paga_con: medio === "efectivo" ? pagaCon : null,
    items: [
      ...items.map((it) => {
        const pu = precioUnitario(it, medio);
        return { producto_id: it.producto_id, barcode: it.barcode, sku: it.sku, nombre: it.nombre, cantidad: it.cantidad, precio_unitario: pu, total: redondear(pu * it.cantidad) };
      }),
      ...t.lineas.map((l) => ({ producto_id: null, barcode: null, sku: null, nombre: l.nombre, cantidad: 1, precio_unitario: -l.monto, total: -l.monto, ajuste: true, descuento_manual: l.manual || undefined })),
    ],
    descuento: ext?.descuento && t.lineas.some((l) => l.manual) ? ext.descuento : null,
  };
}

/** Revisa en el servidor que una venta que llega tenga sentido. Devuelve el error o null. */
export function validarVenta(v: unknown): string | null {
  const x = v as VentaParaSubir;
  if (!x || typeof x !== "object") return "venta vacía";
  if (!/^[0-9a-f-]{36}$/i.test(String(x.id))) return "id inválido";
  if (![1, 2].includes(Number(x.local_id))) return "local inválido";
  if (!MEDIOS.some((m) => m.id === x.medio_pago)) return "medio de pago inválido";
  if (!Array.isArray(x.items) || x.items.length === 0 || x.items.length > 500) return "sin productos";
  if (isNaN(Date.parse(x.creada_en))) return "fecha inválida";
  if (x.turno_id && !/^[0-9a-f-]{36}$/i.test(String(x.turno_id))) return "turno inválido";
  const uuid = /^[0-9a-f-]{36}$/i;
  const gcMonto = Number(x.giftcard_monto ?? 0);
  const esCambio = !!x.cambio_de;
  if (esCambio && !uuid.test(String(x.cambio_de))) return "cambio inválido";
  if (gcMonto < 0 || (gcMonto > 0 && !uuid.test(String(x.giftcard_id)))) return "gift card inválida";
  if (esCambio && gcMonto > 0) return "un cambio no se paga con gift card";
  if (x.medio_pago === "giftcard" && !(gcMonto > 0)) return "falta la gift card";
  if (x.medio_pago === "cambio" && (!esCambio || x.total !== 0)) return "cambio inválido";
  if (x.medio_pago === "cuenta" && !uuid.test(String(x.cliente_cc_id))) return "falta la clienta de la cuenta corriente";
  if (x.medio_pago !== "cuenta" && x.cliente_cc_id) return "cuenta corriente inválida";
  if (x.medio_pago === "cuenta" && (gcMonto > 0 || x.giftcard_nueva || x.pagos)) return "la cuenta corriente no se combina con gift card ni pago dividido";
  if (Number(x.total) < 0 && !(esCambio && x.medio_pago === "cuenta")) return "total inválido";
  if (x.pagos != null) {
    const p = x.pagos;
    const validos = MEDIOS_CAJA.map((m) => m.id as string);
    if (!Array.isArray(p) || p.length !== 2 || p[0].medio === p[1].medio || !p.every((q) => validos.includes(q.medio) && Number(q.monto) > 0)) return "pago dividido inválido";
    if (Math.abs(Number(p[0].monto) + Number(p[1].monto) - Number(x.total)) > 0.01) return "el pago dividido no suma el total";
    if (!p.some((q) => q.medio === x.medio_pago)) return "pago dividido inválido";
    if (gcMonto > 0 || esCambio || x.giftcard_nueva) return "el pago dividido no se combina con gift card ni cambio";
  }
  let aFavor = 0;
  if (x.giftcard_nueva) {
    const g = x.giftcard_nueva;
    if (!uuid.test(String(g.id)) || !(Number(g.monto) > 0) || gcMonto > 0 || x.medio_pago === "giftcard") return "gift card nueva inválida";
    if (esCambio) aFavor = Number(g.monto);
    else if (g.monto !== x.total || x.items.length !== 1 || x.items[0].producto_id) return "gift card nueva inválida";
  }
  let suma = 0, devuelto = 0;
  for (const it of x.items) {
    const ajuste = it.ajuste === true && !it.producto_id && Number(it.cantidad) === 1;
    const devolucion = esCambio && Number(it.cantidad) < 0;
    if (!it.nombre || !(Number(it.cantidad) > 0 || devolucion) || Number(it.cantidad) === 0) return "producto inválido";
    if (!(Number(it.precio_unitario) >= 0 || ajuste)) return "producto inválido";
    if (Math.abs(redondear(it.precio_unitario * it.cantidad) - it.total) > 0.011) return "total de producto no coincide";
    if (devolucion) devuelto -= it.total;
    suma += it.total;
  }
  if (esCambio && Math.abs(redondear(devuelto) - Number(x.credito_cambio ?? 0)) > 0.05) return "el crédito del cambio no coincide";
  if (esCambio && devuelto <= 0) return "el cambio no tiene devoluciones";
  if (Math.abs(redondear(suma) - (x.total + gcMonto - aFavor)) > 0.05) return "el total no coincide con los productos";
  return null;
}
