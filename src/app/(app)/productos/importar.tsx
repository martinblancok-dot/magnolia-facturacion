"use client";
import { useActionState } from "react";
import { importarCatalogo, type ResultadoImportacion } from "../../acciones";
import { Aviso } from "../../componentes";

export function ImportarCatalogo() {
  const [r, enviar, cargando] = useActionState<ResultadoImportacion | null, FormData>(importarCatalogo, null);
  return (
    <form action={enviar}>
      <input name="archivo" type="file" accept=".xlsx" className="mt-3 block text-sm" />
      <button className="boton mt-4" disabled={cargando}>{cargando ? "Leyendo la planilla… (puede tardar)" : "Importar"}</button>
      <Aviso m={r} />
      {r?.conflictos && r.conflictos.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Códigos de barras repetidos ({r.conflictos.length})</summary>
          <p className="mt-1 text-suave">Dos productos distintos con el mismo código. Quedó cargado el primero; corregí el otro en la planilla y volvé a importar.</p>
          <ul className="mt-2 space-y-2">
            {r.conflictos.map((c, i) => (
              <li key={i} className="rounded-lg bg-amber-50 p-2">
                <span className="font-mono">{c.barcode}</span><br />
                <span className="text-green-800">Quedó: {c.queda}</span><br />
                <span className="text-red-800">Sin cargar: {c.descartado}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
