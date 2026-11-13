"use client";
// Carga masiva: cada foto se achica en la compu y se asocia sola por el nombre del archivo.
// Las que coinciden con más de un producto quedan para que el usuario elija a cuál va.
import { useState } from "react";
import { Miniatura } from "../../../miniatura";
import { achicarFoto } from "@/lib/fotos-cliente";

type Candidato = { id: string; sku: string; barcode: string; nombre: string };
type Fila = {
  archivo: string; estado: "esperando" | "subiendo" | "ok" | "sin_producto" | "varios" | "error";
  detalle?: string; producto?: { id: string; sku: string; nombre: string }; url?: string; candidatos?: Candidato[]; blob?: Blob; reemplazo?: boolean;
};

async function enviar(blob: Blob, campos: Record<string, string>) {
  const fd = new FormData();
  fd.set("foto", blob, "foto");
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  const r = await fetch("/api/productos/foto", { method: "POST", body: fd });
  const d = await r.json().catch(() => ({ error: `Error ${r.status}` }));
  if (!r.ok && !d.estado) throw new Error(d.error ?? `Error ${r.status}`);
  return d;
}

export function SubirFotos() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const cambiar = (i: number, f: Partial<Fila>) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, ...f } : x)));

  const procesar = async (archivos: File[]) => {
    const validos = archivos.filter((a) => /\.(jpe?g|png|webp)$/i.test(a.name));
    const inicio = filas.length;
    setFilas((fs) => [...fs, ...validos.map((a): Fila => ({ archivo: a.name, estado: "esperando" }))]);
    setTrabajando(true);
    // De a una, para no saturar la conexión del local
    for (let k = 0; k < validos.length; k++) {
      const i = inicio + k;
      cambiar(i, { estado: "subiendo" });
      try {
        const blob = await achicarFoto(validos[k]);
        const d = await enviar(blob, { archivo: validos[k].name });
        if (d.estado === "ok") cambiar(i, { estado: "ok", producto: d.producto, url: d.url, reemplazo: d.reemplazo });
        else if (d.estado === "varios") cambiar(i, { estado: "varios", candidatos: d.productos, blob });
        else if (d.estado === "sin_producto") cambiar(i, { estado: "sin_producto", detalle: d.codigo });
        else cambiar(i, { estado: "error", detalle: d.error ?? "Error" });
      } catch (e) { cambiar(i, { estado: "error", detalle: (e as Error).message }); }
    }
    setTrabajando(false);
  };

  const elegir = async (i: number, c: Candidato) => {
    const f = filas[i];
    if (!f.blob) return;
    cambiar(i, { estado: "subiendo" });
    try {
      const d = await enviar(f.blob, { producto_id: c.id });
      if (d.estado === "ok") cambiar(i, { estado: "ok", producto: d.producto, url: d.url, candidatos: undefined, blob: undefined, reemplazo: d.reemplazo });
      else cambiar(i, { estado: "error", detalle: d.error ?? "Error" });
    } catch (e) { cambiar(i, { estado: "error", detalle: (e as Error).message }); }
  };

  const cuenta = (e: Fila["estado"]) => filas.filter((f) => f.estado === e).length;
  const orden: Fila["estado"][] = ["varios", "sin_producto", "error", "subiendo", "esperando", "ok"];

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!trabajando) procesar([...e.dataTransfer.files]); }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-linea bg-white px-6 py-10 text-center ${trabajando ? "opacity-60" : "hover:border-marca"}`}>
        <span className="font-semibold">{trabajando ? "Subiendo fotos…" : "Elegí o arrastrá las fotos acá"}</span>
        <span className="mt-1 text-sm text-suave">Podés elegir muchas a la vez</span>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="hidden" disabled={trabajando}
          onChange={(e) => { procesar([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </label>

      {filas.length > 0 && (
        <p className="text-sm">
          <b className="text-green-800">{cuenta("ok")} asociadas</b>
          {cuenta("varios") > 0 && <> · <b className="text-amber-800">{cuenta("varios")} para elegir</b></>}
          {cuenta("sin_producto") > 0 && <> · <b className="text-red-700">{cuenta("sin_producto")} sin producto</b></>}
          {cuenta("error") > 0 && <> · <b className="text-red-700">{cuenta("error")} con error</b></>}
          {cuenta("subiendo") + cuenta("esperando") > 0 && <> · faltan {cuenta("subiendo") + cuenta("esperando")}</>}
        </p>
      )}

      <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
        {filas.map((f, i) => ({ f, i })).sort((a, b) => orden.indexOf(a.f.estado) - orden.indexOf(b.f.estado)).map(({ f, i }) => (
          <li key={i} className="px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              {f.estado === "ok" ? <Miniatura ruta={f.url} tam={44} /> : <Miniatura ruta={null} tam={44} />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.archivo}</p>
                {f.estado === "ok" && <p className="text-green-800">✓ {f.producto?.nombre} <span className="text-suave">({f.producto?.sku}){f.reemplazo ? " · reemplazó la anterior" : ""}</span></p>}
                {f.estado === "sin_producto" && <p className="text-red-700">No hay ningún producto con SKU o código «{f.detalle}».</p>}
                {f.estado === "error" && <p className="text-red-700">{f.detalle}</p>}
                {f.estado === "subiendo" && <p className="text-suave">Subiendo…</p>}
                {f.estado === "esperando" && <p className="text-suave">En espera</p>}
                {f.estado === "varios" && <p className="text-amber-800">Hay {f.candidatos?.length} productos con ese código. Elegí a cuál va:</p>}
              </div>
            </div>
            {f.estado === "varios" && (
              <ul className="mt-2 space-y-1 pl-14">
                {f.candidatos?.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5">
                    <span>{c.nombre} <span className="text-xs text-suave">· SKU {c.sku} · cód. {c.barcode}</span></span>
                    <button className="boton-borde py-1 text-xs" onClick={() => elegir(i, c)}>Usar para este</button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
