// Sincronización con la planilla Precios Deco: qué cambió entre la planilla y el sistema.
import { createHash, timingSafeEqual } from "node:crypto";
import { claveCodigo } from "./caja";
import type { ProductoImportado } from "./catalogo";
export { claveCodigo };

export interface ProductoSistema {
  id: string;
  barcode: string;
  sku: string;
  nombre: string;
  categoria: string | null;
  proveedor: string | null;
  costo: number | null;
  precio_lista: number;
  precio_efectivo: number;
  activo: boolean;
  hoja: string | null;
  baja: "planilla" | "sistema" | null;
}

type Campos = Pick<ProductoSistema, "sku" | "nombre" | "categoria" | "proveedor" | "costo" | "precio_lista" | "precio_efectivo" | "hoja">;
const CAMPOS: (keyof Campos)[] = ["sku", "nombre", "categoria", "proveedor", "costo", "precio_lista", "precio_efectivo", "hoja"];
// Los que se pueden editar desde el sistema: mientras esperan ir a la planilla, no se pisan
const EDITABLES_EN_SISTEMA: (keyof Campos)[] = ["nombre", "costo", "categoria"];

const igual = (a: unknown, b: unknown) => {
  if (typeof a === "number" || typeof b === "number") {
    if (a === null || b === null || a === undefined || b === undefined) return a == b;
    return Math.abs(Number(a) - Number(b)) < 0.005;
  }
  return (a ?? null) === (b ?? null);
};

export interface Comparacion {
  nuevos: ProductoImportado[];
  cambios: { id: string; datos: Partial<ProductoSistema> }[];
  bajas: string[]; // ids que se desactivan porque ya no están en la planilla
  bajasFrenadas: number; // si la planilla llegó muy incompleta no se da de baja nada
}

/**
 * Compara lo que llega de la planilla con lo que hay en el sistema.
 * @param pendientes códigos de barras con cambios del sistema que todavía no se escribieron en la planilla
 */
export function compararCatalogo(actuales: ProductoSistema[], planilla: ProductoImportado[], pendientes = new Set<string>()): Comparacion {
  const porBarcode = new Map(actuales.map((p) => [p.barcode, p]));
  const enPlanilla = new Set(planilla.map((p) => p.barcode));
  const nuevos: ProductoImportado[] = [];
  const cambios: Comparacion["cambios"] = [];

  for (const q of planilla) {
    const p = porBarcode.get(q.barcode);
    if (!p) { nuevos.push(q); continue; }
    const datos: Partial<ProductoSistema> = {};
    for (const k of CAMPOS) {
      if (pendientes.has(q.barcode) && EDITABLES_EN_SISTEMA.includes(k)) continue;
      if (!igual(p[k], q[k])) (datos as Record<string, unknown>)[k] = q[k];
    }
    // Vuelve a la planilla: se reactiva, salvo que lo hayan eliminado a propósito en el sistema
    if (!p.activo && p.baja !== "sistema") { datos.activo = true; datos.baja = null; }
    if (Object.keys(datos).length) cambios.push({ id: p.id, datos });
  }

  const candidatos = actuales.filter((p) => p.hoja && p.activo && !enPlanilla.has(p.barcode));
  const conHoja = actuales.filter((p) => p.hoja && p.activo).length;
  // Protección: si llegó menos de la mitad del catálogo, algo salió mal al leer la planilla
  const frenar = conHoja > 50 && planilla.length < conHoja * 0.5;
  return { nuevos, cambios, bajas: frenar ? [] : candidatos.map((p) => p.id), bajasFrenadas: frenar ? candidatos.length : 0 };
}

// ---------- Clave del script de la planilla ----------

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function tokenCorrecto(recibido: string | null, hashGuardado: string | null | undefined): boolean {
  if (!recibido || !hashGuardado) return false;
  const a = Buffer.from(hashToken(recibido)), b = Buffer.from(hashGuardado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Códigos de barras alternativos (columna "Barcode original") ----------

export interface CodigoExistente { codigo: string; producto_id: string; origen: "planilla" | "sistema" }
export interface ProductoCodigo { id: string; barcode: string; nombre: string; hoja: string | null }

export interface ComparacionCodigos {
  agregar: { codigo: string; producto_id: string }[];
  quitar: string[]; // códigos que estaban por la planilla y ya no figuran
  repetidos: { codigo: string; detalle: string }[];
}

/**
 * Qué códigos alternativos agregar o quitar. Nunca pisa: si un código ya es de otro producto
 * (como código interno, cargado a mano o en otra fila de la planilla), se avisa y no se toca.
 * @param hojasLeidas solo se quitan códigos de productos de las pestañas que llegaron
 */
export function compararCodigos(
  planilla: { barcode: string; nombre: string; codigos?: string[] }[],
  productos: ProductoCodigo[],
  existentes: CodigoExistente[],
  hojasLeidas: string[],
): ComparacionCodigos {
  const porBarcode = new Map(productos.map((p) => [p.barcode, p]));
  const porId = new Map(productos.map((p) => [p.id, p]));
  const internos = new Map(productos.map((p) => [claveCodigo(p.barcode), p]));
  const repetidos: ComparacionCodigos["repetidos"] = [];
  const nombre = (id: string) => { const p = porId.get(id); return p ? `"${p.nombre}"` : "otro producto"; };

  // 1) Lo que pide la planilla: código → producto (si dos filas piden el mismo código, no va a ninguna)
  const pedidos = new Map<string, { codigo: string; producto_id: string }>();
  const enConflicto = new Set<string>();
  for (const f of planilla) {
    const p = porBarcode.get(f.barcode);
    if (!p) continue;
    for (const codigo of f.codigos ?? []) {
      const k = claveCodigo(codigo);
      if (k === claveCodigo(p.barcode)) continue; // es su propio código interno
      const otro = pedidos.get(k);
      if (otro && otro.producto_id !== p.id) {
        if (!enConflicto.has(k)) repetidos.push({ codigo, detalle: `Está en dos filas de la planilla: ${nombre(otro.producto_id)} y "${p.nombre}". No se cargó en ninguno.` });
        enConflicto.add(k);
        continue;
      }
      pedidos.set(k, { codigo, producto_id: p.id });
    }
  }
  for (const k of enConflicto) pedidos.delete(k);

  // 2) Los que vinieron de la planilla y ya no figuran (o cambiaron de producto) se quitan
  const hojas = new Set(hojasLeidas);
  const quitar: string[] = [];
  const quedan = new Map<string, CodigoExistente>();
  for (const e of existentes) {
    const k = claveCodigo(e.codigo);
    const pedido = pedidos.get(k);
    const hojaDelProducto = porId.get(e.producto_id)?.hoja ?? null;
    const sale = e.origen === "planilla" && !enConflicto.has(k) && hojaDelProducto !== null && hojas.has(hojaDelProducto)
      && (!pedido || pedido.producto_id !== e.producto_id);
    if (sale) quitar.push(e.codigo); else quedan.set(k, e);
  }

  // 3) Agregar los nuevos, salvo que el código ya sea de otro producto
  const agregar: ComparacionCodigos["agregar"] = [];
  for (const [k, ped] of pedidos) {
    const yaEs = quedan.get(k);
    if (yaEs) {
      if (yaEs.producto_id !== ped.producto_id) repetidos.push({ codigo: ped.codigo, detalle: `Ya es un código de ${nombre(yaEs.producto_id)}${yaEs.origen === "sistema" ? " (cargado en el sistema)" : ""}. No se cambió.` });
      continue;
    }
    const interno = internos.get(k);
    if (interno && interno.id !== ped.producto_id) {
      repetidos.push({ codigo: ped.codigo, detalle: `Es el código interno de ${nombre(interno.id)}. No se cargó en ${nombre(ped.producto_id)}.` });
      continue;
    }
    agregar.push(ped);
  }
  return { agregar, quitar, repetidos };
}
