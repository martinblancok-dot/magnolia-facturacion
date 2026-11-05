import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
import { cifrarPin, firmarVencimiento, pinCorrecto, vencimientoValido } from "@/lib/admin";

process.env.SECRETOS_LLAVE = Buffer.alloc(32, 9).toString("base64");

describe("clave de administrador", () => {
  it("guarda la clave cifrada y la reconoce", () => {
    const g = cifrarPin("1234");
    expect(g).not.toContain("1234");
    expect(pinCorrecto("1234", g)).toBe(true);
    expect(pinCorrecto("1235", g)).toBe(false);
    expect(cifrarPin("1234")).not.toBe(g); // cada vez con sal distinta
  });
  it("el desbloqueo vence y no se puede falsificar", () => {
    const ahora = Date.now();
    const c = firmarVencimiento(ahora + 60_000);
    expect(vencimientoValido(c, ahora)).toBe(true);
    expect(vencimientoValido(c, ahora + 120_000)).toBe(false);
    const [v] = c.split(".");
    expect(vencimientoValido(`${Number(v) + 999999}.${c.split(".")[1]}`, ahora)).toBe(false);
    expect(vencimientoValido("9999999999999.inventada", ahora)).toBe(false);
    expect(vencimientoValido(undefined, ahora)).toBe(false);
  });
});
