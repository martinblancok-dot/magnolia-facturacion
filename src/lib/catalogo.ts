// Lee la planilla "Precios Deco" (descargada como Excel) y arma la lista de productos.
// Cada pestaña de proveedor tiene: Articulo Interno (SKU), Producto, Precio unitario (costo),
// Precio sugerido (lista), precio descuento (efectivo), Barcode, Categoria, Proveedor.
import readXlsxFile from "read-excel-file/node";
import { numeroAR } from "./mis-comprobantes";

export interface ProductoImportado {
  barcode: string;
  sku: string;
  nombre: string;
  categoria: string | null;
  proveedor: string | null;
  costo: number | null;
  precio_lista: number;
  precio_efectivo: number;
  hoja: string;
}

export interface Conflicto {
  barcode: string;
  queda: string; // "SKU · nombre (hoja)"
  descartado: string;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const plata = (v: unknown) => {
  const n = typeof v === "number" ? v : numeroAR(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function leerHojas(hojas: { sheet: string; data: unknown[][] }[]) {
  const productos = new Map<string, ProductoImportado>();
  const conflictos: Conflicto[] = [];
  const hojasLeidas: string[] = [];
  let salteadas = 0;

  for (const { sheet, data } of hojas) {
    const titulos = (data[0] ?? []).map((c) => texto(c).toLowerCase());
    const col = (n: string) => titulos.indexOf(n);
    const c = {
      sku: col("articulo interno") >= 0 ? col("articulo interno") : col("articulo"),
      nombre: col("producto"),
      costo: col("precio unitario"),
      lista: col("precio sugerido"),
      efectivo: col("precio descuento"),
      barcode: col("barcode"),
      categoria: col("categoria"),
      proveedor: col("proveedor"),
    };
    // Solo pestañas de proveedor (las consolidadas y de etiquetas no tienen estas columnas)
    if ([c.sku, c.nombre, c.lista, c.barcode].some((i) => i < 0)) continue;
    hojasLeidas.push(sheet);

    for (const f of data.slice(1)) {
      const barcode = texto(f[c.barcode]);
      const nombre = texto(f[c.nombre]).replace(/\s+/g, " ");
      const lista = plata(f[c.lista]);
      if (!barcode || !nombre || !(lista > 0)) { if (barcode || nombre) salteadas++; continue; }
      let efectivo = c.efectivo >= 0 ? plata(f[c.efectivo]) : NaN;
      if (!(efectivo > 0)) efectivo = Math.round((lista * 0.85) / 50) * 50;
      const p: ProductoImportado = {
        barcode, sku: texto(f[c.sku]) || barcode, nombre,
        categoria: c.categoria >= 0 ? texto(f[c.categoria]) || null : null,
        proveedor: c.proveedor >= 0 ? texto(f[c.proveedor]) || sheet : sheet,
        costo: c.costo >= 0 && Number.isFinite(plata(f[c.costo])) ? plata(f[c.costo]) : null,
        precio_lista: lista, precio_efectivo: efectivo, hoja: sheet,
      };
      const previo = productos.get(barcode);
      if (previo) {
        const igual = previo.sku === p.sku && previo.precio_lista === p.precio_lista;
        if (!igual) {
          conflictos.push({
            barcode,
            queda: `${previo.sku} · ${previo.nombre} (${previo.hoja})`,
            descartado: `${p.sku} · ${p.nombre} (${p.hoja})`,
          });
        }
        continue; // queda el primero
      }
      productos.set(barcode, p);
    }
  }
  return { productos: [...productos.values()], conflictos, hojas: hojasLeidas, salteadas };
}

export async function leerPreciosDeco(archivo: Buffer) {
  const hojas = (await readXlsxFile(archivo)) as { sheet: string; data: unknown[][] }[];
  return leerHojas(hojas);
}
