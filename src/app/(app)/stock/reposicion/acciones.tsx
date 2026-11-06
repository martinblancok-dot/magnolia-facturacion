"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccionesPedido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex gap-2 text-sm">
      <button className="boton-borde !py-1" onClick={async () => { try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {} }}>
        {copiado ? "¡Copiado!" : "Copiar pedido"}
      </button>
      <a className="boton-borde !py-1" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(texto)}`}>WhatsApp</a>
    </div>
  );
}

/** Deja la transferencia sugerida lista en la pantalla de Stock para revisarla y confirmarla. */
export function CargarTransferencias({ desde, items, texto }: { desde: 1 | 2; items: { id: string; sku: string; nombre: string; cantidad: number }[]; texto: string }) {
  const router = useRouter();
  return (
    <button className="boton !py-1.5 text-sm" onClick={() => {
      try { localStorage.setItem(`magnolia-stock-transferencia-${desde}`, JSON.stringify({ lineas: items, desconocidos: [], nota: "Reposición sugerida" })); } catch {}
      router.push(`/stock?modo=transferencia&local=${desde}`);
    }}>{texto}</button>
  );
}
