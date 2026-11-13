"use client";
// Carga masiva: se elige la carpeta de fotos (o varias fotos) y cada una se asocia sola por el nombre del archivo.
// Reglas (ver planFotos): solo las "-1.jpg"; el producto es el SKU más largo con que empieza el nombre;
// si un SKU tiene varias, la primera en orden alfabético es la principal y cada una va a su color.
// Cada foto se achica en la compu antes de subirla.
import { useState } from "react";
import { Miniatura } from "../../../miniatura";
import { achicarFoto } from "@/lib/fotos-cliente";
import { leerCsvFotos, planFotos, planImportacion, type FotoPlan, type Importacion, type ProductoIndice } from "@/lib/fotos";

type Fila = {
  archivo: string;
  estado: "esperando" | "subiendo" | "ok" | "sin_producto" | "varios" | "sin_color" | "error";
  plan?: FotoPlan & { colorCsv?: string }; detalle?: string; producto?: { id: string; sku: string; nombre: string }; color?: string | null;
  url?: string; blob?: Blob; reemplazo?: boolean; principal?: boolean;
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

/** Una fila del CSV de miniaturas, en el mismo formato que las fotos -1. */
type Plan = FotoPlan & { falta?: boolean; colorCsv?: string };
function desdeCsv(i: Importacion): Plan {
  const base = { archivo: i.fila.miniatura, principal: i.principal, color: i.color ?? null, colorCsv: i.fila.color };
  switch (i.estado) {
    case "listo": return { ...base, estado: "ok", productos: [i.producto!], sinColor: !!i.fila.sufijo && !i.color };
    case "color_no_encontrado": return { ...base, estado: "ok", productos: [i.producto!], principal: false, color: null, sinColor: true };
    case "sku_repetido": return { ...base, estado: "varios", productos: [] };
    case "sin_archivo": return { ...base, estado: "sin_producto", productos: [], falta: true };
    default: return { ...base, estado: "sin_producto", productos: [] };
  }
}

const ruta = (a: File) => (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name;

export function SubirFotos() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [ignoradas, setIgnoradas] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const cambiar = (i: number, f: Partial<Fila>) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, ...f } : x)));

  const procesar = async (todos: File[]) => {
    const archivos = todos.filter((a) => /\.(jpe?g|png|webp)$/i.test(a.name));
    if (!archivos.length) { if (todos.length) setAviso("No encontré fotos (.jpg, .png o .webp) en lo que elegiste."); return; }
    setTrabajando(true); setAviso(null);
    let productos: ProductoIndice[];
    try {
      const r = await fetch("/api/productos/foto/indice", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
      productos = d.productos;
    } catch (e) { setAviso(`No se pudo traer la lista de productos (${(e as Error).message}).`); setTrabajando(false); return; }

    // Carpeta "miniaturas": si viene el CSV, manda el CSV (las .webp ya están en 300x300)
    const csv = todos.find((a) => /_variantes-colores\.csv$/i.test(a.name));
    let porRuta = new Map(archivos.map((a) => [ruta(a), a]));
    let plan: Plan[];
    let listas = false; // las fotos ya vienen hechas: no se achican en la compu
    if (csv) {
      try {
        const webps = archivos.filter((a) => /\.webp$/i.test(a.name));
        const filasCsv = leerCsvFotos(await csv.text());
        porRuta = new Map(webps.map((a) => [a.name, a]));
        plan = planImportacion(filasCsv, webps.map((a) => a.name), productos).map(desdeCsv);
        const enCsv = new Set(filasCsv.map((f) => f.miniatura.toLowerCase()));
        setIgnoradas((n) => n + webps.filter((a) => !enCsv.has(a.name.toLowerCase())).length);
        listas = true;
        // Las de SKU repetido necesitan el archivo para elegir después
        for (const p of plan) if (p.estado === "varios") {
          const fila = filasCsv.find((f) => f.miniatura === p.archivo);
          const lista = productos.filter((x) => (x.sku || x.barcode).toLowerCase().replace(/\//g, "-") === fila?.sku_base.toLowerCase().replace(/\//g, "-"));
          p.productos = lista;
        }
      } catch (e) { setAviso(`No se pudo leer _variantes-colores.csv (${(e as Error).message}).`); setTrabajando(false); return; }
    } else {
      const r = planFotos([...porRuta.keys()], productos);
      plan = r.plan;
      setIgnoradas((n) => n + r.ignoradas.length);
    }
    const inicio = filas.length;
    setFilas((fs) => [...fs, ...plan.map((p): Fila => ({
      archivo: p.archivo, plan: p, principal: p.principal,
      estado: p.falta ? "error" : p.estado === "sin_producto" ? "sin_producto" : p.estado === "varios" ? "esperando" : !p.principal && !p.color ? "sin_color" : "esperando",
      detalle: p.falta ? "No está el archivo en la carpeta." : undefined,
      producto: p.productos.length === 1 ? p.productos[0] : undefined, color: p.color?.color ?? null,
    }))]);

    // De a una, para no saturar la conexión del local
    for (let k = 0; k < plan.length; k++) {
      const p = plan[k], i = inicio + k;
      if (p.estado === "sin_producto" || (p.estado === "ok" && !p.principal && !p.color)) continue;
      const archivo = porRuta.get(p.archivo);
      if (!archivo) continue;
      cambiar(i, { estado: "subiendo" });
      try {
        const blob = listas ? archivo : await achicarFoto(archivo);
        if (p.estado === "varios") { cambiar(i, { estado: "varios", blob }); continue; }
        const d = await enviar(blob, {
          producto_id: p.productos[0].id, principal: p.principal ? "1" : "0",
          ...(p.color ? { variante_id: p.color.id } : {}),
        });
        if (d.estado === "ok") cambiar(i, { estado: "ok", producto: d.producto, url: d.url, reemplazo: d.reemplazo });
        else cambiar(i, { estado: "error", detalle: d.error ?? "Error" });
      } catch (e) { cambiar(i, { estado: "error", detalle: (e as Error).message }); }
    }
    setTrabajando(false);
  };

  const elegir = async (i: number, c: ProductoIndice) => {
    const f = filas[i];
    if (!f.blob) return;
    cambiar(i, { estado: "subiendo" });
    try {
      const d = await enviar(f.blob, { producto_id: c.id });
      if (d.estado === "ok") cambiar(i, { estado: "ok", producto: d.producto, url: d.url, blob: undefined, reemplazo: d.reemplazo });
      else cambiar(i, { estado: "error", detalle: d.error ?? "Error" });
    } catch (e) { cambiar(i, { estado: "error", detalle: (e as Error).message }); }
  };

  const cuenta = (e: Fila["estado"]) => filas.filter((f) => f.estado === e).length;
  const sinColorTotal = cuenta("sin_color") + filas.filter((f) => f.estado === "ok" && f.plan?.sinColor).length;
  const orden: Fila["estado"][] = ["varios", "sin_producto", "sin_color", "error", "subiendo", "esperando", "ok"];
  const entrada = "hidden";

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!trabajando) procesar([...e.dataTransfer.files]); }}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-linea bg-white px-6 py-8 text-center ${trabajando ? "opacity-60" : ""}`}>
        <span className="font-semibold">{trabajando ? "Subiendo fotos…" : "Elegí la carpeta de fotos (o arrastrá las fotos acá)"}</span>
        <div className="flex flex-wrap justify-center gap-2">
          <label className={`boton cursor-pointer ${trabajando ? "pointer-events-none" : ""}`}>
            Elegir carpeta
            {/* @ts-expect-error webkitdirectory: elegir una carpeta entera (con sus subcarpetas) */}
            <input type="file" webkitdirectory="" multiple className={entrada} disabled={trabajando}
              onChange={(e) => { procesar([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <label className={`boton-borde cursor-pointer ${trabajando ? "pointer-events-none" : ""}`}>
            Elegir fotos
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.csv,text/csv" className={entrada} disabled={trabajando}
              onChange={(e) => { procesar([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
        </div>
        <span className="text-xs text-suave">Carpeta <b>miniaturas</b> con <b>_variantes-colores.csv</b>: se sigue el CSV. Carpeta de fotos originales: solo las que terminan en <b>-1.jpg</b>.</span>
      </div>
      {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{aviso}</p>}

      {(filas.length > 0 || ignoradas > 0) && (
        <p className="text-sm">
          <b className="text-green-800">{cuenta("ok")} cargadas</b>
          {cuenta("varios") > 0 && <> · <b className="text-amber-800">{cuenta("varios")} para elegir</b></>}
          {cuenta("sin_producto") > 0 && <> · <b className="text-red-700">{cuenta("sin_producto")} SKU no encontrado</b></>}
          {sinColorTotal > 0 && <> · <b className="text-amber-800">{sinColorTotal} colores no encontrados</b></>}
          {cuenta("error") > 0 && <> · <b className="text-red-700">{cuenta("error")} con error</b></>}
          {cuenta("subiendo") + cuenta("esperando") > 0 && <> · faltan {cuenta("subiendo") + cuenta("esperando")}</>}
          {ignoradas > 0 && <span className="text-suave"> · {ignoradas} salteadas (no son -1 o no están en el CSV)</span>}
        </p>
      )}

      {!trabajando && filas.some((f) => f.plan?.productos[0]?.colores.length) && (() => {
        const conColor = filas.filter((f) => f.estado === "ok" && f.color);
        const sinColor = filas.filter((f) => f.estado === "sin_color" || (f.estado === "ok" && !f.color && f.plan?.sinColor));
        return (
          <div className="tarjeta space-y-3 text-sm">
            <h2 className="font-semibold">Resumen de colores</h2>
            {conColor.length > 0 && (
              <div>
                <p className="font-semibold text-green-800">Quedaron en su color ({conColor.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {conColor.map((f, i) => <li key={i}><span className="text-suave">{f.archivo.split("/").pop()}</span> → <b>{f.producto?.sku} · {f.color}</b>{f.principal ? " (y foto principal)" : ""}</li>)}
                </ul>
              </div>
            )}
            {sinColor.length > 0 && (
              <div>
                <p className="font-semibold text-amber-800">No encontraron color ({sinColor.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {sinColor.map((f, i) => (
                    <li key={i}><span className="text-suave">{f.archivo.split("/").pop()}</span>{f.plan?.colorCsv ? ` (color del CSV: ${f.plan.colorCsv})` : ""} — colores de {f.producto?.sku}: {f.plan?.productos[0]?.colores.map((c) => c.color).join(", ")}
                      {f.estado === "ok" ? " (se cargó solo como foto principal)" : " (no se subió)"}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-suave">Revisá que el nombre del archivo tenga alguna palabra del color, o agregá el color en la columna Colores de la planilla.</p>
              </div>
            )}
          </div>
        );
      })()}

      <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
        {filas.map((f, i) => ({ f, i })).sort((a, b) => orden.indexOf(a.f.estado) - orden.indexOf(b.f.estado)).map(({ f, i }) => (
          <li key={i} className="px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              <Miniatura ruta={f.estado === "ok" ? f.url : null} tam={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.archivo.split("/").pop()}</p>
                {f.estado === "ok" && (
                  <p className="text-green-800">✓ {f.producto?.nombre} <span className="text-suave">({f.producto?.sku})
                    {f.color ? ` · color ${f.color}` : ""}{f.principal ? " · foto principal" : ""}{f.reemplazo ? " · reemplazó la anterior" : ""}</span></p>
                )}
                {f.estado === "sin_producto" && <p className="text-red-700">{/\.webp$/i.test(f.archivo) ? "El SKU del CSV no está en el sistema." : "El nombre no empieza con el SKU de ningún producto."}</p>}
                {f.estado === "sin_color" && <p className="text-amber-800">{f.plan?.colorCsv ? `El color «${f.plan.colorCsv}» no está en la columna Colores de ${f.producto?.sku}.` : `Es otra foto de ${f.producto?.nombre} (${f.producto?.sku}), pero el nombre no dice de qué color es o ese color no está en la columna Colores.`} No se subió.</p>}
                {f.estado === "error" && <p className="text-red-700">{f.detalle}</p>}
                {f.estado === "subiendo" && <p className="text-suave">Subiendo…</p>}
                {f.estado === "esperando" && <p className="text-suave">En espera</p>}
                {f.estado === "varios" && <p className="text-amber-800">Hay {f.plan?.productos.length} productos con ese SKU. Elegí a cuál va:</p>}
              </div>
            </div>
            {f.estado === "varios" && (
              <ul className="mt-2 space-y-1 pl-14">
                {f.plan?.productos.map((c) => (
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
