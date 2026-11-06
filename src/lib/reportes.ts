// Cálculo de reportes de ventas (puro: recibe ventas y datos de productos).
export interface ItemRep { producto_id: string | null; sku: string | null; nombre: string; cantidad: number; total: number }
export interface VentaRep { id: string; local_id: number; creada_en: string; medio_pago: string; total: number; giftcard_monto: number; items: ItemRep[] }
export interface ProductoRep { id: string; costo: number | null; categoria: string | null; proveedor: string | null }

type Fila = { clave: string; ventas: number; unidades: number; ingreso: number; costo: number; sinCosto: number };
const nueva = (clave: string): Fila => ({ clave, ventas: 0, unidades: 0, ingreso: 0, costo: 0, sinCosto: 0 });
const esGiftcard = (i: ItemRep) => !i.producto_id && i.nombre.startsWith("Gift card ");

/** Hora y día de la semana en Argentina. */
export function horaAR(iso: string) {
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  return { hora: d.getUTCHours(), dia: d.getUTCDay(), fecha: d.toISOString().slice(0, 10) };
}

export function calcularReporte(ventas: VentaRep[], productos: Map<string, ProductoRep>) {
  const porMedio = new Map<string, number>();
  const porLocal = new Map<number, { ventas: number; cobrado: number; ingreso: number }>();
  const porCategoria = new Map<string, Fila>(), porProveedor = new Map<string, Fila>(), porProducto = new Map<string, Fila & { nombre: string; sku: string | null }>();
  const porHora = Array(24).fill(0) as number[], porDia = Array(7).fill(0) as number[];
  const porFecha = new Map<string, number>();
  let cobrado = 0, ingreso = 0, costo = 0, unidades = 0, conProductos = 0, giftcardsVendidas = 0, giftcardsUsadas = 0, devoluciones = 0, sinCostoIngreso = 0;

  for (const v of ventas) {
    cobrado += Number(v.total);
    porMedio.set(v.medio_pago, (porMedio.get(v.medio_pago) ?? 0) + Number(v.total));
    giftcardsUsadas += Number(v.giftcard_monto) || 0;
    const prod = v.items.filter((i) => !esGiftcard(i) && (i.producto_id || Number(i.total) > 0 || Number(i.cantidad) < 0) && !(Number(i.cantidad) === 1 && !i.producto_id && Number(i.total) < 0));
    const bruto = prod.filter((i) => Number(i.cantidad) > 0).reduce((s, i) => s + Number(i.total), 0);
    const ajustes = v.items.filter((i) => !esGiftcard(i) && !i.producto_id && Number(i.cantidad) === 1 && Number(i.total) < 0 || (!i.producto_id && i.nombre.startsWith("Diferencia de precio"))).reduce((s, i) => s + Number(i.total), 0);
    const factor = bruto > 0 ? (bruto + ajustes) / bruto : 1;
    giftcardsVendidas += v.items.filter(esGiftcard).reduce((s, i) => s + Number(i.total), 0);
    const { hora, dia, fecha } = horaAR(v.creada_en);
    let ingresoVenta = 0;
    for (const i of prod) {
      if (i.nombre.startsWith("Diferencia de precio")) continue;
      const cant = Number(i.cantidad);
      const plata = Number(i.total) * (cant > 0 ? factor : 1);
      const p = i.producto_id ? productos.get(i.producto_id) : undefined;
      const c = p?.costo != null ? Number(p.costo) * cant : null;
      ingresoVenta += plata; unidades += cant;
      if (cant < 0) devoluciones += -plata;
      if (c === null) sinCostoIngreso += plata; else costo += c;
      const cat = (p?.categoria ?? "Sin categoría").split("/")[0] || "Sin categoría";
      const prov = p?.proveedor ?? (i.producto_id ? "Sin proveedor" : "Varios (sin código)");
      for (const [m, k] of [[porCategoria, cat], [porProveedor, prov]] as const) {
        const f = m.get(k) ?? nueva(k);
        f.unidades += cant; f.ingreso += plata;
        if (c === null) f.sinCosto += plata; else f.costo += c;
        m.set(k, f);
      }
      const k = i.producto_id ?? `varios:${i.nombre}`;
      const f = porProducto.get(k) ?? { ...nueva(k), nombre: i.nombre.replace(/^Devolución: /, ""), sku: i.sku };
      f.unidades += cant; f.ingreso += plata; f.ventas += cant > 0 ? 1 : 0;
      if (c === null) f.sinCosto += plata; else f.costo += c;
      porProducto.set(k, f);
    }
    ingreso += ingresoVenta;
    if (prod.some((i) => Number(i.cantidad) > 0)) conProductos++;
    const l = porLocal.get(v.local_id) ?? { ventas: 0, cobrado: 0, ingreso: 0 };
    l.ventas++; l.cobrado += Number(v.total); l.ingreso += ingresoVenta; porLocal.set(v.local_id, l);
    porHora[hora] += ingresoVenta; porDia[dia] += ingresoVenta;
    porFecha.set(fecha, (porFecha.get(fecha) ?? 0) + ingresoVenta);
  }
  const ganancia = ingreso - sinCostoIngreso - costo;
  const orden = (m: Map<string, Fila>) => [...m.values()].sort((a, b) => b.ingreso - a.ingreso);
  return {
    ventas: ventas.length, conProductos, cobrado, ingreso, costo, ganancia, unidades, devoluciones, giftcardsVendidas, giftcardsUsadas,
    sinCostoIngreso, margen: ingreso - sinCostoIngreso > 0 ? ganancia / (ingreso - sinCostoIngreso) : 0,
    ticketPromedio: conProductos ? ingreso / conProductos : 0,
    porMedio: [...porMedio.entries()].sort((a, b) => b[1] - a[1]),
    porLocal: [...porLocal.entries()].sort((a, b) => a[0] - b[0]),
    porCategoria: orden(porCategoria), porProveedor: orden(porProveedor),
    masVendidos: [...porProducto.values()].sort((a, b) => b.unidades - a.unidades || b.ingreso - a.ingreso).slice(0, 25),
    porHora, porDia, porFecha: [...porFecha.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}
export type Reporte = ReturnType<typeof calcularReporte>;
