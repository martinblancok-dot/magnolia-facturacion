"use client";
// Recibo X y ticket de cambio, listos para la impresora térmica (80 o 58 mm) o una hoja A4.
import JsBarcode from "jsbarcode";
import { useEffect, useRef, useState } from "react";
import { codigoVenta, DATOS_LOCAL, DIAS_CAMBIO, venceCambio, type Papel, type TipoImpreso, type VentaImpresa } from "@/lib/impresion";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n);
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const fecha = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

function Barras({ valor }: { valor: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, valor, { format: "CODE128", width: 2, height: 48, displayValue: false, margin: 10 });
  }, [valor]);
  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

export function Impreso({ venta, tipo }: { venta: VentaImpresa; tipo: TipoImpreso }) {
  const l = DATOS_LOCAL[venta.local_id] ?? DATOS_LOCAL[1];
  const codigo = codigoVenta(venta.id);
  const vuelto = venta.paga_con && venta.paga_con > venta.total ? venta.paga_con - venta.total : 0;
  return (
    <div className="impreso">
      <p className="t-centro t-grande">{l.nombre}</p>
      <p className="t-centro">{l.direccion} · General Alvear</p>
      <hr />
      {tipo === "giftcard" && venta.giftcard_nueva ? (
        <>
          <p className="t-centro t-negrita t-grande">GIFT CARD</p>
          <p className="t-centro t-enorme">{pesos(venta.giftcard_nueva.monto)}</p>
          <p className="t-centro">Emitida el {fecha(new Date(venta.creada_en))}</p>
          <hr />
          <Barras valor={`GC${venta.giftcard_nueva.codigo}`} />
          <p className="t-centro t-grande">{venta.giftcard_nueva.codigo}</p>
          <hr />
          <p className="t-centro">Válida en <b>Magnolia Home</b> (San Martín 1031) y <b>Magnolia Beauty</b> (San Martín 784).</p>
          <p className="t-centro t-chico">Se puede usar en una o varias compras hasta agotar el saldo. Presentá esta tarjeta al pagar.</p>
        </>
      ) : tipo === "recibo" ? (
        <>
          <p className="t-centro t-negrita">RECIBO X</p>
          <p className="t-centro t-chico">Documento no válido como factura</p>
          <p>Fecha: {fechaHora(venta.creada_en)}</p>
          <p>Venta: {codigo}</p>
          <hr />
          {venta.items.map((it, i) => (
            <div key={i} className="item">
              <p>{it.nombre}</p>
              <p className="fila"><span>{Number(it.cantidad)} × {pesos(it.precio_unitario)}</span><span>{pesos(it.total)}</span></p>
            </div>
          ))}
          <hr />
          {venta.giftcard ? (
            <>
              <p className="fila t-grande"><span>TOTAL</span><span>{pesos(venta.total + venta.giftcard.usado)}</span></p>
              <p className="fila"><span>Gift card {venta.giftcard.codigo}</span><span>−{pesos(venta.giftcard.usado)}</span></p>
              {venta.giftcard.saldo !== null && <p className="fila t-chico"><span>Saldo que queda en la tarjeta</span><span>{pesos(venta.giftcard.saldo)}</span></p>}
              {venta.total > 0 && <p className="fila t-negrita"><span>Resto en {venta.medio}</span><span>{pesos(venta.total)}</span></p>}
            </>
          ) : (
            <>
              <p className="fila t-grande"><span>TOTAL</span><span>{pesos(venta.total)}</span></p>
              <p className="fila"><span>Pago</span><span>{venta.medio}</span></p>
            </>
          )}
          {venta.paga_con ? <p className="fila"><span>Paga con</span><span>{pesos(venta.paga_con)}</span></p> : null}
          {vuelto > 0 && <p className="fila"><span>Vuelto</span><span>{pesos(vuelto)}</span></p>}
          <hr />
          <Barras valor={codigo} />
          <p className="t-centro t-chico">Cambios dentro de los {DIAS_CAMBIO} días con este comprobante</p>
        </>
      ) : (
        <>
          <p className="t-centro t-negrita">TICKET DE CAMBIO</p>
          <p className="t-centro">Fecha de compra: {fecha(new Date(venta.creada_en))}</p>
          <hr />
          <Barras valor={codigo} />
          <p className="t-centro t-grande">{codigo}</p>
          <hr />
          <p className="t-centro">Tenés <b>{DIAS_CAMBIO} días</b> para cambiarlo:</p>
          <p className="t-centro t-negrita">hasta el {fecha(venceCambio(venta.creada_en))}</p>
          <p className="t-centro t-chico">Presentá este ticket y el producto en buen estado, con su etiqueta.</p>
        </>
      )}
      <hr />
      <p className="t-centro">¡Gracias por elegirnos!</p>
      <p className="t-centro">{l.instagram}</p>
    </div>
  );
}

/** Imprime un recibo o ticket. Se dibuja en una zona que solo aparece al imprimir. */
export function useImpresion() {
  const [trabajo, setTrabajo] = useState<{ venta: VentaImpresa; tipo: TipoImpreso; n: number } | null>(null);
  const [papel, setPapelState] = useState<Papel>(() => {
    if (typeof window === "undefined") return "80";
    try { return (localStorage.getItem("magnolia-papel") as Papel) || "80"; } catch { return "80"; }
  });
  useEffect(() => {
    if (!trabajo) return;
    const limpiar = () => setTrabajo(null); // así nunca quedan dos tickets en la zona de impresión
    window.addEventListener("afterprint", limpiar, { once: true });
    const t = setTimeout(() => window.print(), 80); // deja dibujar el código de barras antes
    return () => { clearTimeout(t); window.removeEventListener("afterprint", limpiar); };
  }, [trabajo]);
  const setPapel = (p: Papel) => { setPapelState(p); try { localStorage.setItem("magnolia-papel", p); } catch {} };
  const imprimir = (venta: VentaImpresa, tipo: TipoImpreso) => setTrabajo({ venta, tipo, n: Date.now() });
  const zona = trabajo ? (
    <div id="zona-impresion" data-papel={papel} key={trabajo.n}>
      <Impreso venta={trabajo.venta} tipo={trabajo.tipo} />
    </div>
  ) : null;
  return { imprimir, zona, papel, setPapel };
}
