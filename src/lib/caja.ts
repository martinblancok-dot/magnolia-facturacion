// Lógica de la caja (se usa en el navegador y en el servidor).

export type MedioPago = "efectivo" | "transferencia" | "debito" | "credito" | "qr";

export const MEDIOS: { id: MedioPago; nombre: string; precio: "efectivo" | "lista" }[] = [
  { id: "efectivo", nombre: "Efectivo", precio: "efectivo" },
  { id: "transferencia", nombre: "Transferencia", precio: "lista" },
  { id: "debito", nombre: "Débito", precio: "lista" },
  { id: "credito", nombre: "Crédito", precio: "lista" },
  { id: "qr", nombre: "QR Mercado Pago", precio: "lista" },
];

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
  return m.precio === "efectivo" ? item.efectivo : item.lista;
}

export function totales(items: ItemCarrito[], medio: MedioPago) {
  let total = 0, lista = 0, efectivo = 0, unidades = 0;
  for (const it of items) {
    total += precioUnitario(it, medio) * it.cantidad;
    lista += it.lista * it.cantidad;
    efectivo += it.efectivo * it.cantidad;
    unidades += it.cantidad;
  }
  return { total: redondear(total), lista: redondear(lista), efectivo: redondear(efectivo), unidades };
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
  local_id: number;
  terminal: string;
  creada_en: string;
  medio_pago: MedioPago;
  total: number;
  total_lista: number;
  paga_con: number | null;
  items: { producto_id: string | null; barcode: string | null; sku: string | null; nombre: string; cantidad: number; precio_unitario: number; total: number }[];
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
  let suma = 0;
  for (const it of x.items) {
    if (!it.nombre || !(Number(it.cantidad) > 0) || !(Number(it.precio_unitario) >= 0)) return "producto inválido";
    if (Math.abs(redondear(it.precio_unitario * it.cantidad) - it.total) > 0.011) return "total de producto no coincide";
    suma += it.total;
  }
  if (Math.abs(redondear(suma) - x.total) > 0.05) return "el total no coincide con los productos";
  return null;
}
