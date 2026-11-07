"use client";
import { BotonTicketsCambio, useImpresion } from "../../impreso";
import type { VentaImpresa } from "@/lib/impresion";

export function Reimprimir({ venta }: { venta: VentaImpresa }) {
  const { imprimir, zona } = useImpresion();
  return (
    <>
      {zona}
      <button type="button" className="boton-borde !px-3 !py-1.5 text-sm" onClick={() => imprimir(venta, "recibo")}>Recibo X</button>
      {venta.giftcard_nueva
        ? <button type="button" className="boton-borde !px-3 !py-1.5 text-sm" onClick={() => imprimir(venta, "giftcard")}>Gift card</button>
        : <span className="text-sm"><BotonTicketsCambio chico onImprimir={(n) => imprimir(venta, "cambio", n)} /></span>}
    </>
  );
}
