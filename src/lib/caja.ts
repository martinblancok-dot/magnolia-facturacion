// Lógica de la caja (se usa en el navegador y en el servidor).

export type MedioPago = "efectivo" | "transferencia" | "debito" | "credito" | "cuotas" | "qr" | "giftcard";
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
];
export const MEDIOS_CAJA = MEDIOS.filter((m) => !m.oculto);
export const nombreMedio = (id: string) => MEDIOS.find((m) => m.id === id)?.nombre ?? id;

/** 10% de descuento sobre lista, redondeado a $50 (como los precios de la planilla). */
export const conDiez = (lista: number) => Math.round((lista * 0.9) / 50) * 50;

/** Producto tal como viaja a la caja: [id, barcode, sku, nombre, lista, efectivo, categoria] */
export type ProductoCaja = [string, string, string, string, number, number, string | null];

export interface ItemCarrito {
  producto_id: string | null; // null = "varios" cargado a mano
  barcode: string | null;
  sku: string | null;
  nombre: string;
  cantidad: number;
  lista: number;
  efectivo: number;
}

export const redondear = (n: number) => Math.round(n * 100) / 100;

export function precioUnitario(item: ItemCarrito, medio: MedioPago): number {
  const m = MEDIOS.find((x) => x.id === medio)!;
  if (m.precio === "efectivo") return item.efectivo;
  if (m.precio === "diez") return conDiez(item.lista);
  return item.lista;
}

export function totales(items: ItemCarrito[], medio: MedioPago) {
  let total = 0, lista = 0, efectivo = 0, diez = 0, unidades = 0;
  for (const it of items) {
    total += precioUnitario(it, medio) * it.cantidad;
    lista += it.lista * it.cantidad;
    efectivo += it.efectivo * it.cantidad;
    diez += conDiez(it.lista) * it.cantidad;
    unidades += it.cantidad;
  }
  return { total: redondear(total), lista: redondear(lista), efectivo: redondear(efectivo), diez: redondear(diez), unidades };
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
  const exacto = catalogo.find((p) => p[1] === t) ?? catalogo.find((p) => p[1].toLowerCase() === tl || p[2].toLowerCase() === tl) ?? null;
  if (exacto) return { exacto, resultados: [exacto] };
  const palabras = normalizar(t).split(/\s+/).filter(Boolean);
  const resultados: ProductoCaja[] = [];
  for (const p of catalogo) {
    const hay = normalizar(`${p[3]} ${p[2]}`);
    if (palabras.every((w) => hay.includes(w))) {
      resultados.push(p);
      if (resultados.length >= max) break;
    }
  }
  return { exacto: null, resultados };
}

export function agregar(items: ItemCarrito[], p: ProductoCaja, cantidad = 1): ItemCarrito[] {
  const i = items.findIndex((x) => x.producto_id === p[0]);
  if (i >= 0) return items.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + cantidad } : x));
  return [...items, { producto_id: p[0], barcode: p[1], sku: p[2], nombre: p[3], cantidad, lista: p[4], efectivo: p[5] }];
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
  items: { producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio_unitario: number; total: number; ajuste?: boolean }[];
  /** Venta de una gift card nueva: se crea al subir la venta. */
  giftcard_nueva?: { id: string; monto: number; medio: MedioPago } | null;
  /** Pago con gift card: cuánto se descuenta de su saldo (no entra a la caja). */
  giftcard_id?: string | null;
  giftcard_monto?: number;
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
export function cobroConGiftcard(items: ItemCarrito[], gc: Pick<GiftCard, "saldo" | "medio_origen">, resto: MedioPago) {
  const precioGc = totales(items, gc.medio_origen).total;
  const usa = redondear(Math.min(Math.max(gc.saldo, 0), precioGc));
  if (precioGc <= 0 || usa >= precioGc) return { precioGc, usa, falta: 0, ajuste: 0, saldoQueda: redondear(gc.saldo - usa) };
  const cubierto = usa / precioGc;
  const falta = Math.round(totales(items, resto).total * (1 - cubierto)); // la parte que no cubre, al precio del otro medio
  const ajuste = redondear(falta - (precioGc - usa));
  return { precioGc, usa, falta, ajuste, saldoQueda: 0 };
}

export function armarVentaGiftcard(
  items: ItemCarrito[], gc: GiftCard, resto: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, ahora = new Date(),
): VentaParaSubir {
  const c = cobroConGiftcard(items, gc, resto);
  const base = armarVenta(items, gc.medio_origen, local, terminal, null, id, ahora);
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

/** Venta de una gift card: se cobra el valor de la tarjeta, sin descuento, con el medio que sea. */
export function armarVentaNuevaGiftcard(
  monto: number, medio: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, idTarjeta: string, ahora = new Date(),
): VentaParaSubir {
  const m = redondear(monto);
  return {
    id, local_id: local, terminal, creada_en: ahora.toISOString(), medio_pago: medio, total: m, total_lista: m,
    paga_con: medio === "efectivo" ? pagaCon : null,
    items: [{ producto_id: null, barcode: null, sku: null, nombre: `Gift card ${codigoGiftcard(idTarjeta)}`, cantidad: 1, precio_unitario: m, total: m }],
    giftcard_nueva: { id: idTarjeta, monto: m, medio },
  };
}

export function armarVenta(
  items: ItemCarrito[], medio: MedioPago, local: number, terminal: string, pagaCon: number | null, id: string, ahora = new Date(),
): VentaParaSubir {
  const t = totales(items, medio);
  return {
    id, local_id: local, terminal, creada_en: ahora.toISOString(), medio_pago: medio,
    total: t.total, total_lista: t.lista, paga_con: medio === "efectivo" ? pagaCon : null,
    items: items.map((it) => {
      const pu = precioUnitario(it, medio);
      return { producto_id: it.producto_id, barcode: it.barcode, sku: it.sku, nombre: it.nombre, cantidad: it.cantidad, precio_unitario: pu, total: redondear(pu * it.cantidad) };
    }),
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
  if (gcMonto < 0 || (gcMonto > 0 && !uuid.test(String(x.giftcard_id)))) return "gift card inválida";
  if (x.medio_pago === "giftcard" && !(gcMonto > 0)) return "falta la gift card";
  if (x.giftcard_nueva) {
    const g = x.giftcard_nueva;
    if (!uuid.test(String(g.id)) || !(Number(g.monto) > 0) || g.monto !== x.total || gcMonto > 0 || x.medio_pago === "giftcard") return "gift card nueva inválida";
    if (x.items.length !== 1 || x.items[0].producto_id) return "gift card nueva inválida";
  }
  let suma = 0;
  for (const it of x.items) {
    const negativoPermitido = it.ajuste === true && !it.producto_id && gcMonto > 0;
    if (!it.nombre || !(Number(it.cantidad) > 0) || !(Number(it.precio_unitario) >= 0 || negativoPermitido)) return "producto inválido";
    if (Math.abs(redondear(it.precio_unitario * it.cantidad) - it.total) > 0.011) return "total de producto no coincide";
    suma += it.total;
  }
  if (Math.abs(redondear(suma) - (x.total + gcMonto)) > 0.05) return "el total no coincide con los productos";
  return null;
}
