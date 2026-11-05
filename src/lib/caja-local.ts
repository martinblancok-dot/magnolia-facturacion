// Lo que la caja guarda en la compu (IndexedDB): el catálogo, las ventas que falta subir
// y las aperturas/retiros de caja pendientes. Así puede seguir vendiendo aunque se corte internet.
import type { VentaParaSubir } from "./caja";

const DB = "magnolia-caja";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("pendientes")) db.createObjectStore("pendientes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(store: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { resolve(req.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

export const leer = <T>(clave: string) => tx<T | undefined>("kv", "readonly", (s) => s.get(clave) as IDBRequest<T | undefined>);
export const guardar = (clave: string, valor: unknown) => tx("kv", "readwrite", (s) => s.put(valor, clave));

export const guardarVenta = (v: VentaParaSubir) => tx("pendientes", "readwrite", (s) => s.put(v));
export const ventasPendientes = () => tx<VentaParaSubir[]>("pendientes", "readonly", (s) => s.getAll() as IDBRequest<VentaParaSubir[]>);
export const borrarVenta = (id: string) => tx("pendientes", "readwrite", (s) => s.delete(id));

export interface TurnoLocal { id: string; local_id: number; terminal: string; abierta_en: string; fondo_inicial: number }
export interface MovimientoLocal { id: string; turno_id: string; tipo: "retiro" | "gasto" | "ingreso"; monto: number; motivo: string; creado_en: string }
export type ItemOutbox = { id: string; clase: "turno"; datos: TurnoLocal } | { id: string; clase: "movimiento"; datos: MovimientoLocal };

export const encolar = (i: ItemOutbox) => tx("outbox", "readwrite", (s) => s.put(i));
export const outbox = () => tx<ItemOutbox[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<ItemOutbox[]>);
export const sacarDeOutbox = (id: string) => tx("outbox", "readwrite", (s) => s.delete(id));
