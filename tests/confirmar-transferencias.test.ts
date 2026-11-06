import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmarTransferenciasConCaja } from "@/lib/supabase/turnos";

// Base falsa mínima: devuelve las tablas y registra los updates
function base(tablas: Record<string, Record<string, unknown>[]>) {
  const updates: { tabla: string; valores: unknown; ids: string[] }[] = [];
  const db = {
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      let valores: unknown = null;
      const q = {
        select: () => q, gte: () => q, lte: () => q, limit: () => q, neq: () => q,
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); return q; },
        in: (c: string, vs: unknown[]) => { filas = filas.filter((f) => vs.includes(f[c])); return q; },
        update: (v: unknown) => { valores = v; return q; },
        then: (ok: (r: { data: unknown; error: null }) => void) => {
          if (valores) updates.push({ tabla, valores, ids: filas.map((f) => String(f.id)) });
          ok({ data: filas, error: null });
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, updates };
}

describe("transferencias confirmadas por la caja", () => {
  it("pasa a facturar solo la transferencia que coincide con una venta", async () => {
    const ahora = Date.now();
    const iso = (min: number) => new Date(ahora + min * 60_000).toISOString();
    const { db, updates } = base({
      cobros: [
        { id: "c1", fecha_hora: iso(-30), importe: 21250, origen: "transferencia", estado: "revisar" }, // coincide
        { id: "c2", fecha_hora: iso(-20), importe: 99999, origen: "transferencia", estado: "revisar" }, // no hay venta
        { id: "c3", fecha_hora: iso(-10), importe: 15000, origen: "posnet", estado: "a_facturar" },
      ],
      ventas: [
        { id: "v1", creada_en: iso(-33), medio_pago: "transferencia", total: 71250, anulada: false, pagos: [{ medio: "efectivo", monto: 50000 }, { medio: "transferencia", monto: 21250 }] },
        { id: "v2", creada_en: iso(-11), medio_pago: "debito", total: 15000, anulada: false },
      ],
    });
    const n = await confirmarTransferenciasConCaja(db, iso(-180));
    expect(n).toBe(1);
    expect(updates[0]).toMatchObject({ tabla: "cobros", valores: { estado: "a_facturar" }, ids: ["c1"] });
  });
});
