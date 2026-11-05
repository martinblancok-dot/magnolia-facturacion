"use client";
export function Imprimir() {
  return <button className="boton-borde print:hidden" onClick={() => window.print()}>Imprimir</button>;
}
