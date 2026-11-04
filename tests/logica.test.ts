/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type { Ambiente } from "@/lib/arca/config";
import { facturarPendientes, type Almacen, type CobroPendiente, type ServicioARCA } from "@/lib/facturador";
import { diaArgentina, fechaParaFactura } from "@/lib/fechas";
import { aCobro, origenDe, type PagoMP } from "@/lib/mercadopago";
import { cifrar, descifrar } from "@/lib/secretos";

describe("fechas", () => {
  it("usa la hora argentina", () => {
    expect(diaArgentina("2026-11-04T02:30:00Z")).toBe("2026-11-03"); // 23:30 en Argentina
  });
  it("venta de hace 2 días: su fecha real", () => {
    expect(fechaParaFactura("2026-11-12", "2026-11-14")).toEqual({ fecha: "2026-11-12", fueraDeTermino: false });
  });
  it("venta de hace 10 días del mismo mes: la fecha más vieja permitida", () => {
    expect(fechaParaFactura("2026-11-02", "2026-11-14")).toEqual({ fecha: "2026-11-09", fueraDeTermino: false });
  });
  it("nunca antes de la última factura emitida", () => {
    expect(fechaParaFactura("2026-11-12", "2026-11-14", "2026-11-13").fecha).toBe("2026-11-13");
  });
  it("venta del mes pasado: se marca fuera de término", () => {
    expect(fechaParaFactura("2026-10-20", "2026-11-03").fueraDeTermino).toBe(true);
  });
});

const pago = (x: Partial<PagoMP>): PagoMP => ({
  id: 1, status: "approved", date_created: "2026-11-03T15:00:00.000-04:00", date_approved: "2026-11-03T15:00:01.000-04:00",
  transaction_amount: 15000, ...x,
});

describe("Mercado Pago", () => {
  it("reconoce posnet, QR y transferencias", () => {
    expect(origenDe(pago({ point_of_interaction: { type: "POINT" } }))).toBe("posnet");
    expect(origenDe(pago({ point_of_interaction: { type: "INSTORE" } }))).toBe("qr");
    expect(origenDe(pago({ payment_method_id: "cvu" }))).toBe("transferencia");
    expect(origenDe(pago({}))).toBe("otro");
  });
  it("posnet se factura solo; transferencias quedan para revisar", () => {
    expect(aCobro(pago({ point_of_interaction: { type: "POINT" } }))?.estado).toBe("a_facturar");
    expect(aCobro(pago({ payment_method_id: "cvu" }))?.estado).toBe("revisar");
  });
  it("ventas grandes siempre a revisar", () => {
    expect(aCobro(pago({ point_of_interaction: { type: "POINT" }, transaction_amount: 20_000_000 }))?.estado).toBe("revisar");
  });
  it("ignora pagos no aprobados", () => {
    expect(aCobro(pago({ status: "refunded" }))).toBeNull();
  });
});

describe("secretos", () => {
  it("cifra y descifra", () => {
    process.env.SECRETOS_LLAVE = Buffer.alloc(32, 7).toString("base64");
    const c = cifrar("-----BEGIN PRIVATE KEY-----");
    expect(c).not.toContain("PRIVATE");
    expect(descifrar(c)).toBe("-----BEGIN PRIVATE KEY-----");
  });
});

function falsos(cobros: CobroPendiente[], respuestas: ("ok" | "rechazo" | "caida")[]) {
  const reg = { facturas: [] as any[], errores: [] as any[], tickets: 0 };
  const almacen: Almacen = {
    ticketGuardado: async () => null,
    guardarTicket: async () => {},
    cobrosAFacturar: async () => cobros,
    ultimaFechaEmitida: async () => null,
    marcarEnviando: async () => {},
    guardarFactura: async (id, f) => void reg.facturas.push({ id, ...f }),
    marcarError: async (id, m, r) => void reg.errores.push({ id, m, r }),
  };
  let i = 0;
  const arca: ServicioARCA = {
    pedirTicket: async () => (reg.tickets++, { token: "t", sign: "s", vence: "2099-01-01T00:00:00Z" }),
    ultimoNumero: async () => 41,
    solicitarCAE: async () => {
      const r = respuestas[i++];
      if (r === "caida") throw new Error("timeout");
      return r === "ok" ? { aprobada: true, cae: "123", caeVence: "2026-11-20", mensajes: [] } : { aprobada: false, mensajes: ["10016 Fecha"] };
    },
  };
  return { reg, almacen, arca };
}

const emisor = { usuarioId: "u", cuit: "20123456786", puntoVenta: 2, ambiente: "homologacion" as Ambiente, certificadoPem: "", clavePem: "" };
const ahora = new Date("2026-11-14T15:00:00Z");

describe("facturador", () => {
  it("numera seguido, en orden y con las fechas correctas", async () => {
    const { reg, almacen, arca } = falsos(
      [{ id: "a", dia: "2026-11-02", importe: 100 }, { id: "b", dia: "2026-11-13", importe: 200 }],
      ["ok", "ok"],
    );
    const r = await facturarPendientes(emisor, almacen, arca, ahora);
    expect(r.emitidas).toBe(2);
    expect(reg.facturas.map((f) => [f.id, f.numero, f.fecha])).toEqual([["a", 42, "2026-11-09"], ["b", 43, "2026-11-13"]]);
  });

  it("un rechazo no consume número", async () => {
    const { reg, almacen, arca } = falsos(
      [{ id: "a", dia: "2026-11-13", importe: 100 }, { id: "b", dia: "2026-11-13", importe: 200 }],
      ["rechazo", "ok"],
    );
    await facturarPendientes(emisor, almacen, arca, ahora);
    expect(reg.facturas[0]).toMatchObject({ id: "b", numero: 42 });
    expect(reg.errores[0]).toMatchObject({ id: "a", r: true });
  });

  it("si ARCA no responde, frena y deja el cobro para verificar a mano", async () => {
    const { reg, almacen, arca } = falsos(
      [{ id: "a", dia: "2026-11-13", importe: 100 }, { id: "b", dia: "2026-11-13", importe: 200 }],
      ["caida", "ok"],
    );
    await facturarPendientes(emisor, almacen, arca, ahora);
    expect(reg.facturas).toHaveLength(0);
    expect(reg.errores).toEqual([expect.objectContaining({ id: "a", r: false })]);
  });

  it("sin cobros pendientes no llama a ARCA", async () => {
    const { reg, almacen, arca } = falsos([], []);
    await facturarPendientes(emisor, almacen, arca, ahora);
    expect(reg.tickets).toBe(0);
  });
});

describe("tandas", () => {
  it("factura de a 40 como máximo y avisa cuántos quedan", async () => {
    const cobros = Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, dia: "2026-11-13", importe: 100 }));
    const { reg, almacen, arca } = falsos(cobros, Array(45).fill("ok"));
    const r = await facturarPendientes(emisor, almacen, arca, ahora);
    expect(r.emitidas).toBe(40);
    expect(r.quedan).toBe(5);
    expect(reg.facturas.at(-1).numero).toBe(81);
  });
});

import { conciliar } from "@/lib/conciliacion";
describe("conciliación con facturas a mano", () => {
  it("cruza por importe exacto y fecha cercana, una factura por cobro", () => {
    const r = conciliar(
      [{ id: "a", dia: "2026-10-10", importe: 15000 }, { id: "b", dia: "2026-10-10", importe: 15000 }, { id: "c", dia: "2026-10-12", importe: 8000 }],
      [{ id: "x", fecha: "2026-10-11", importe: 15000 }, { id: "y", fecha: "2026-10-20", importe: 8000 }, { id: "z", fecha: "2026-10-10", importe: 15000 }],
    );
    expect(r).toEqual([{ cobroId: "a", comprobanteId: "z" }, { cobroId: "b", comprobanteId: "x" }]); // "c": factura muy lejos
  });
  it("no usa facturas anteriores al cobro ni notas de crédito", () => {
    expect(conciliar([{ id: "a", dia: "2026-10-10", importe: 100 }], [{ id: "x", fecha: "2026-10-09", importe: 100 }, { id: "y", fecha: "2026-10-10", importe: -100 }])).toEqual([]);
  });
});
