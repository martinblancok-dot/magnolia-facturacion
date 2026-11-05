"use client";
// Recibo X y ticket de cambio, listos para la impresora térmica (80 o 58 mm) o una hoja A4.
import JsBarcode from "jsbarcode";
import { useEffect, useRef, useState } from "react";
import { codigoVenta, DATOS_LOCAL, DIAS_CAMBIO, venceCambio, type Papel, type VentaImpresa } from "@/lib/impresion";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n);
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const fecha = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

function Barras({ valor }: { valor: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, valor, { format: "CODE128", width: 2, height: 48, displayValue: false, margin: 0 });
  }, [valor]);
  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

export function Impreso({ venta, tipo }: { venta: VentaImpresa; tipo: "recibo" | "cambio" }) {
  const l = DATOS_LOCAL[venta.local_id] ?? DATOS_LOCAL[1];
  const codigo = codigoVenta(venta.id);
  const vuelto = venta.paga_con && venta.paga_con > venta.total ? venta.paga_con - venta.total : 0;
  return (
    <div className="impreso">
      <p className="t-centro t-grande">{l.nombre}</p>
      <p className="t-centro">{l.direccion} · General Alvear</p>
      <hr />
      {tipo === "recibo" ? (
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
          <p className="fila t-grande"><span>TOTAL</span><span>{pesos(venta.total)}</span></p>
          <p className="fila"><span>Pago</span><span>{venta.medio}</span></p>
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
  const [trabajo, setTrabajo] = useState<{ venta: VentaImpresa; tipo: "recibo" | "cambio"; n: number } | null>(null);
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
  const imprimir = (venta: VentaImpresa, tipo: "recibo" | "cambio") => setTrabajo({ venta, tipo, n: Date.now() });
  const zona = trabajo ? (
    <div id="zona-impresion" data-papel={papel} key={trabajo.n}>
      <Impreso venta={trabajo.venta} tipo={trabajo.tipo} />
    </div>
  ) : null;
  return { imprimir, zona, papel, setPapel };
}
