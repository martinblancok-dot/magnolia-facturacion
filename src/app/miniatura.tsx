"use client";
// Miniatura de un producto. Sin foto (o si no carga, por ejemplo sin internet) muestra un ícono gris
// y no frena nada: la imagen se pide aparte y, si falla, se reemplaza por el ícono.
import { useState } from "react";
import { urlFoto } from "@/lib/fotos";

export function Miniatura({ ruta, tam = 44, alt = "" }: { ruta: string | null | undefined; tam?: number; alt?: string }) {
  const url = urlFoto(ruta);
  const [fallo, setFallo] = useState<string | null>(null);
  const caja = { width: tam, height: tam };
  if (!url || fallo === url) {
    return (
      <span style={caja} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400" aria-hidden>
        <svg viewBox="0 0 24 24" width={tam * 0.5} height={tam * 0.5} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="1.8" /><path d="m21 15-4.5-4.5L6 21" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- miniatura ya optimizada (300px .webp), no pasa por el optimizador de Next
    <img src={url} alt={alt} width={tam} height={tam} loading="lazy" decoding="async" draggable={false}
      onError={() => setFallo(url)} style={caja} className="shrink-0 rounded-lg bg-gray-100 object-cover" />
  );
}
