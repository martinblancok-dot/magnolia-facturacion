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
  const enEfectivo = venta.pagos?.length ? venta.pagos.find((p) => p.efectivo)?.monto ?? 0 : venta.total;
  const vuelto = venta.paga_con && venta.paga_con > enEfectivo ? venta.paga_con - enEfectivo : 0;
  return (
    <div className="impreso">
      <p className="t-centro t-grande">{l.nombre}</p>
      <p className="t-centro">{l.direccion} · General Alvear</p>
      <hr />
      {tipo === "constancia" && venta.movimiento ? (
        <>
          <p className="t-centro t-negrita t-grande">{venta.movimiento.tipo === "retiro" ? "RETIRO DE EFECTIVO" : venta.movimiento.tipo === "gasto" ? "GASTO PAGADO CON LA CAJA" : "INGRESO DE EFECTIVO"}</p>
          <p className="t-centro">Constancia · no válido como factura</p>
          <hr />
          <p>{fechaHora(venta.creada_en)}</p>
          <p className="t-centro t-enorme">{pesos(venta.total)}</p>
          <p><b>Motivo:</b> {venta.movimiento.motivo || "—"}</p>
          {venta.movimiento.registro && <p><b>Anotó:</b> {venta.movimiento.registro}</p>}
          <p className="t-chico">Comprobante {codigo}</p>
          <hr />
          {(venta.movimiento.tipo === "ingreso"
            ? ["Entregó el dinero", "Recibió (caja)"]
            : [venta.movimiento.tipo === "retiro" ? "Retiró el dinero" : "Recibió el pago", "Entregó (caja)"]).map((t) => (
            <div key={t} className="firma">
              <p className="firma-linea">Firma</p>
              <p className="firma-linea">Aclaración</p>
              <p className="t-centro t-negrita">{t}</p>
            </div>
          ))}
        </>
      ) : tipo === "giftcard" && venta.giftcard_nueva ? (
        <>
          <p className="t-centro t-negrita t-grande">GIFT CARD</p>
          {venta.giftcard_nueva.destinatario && <p className="t-centro t-grande">Para {venta.giftcard_nueva.destinatario}</p>}
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
          {venta.cambio ? (
            <>
              <p className="t-centro t-negrita">CAMBIO de la venta {venta.cambio.codigo}</p>
              <p className="fila"><span>Crédito por lo devuelto</span><span>{pesos(venta.cambio.credito)}</span></p>
              {venta.total > 0 && <p className="fila t-grande"><span>Pagó diferencia ({venta.medio})</span><span>{pesos(venta.total)}</span></p>}
              {venta.giftcard_nueva && <p className="fila t-negrita"><span>Saldo a favor: gift card {venta.giftcard_nueva.codigo}</span><span>{pesos(venta.giftcard_nueva.monto)}</span></p>}
            </>
          ) : venta.giftcard ? (
            <>
              <p className="fila t-grande"><span>TOTAL</span><span>{pesos(venta.total + venta.giftcard.usado)}</span></p>
              <p className="fila"><span>Gift card {venta.giftcard.codigo}</span><span>−{pesos(venta.giftcard.usado)}</span></p>
              {venta.giftcard.saldo !== null && <p className="fila t-chico"><span>Saldo que queda en la tarjeta</span><span>{pesos(venta.giftcard.saldo)}</span></p>}
              {venta.total > 0 && <p className="fila t-negrita"><span>Resto en {venta.medio}</span><span>{pesos(venta.total)}</span></p>}
            </>
          ) : (
            <>
              <p className="fila t-grande"><span>TOTAL</span><span>{pesos(venta.total)}</span></p>
              {venta.pagos?.length
                ? venta.pagos.map((p) => <p key={p.medio} className="fila"><span>{p.medio}</span><span>{pesos(p.monto)}</span></p>)
                : <p className="fila"><span>Pago</span><span>{venta.medio}</span></p>}
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
      {tipo !== "constancia" && (
        <>
          <hr />
          <p className="t-centro">¡Gracias por elegirnos!</p>
          <p className="t-centro">{l.instagram}</p>
        </>
      )}
    </div>
  );
}

/** Imprime un recibo o ticket. Se dibuja en una zona que solo aparece al imprimir. */
export function useImpresion() {
  const [trabajo, setTrabajo] = useState<{ venta: VentaImpresa; tipo: TipoImpreso; n: number; copias: number } | null>(null);
  const [papel, setPapelState] = useState<Papel>(() => {
    if (typeof window === "undefined") return "58";
    try { return (localStorage.getItem("magnolia-papel") as Papel) || "58"; } catch { return "58"; }
  });
  useEffect(() => {
    if (!trabajo) return;
    const limpiar = () => setTrabajo(null); // así nunca quedan dos tickets en la zona de impresión
    window.addEventListener("afterprint", limpiar, { once: true });
    const t = setTimeout(() => window.print(), 80); // deja dibujar el código de barras antes
    return () => { clearTimeout(t); window.removeEventListener("afterprint", limpiar); };
  }, [trabajo]);
  const setPapel = (p: Papel) => { setPapelState(p); try { localStorage.setItem("magnolia-papel", p); } catch {} };
  const imprimir = (venta: VentaImpresa, tipo: TipoImpreso, copias = 1) => setTrabajo({ venta, tipo, n: Date.now(), copias: Math.max(1, Math.min(20, Math.round(copias))) });
  const zona = trabajo ? (
    <div id="zona-impresion" data-papel={papel} key={trabajo.n}>
      {Array.from({ length: trabajo.copias }, (_, i) => <div key={i} className="copia"><Impreso venta={trabajo.venta} tipo={trabajo.tipo} /></div>)}
    </div>
  ) : null;
  return { imprimir, zona, papel, setPapel };
}

/** Botón "Ticket de cambio" con cantidad (para varios regalos de una misma compra). */
export function BotonTicketsCambio({ onImprimir, chico = false }: { onImprimir: (copias: number) => void; chico?: boolean }) {
  const [n, setN] = useState(1);
  const paso = chico ? "px-1.5 py-1 text-xs" : "px-2.5 py-2";
  return (
    <span className={`inline-flex items-stretch overflow-hidden rounded-lg border ${chico ? "border-green-300 bg-white" : "border-marca"}`}>
      <button type="button" className={`${chico ? "px-2 py-1 text-xs" : "flex-1 px-3 py-2"} font-semibold ${chico ? "" : "text-marca"}`} onClick={() => onImprimir(n)}>
        {n > 1 ? `${n} tickets de cambio` : "Ticket de cambio"}
      </button>
      <button type="button" aria-label="Menos tickets" className={`border-l ${chico ? "border-green-300" : "border-marca/40"} ${paso}`} disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
      <button type="button" aria-label="Más tickets" className={`border-l ${chico ? "border-green-300" : "border-marca/40"} ${paso}`} disabled={n >= 20} onClick={() => setN(n + 1)}>+</button>
    </span>
  );
}
