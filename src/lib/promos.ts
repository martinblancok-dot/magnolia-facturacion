// Promociones y descuentos de la caja. Se aplican sobre el precio del medio de pago (efectivo, 10%, lista).
export type TipoPromo = "segunda" | "nxm" | "porcentaje";
export type AlcancePromo = "todo" | "categoria" | "proveedor" | "sku";

export interface Promo {
  id: string;
  nombre: string;
  tipo: TipoPromo;
  pct: number;          // segunda / porcentaje: % de descuento
  n: number;            // nxm: llevás n…
  m: number;            // …pagás m
  alcance: AlcancePromo;
  valores: string[];    // categorías, proveedores o SKUs (vacío si es "todo")
  mismo_producto: boolean; // segunda / nxm: cuentan solo unidades del mismo producto
}

/** Descuento manual de la venta: lo aplica un dueño o lo autoriza (si lo pide un colaborador). */
export interface DescuentoManual {
  tipo: "pct" | "monto";
  valor: number;
  motivo?: string;
  autorizacion_id?: string | null;
}

export interface UnidadPromo { clave: string; precio: number; categoria: string | null; proveedor: string | null; sku: string | null }
export interface LineaDescuento { nombre: string; monto: number; promo_id?: string; manual?: boolean }

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function aplica(p: Promo, u: Pick<UnidadPromo, "categoria" | "proveedor" | "sku">): boolean {
  if (p.alcance === "todo") return true;
  const valores = p.valores.map(norm);
  if (p.alcance === "categoria") {
    const c = norm(u.categoria);
    // "Frascos" también abarca "Frascos/Dispensers/Especieros"
    return valores.some((v) => c === v || c.startsWith(v + "/") || c.split("/").includes(v));
  }
  if (p.alcance === "proveedor") return valores.includes(norm(u.proveedor));
  return valores.includes(norm(u.sku));
}

/**
 * Calcula los descuentos de las promos. Cada unidad entra en una sola promo (la primera que le aplica).
 * "Segunda": en cada par, la unidad más barata lleva el %. "NxM": en cada grupo de n, las n−m más baratas son gratis.
 */
export function descuentosPromo(unidades: UnidadPromo[], promos: Promo[]): LineaDescuento[] {
  const usadas = new Set<number>();
  const lineas: LineaDescuento[] = [];
  for (const p of promos) {
    const elegibles = unidades.map((u, i) => ({ ...u, i })).filter((u) => !usadas.has(u.i) && aplica(p, u));
    if (!elegibles.length) continue;
    let monto = 0;
    const grupos = new Map<string, typeof elegibles>();
    for (const u of elegibles) {
      const k = p.mismo_producto ? u.clave : "todos";
      grupos.set(k, [...(grupos.get(k) ?? []), u]);
    }
    for (const g of grupos.values()) {
      const orden = [...g].sort((a, b) => b.precio - a.precio);
      if (p.tipo === "porcentaje") {
        for (const u of orden) { monto += (u.precio * p.pct) / 100; usadas.add(u.i); }
      } else if (p.tipo === "segunda") {
        const pares = Math.floor(orden.length / 2) * 2;
        for (let i = 0; i < pares; i++) {
          if (i % 2 === 1) monto += (orden[i].precio * p.pct) / 100;
          usadas.add(orden[i].i);
        }
      } else if (p.tipo === "nxm" && p.n > p.m && p.m >= 1) {
        const completos = Math.floor(orden.length / p.n) * p.n;
        for (let i = 0; i < completos; i++) {
          if (i % p.n >= p.m) monto += orden[i].precio;
          usadas.add(orden[i].i);
        }
      }
    }
    monto = Math.round(monto);
    if (monto > 0) lineas.push({ nombre: `Promo: ${p.nombre}`, monto, promo_id: p.id });
  }
  return lineas;
}

export function montoDescuentoManual(d: DescuentoManual | null | undefined, subtotal: number): number {
  if (!d || !(d.valor > 0) || subtotal <= 0) return 0;
  const m = d.tipo === "pct" ? (subtotal * Math.min(d.valor, 100)) / 100 : d.valor;
  return Math.round(Math.min(m, subtotal));
}

export function describirPromo(p: Pick<Promo, "tipo" | "pct" | "n" | "m">): string {
  if (p.tipo === "segunda") return `${p.pct}% en la 2da unidad`;
  if (p.tipo === "nxm") return `${p.n}x${p.m}`;
  return `${p.pct}% de descuento`;
}
