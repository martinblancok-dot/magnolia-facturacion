// Lo que la caja guarda en la compu (IndexedDB): el catálogo y las ventas que falta subir.
// Así puede seguir vendiendo aunque se corte internet.
import type { VentaParaSubir } from "./caja";

const DB = "magnolia-caja";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("kv");
      r.result.createObjectStore("pendientes", { keyPath: "id" });
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
