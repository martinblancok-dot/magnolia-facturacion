// Sincronización con la planilla Precios Deco: qué cambió entre la planilla y el sistema.
import { createHash, timingSafeEqual } from "node:crypto";
import type { ProductoImportado } from "./catalogo";

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
