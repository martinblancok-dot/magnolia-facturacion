// Sube a internet lo que la caja tiene guardado: primero aperturas y retiros, después las ventas.
import { borrarVenta, outbox, sacarDeOutbox, ventasPendientes } from "./caja-local";
import { clave, esPrueba } from "./modo-prueba";

export type EstadoSync = "conectado" | "sin-conexion" | "sin-sesion";

export interface ResultadoSync {
  estado: EstadoSync;
  pendientes: number;
  rechazos: string[];
}

let enCurso: Promise<ResultadoSync> | null = null;

async function subirUnaVez(): Promise<ResultadoSync> {
  const rechazos: string[] = [];
  try {
    const cola = await outbox();
    if (cola.length) {
      const r = await fetch("/api/caja/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnos: cola.filter((x) => x.clase === "turno").map((x) => x.datos),
          movimientos: cola.filter((x) => x.clase === "movimiento").map((x) => x.datos),
        }),
      });
      if (r.status === 401) return { estado: "sin-sesion", pendientes: cola.length + (await ventasPendientes()).length, rechazos };
      if (!r.ok) throw new Error();
      for (const id of ((await r.json()) as { recibidos: string[] }).recibidos) await sacarDeOutbox(id);
    }
    const ventas = await ventasPendientes();
    if (ventas.length) {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ventas: ventas.map((v) => ({ ...v, prueba: esPrueba() })) }) });
      if (r.status === 401) return { estado: "sin-sesion", pendientes: ventas.length, rechazos };
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { recibidas: string[]; rechazadas: { id: string; motivo: string }[] };
      for (const id of d.recibidas) await borrarVenta(id);
      rechazos.push(...d.rechazadas.map((x) => x.motivo));
    }
    const quedan = (await outbox()).length + (await ventasPendientes()).length;
    return { estado: "conectado", pendientes: quedan, rechazos };
  } catch {
    let quedan = 0;
    try { quedan = (await outbox()).length + (await ventasPendientes()).length; } catch {}
    return { estado: "sin-conexion", pendientes: quedan, rechazos };
  }
}

export function subirTodo(): Promise<ResultadoSync> {
  if (!enCurso) enCurso = subirUnaVez().finally(() => { enCurso = null; });
  return enCurso;
}

// Turno abierto en esta compu (localStorage)
const CLAVE_TURNO = () => clave("magnolia-turno");
export function turnoGuardado(local: number): import("./caja-local").TurnoLocal | null {
  try {
    const t = JSON.parse(localStorage.getItem(CLAVE_TURNO()) ?? "null");
    return t && t.local_id === local ? t : null;
  } catch { return null; }
}
export function guardarTurno(t: import("./caja-local").TurnoLocal | null) {
  try { if (t) localStorage.setItem(CLAVE_TURNO(), JSON.stringify(t)); else localStorage.removeItem(CLAVE_TURNO()); } catch {}
}

/** El turno guardado en esta compu, sea del local que sea. */
export function turnoDeEstaCompu(): import("./caja-local").TurnoLocal | null {
  try { return JSON.parse(localStorage.getItem(CLAVE_TURNO()) ?? "null"); } catch { return null; }
}
