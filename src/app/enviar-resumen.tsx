"use client";
// Botones para mandar el resumen del cierre por WhatsApp (a los números configurados o a quien se elija).
import { useState } from "react";
import { linkWhatsapp, numeroWhatsapp } from "@/lib/resumen-cierre";

export function EnviarResumen({ texto, whatsapp, mail }: { texto: string; whatsapp: { nombre: string; numero: string }[]; mail?: string | null }) {
  const [copiado, setCopiado] = useState(false);
  const [ver, setVer] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Mandar el resumen por WhatsApp</p>
      <div className="flex flex-wrap gap-2">
        {whatsapp.map((w) => {
          const n = numeroWhatsapp(w.numero);
          return n ? <a key={w.numero} href={linkWhatsapp(texto, n)} target="_blank" rel="noreferrer" className="boton !py-2 !bg-[#1f8f4e]">A {w.nombre || w.numero}</a> : null;
        })}
        <a href={linkWhatsapp(texto)} target="_blank" rel="noreferrer" className="boton-borde !py-2">{whatsapp.length ? "A otro contacto" : "Elegir contacto"}</a>
        <button className="boton-borde !py-2" onClick={async () => { try { await navigator.clipboard.writeText(texto.replace(/\*/g, "")); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {} }}>{copiado ? "¡Copiado!" : "Copiar texto"}</button>
        <button className="text-sm text-suave underline" onClick={() => setVer(!ver)}>{ver ? "Ocultar" : "Ver texto"}</button>
      </div>
      {mail === "enviado" && <p className="text-sm text-green-800">✓ También se mandó por mail.</p>}
      {mail && mail !== "enviado" && <p className="text-sm text-amber-800">No se pudo mandar el mail: {mail}</p>}
      {ver && <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs">{texto}</pre>}
    </div>
  );
}
