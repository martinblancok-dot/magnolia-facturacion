import { describe, expect, it } from "vitest";
import { elegirLocal, localDeRetiro, siguienteEstado } from "../src/lib/tiendanube-pedidos";

describe("de qué local sale cada producto", () => {
  it("el que más unidades tiene", () => {
    expect(elegirLocal({ 1: 2, 2: 5 }, null)).toBe(2);
    expect(elegirLocal({ 1: 7, 2: 1 }, 2)).toBe(1);
  });
  it("si empatan, donde retira el cliente; si no, Home", () => {
    expect(elegirLocal({ 1: 3, 2: 3 }, 2)).toBe(2);
    expect(elegirLocal({ 1: 3, 2: 3 }, null)).toBe(1);
    expect(elegirLocal({}, null)).toBe(1);
    expect(elegirLocal({ 2: 0 }, 2)).toBe(2);
  });
});

describe("local de retiro", () => {
  it("reconoce cada local por nombre o dirección", () => {
    expect(localDeRetiro({ shipping_pickup_type: "pickup", shipping_option: "Retiro en Magnolia Beauty" })).toBe(2);
    expect(localDeRetiro({ shipping_pickup_type: "pickup", shipping_option: "Retiro en local", shipping_pickup_details: { name: "Local", address: { address: "San Martín", number: "1031" } } })).toBe(1);
    expect(localDeRetiro({ shipping_pickup_type: "pickup", shipping_option: "Magnolia Home & Deco" })).toBe(1);
  });
  it("si es envío no hay local de retiro", () => {
    expect(localDeRetiro({ shipping_pickup_type: "ship", shipping_option: "Correo Argentino" })).toBeNull();
  });
});

describe("estado del pedido", () => {
  const p = (x: Partial<{ cancelado: boolean; pagado: boolean; despachado: boolean }>) => ({ cancelado: false, pagado: false, despachado: false, ...x });
  it("espera el pago y después pasa a preparar", () => {
    expect(siguienteEstado(null, p({}))).toBe("pendiente_pago");
    expect(siguienteEstado("pendiente_pago", p({ pagado: true }))).toBe("a_preparar");
    expect(siguienteEstado(null, p({ pagado: true }))).toBe("a_preparar");
  });
  it("no pisa lo que ya hizo el local", () => {
    expect(siguienteEstado("preparado", p({ pagado: true }))).toBe("preparado");
    expect(siguienteEstado("entregado", p({ pagado: true }))).toBe("entregado");
  });
  it("cancelado y despachado desde Tiendanube", () => {
    expect(siguienteEstado("a_preparar", p({ cancelado: true }))).toBe("cancelado");
    expect(siguienteEstado("preparado", p({ pagado: true, despachado: true }))).toBe("entregado");
    expect(siguienteEstado("cancelado", p({ pagado: true }))).toBe("a_preparar");
  });
});
