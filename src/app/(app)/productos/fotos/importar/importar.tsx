"use client";
// Importar miniaturas ya hechas: carpeta FINALES/miniaturas con los .webp y el archivo _variantes-colores.csv.
import { useState } from "react";
import { Miniatura } from "../../../../miniatura";
import { leerCsvFotos, planImportacion, type Importacion, type ProductoIndice } from "@/lib/fotos";

type Resultado = "cargada" | "ya_tenia" | "error";
type Fila = Importacion & { resultado?: Resultado; detalle?: string; url?: string | null };

const nombre = (a: File) => a.name;

export function ImportarFotos() {
  const [archivos, setArchivos] = useState<Map<string, File>>(new Map());
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [reemplazar, setReemplazar] = useState(false);
  const [estado, setEstado] = useState<"elegir" | "listo" | "subiendo" | "terminado">("elegir");
  const [aviso, setAviso] = useState<string | null>(null);
  const [hecho, setHecho] = useState(0);

  const elegir = async (lista: File[]) => {
    setAviso(null); setFilas(null); setEstado("elegir");
    const csv = lista.find((a) => /_variantes-colores\.csv$/i.test(a.name)) ?? lista.find((a) => /\.csv$/i.test(a.name));
    const webps = lista.filter((a) => /\.webp$/i.test(a.name));
    if (!csv) { setAviso("Falta el archivo _variantes-colores.csv (elegí la carpeta entera, o sumalo junto con las fotos)."); return; }
    if (!webps.length) { setAviso("No encontré fotos .webp."); return; }
    try {
      const filasCsv = leerCsvFotos(await csv.text());
      const r = await fetch("/api/productos/foto/indice", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
      const productos: ProductoIndice[] = d.productos;
      setArchivos(new Map(webps.map((a) => [nombre(a).toLowerCase(), a])));
      setFilas(planImportacion(filasCsv, webps.map(nombre), productos));
      setEstado("listo");
    } catch (e) { setAviso((e as Error).message); }
  };

  const importar = async () => {
    if (!filas) return;
    setEstado("subiendo"); setHecho(0);
    const copia = [...filas];
    for (let i = 0; i < copia.length; i++) {
      const f = copia[i];
      if (f.estado !== "listo" || !f.producto) continue;
      try {
        const fd = new FormData();
        fd.set("foto", archivos.get(f.fila.miniatura.toLowerCase())!, f.fila.miniatura);
        fd.set("producto_id", f.producto.id);
        fd.set("principal", f.principal ? "1" : "0");
        fd.set("reemplazar", reemplazar ? "1" : "0");
        if (f.color) fd.set("variante_id", f.color.id);
        const r = await fetch("/api/productos/foto", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({ error: `Error ${r.status}` }));
        copia[i] = d.estado === "ok" ? { ...f, resultado: "cargada", url: d.url } : d.estado === "ya_tenia" ? { ...f, resultado: "ya_tenia" } : { ...f, resultado: "error", detalle: d.error ?? `Error ${r.status}` };
      } catch (e) { copia[i] = { ...f, resultado: "error", detalle: (e as Error).message }; }
      setFilas([...copia]);
      setHecho((n) => n + 1);
    }
    setEstado("terminado");
  };

  const n = (fn: (f: Fila) => boolean) => (filas ?? []).filter(fn).length;
  const aSubir = n((f) => f.estado === "listo");
  const grupos: { titulo: string; clase: string; filtro: (f: Fila) => boolean; texto: (f: Fila) => string }[] = [
    { titulo: "Cargadas", clase: "text-green-800", filtro: (f) => f.resultado === "cargada", texto: (f) => `${f.producto?.nombre}${f.color ? ` · ${f.color.color}` : ""}${f.principal && f.color ? " (también foto principal)" : ""}` },
    { titulo: "SKU no encontrado", clase: "text-red-700", filtro: (f) => f.estado === "sku_no_encontrado", texto: (f) => `${f.fila.sku_base} — ${f.fila.miniatura}` },
    { titulo: "Ya tenían foto (no se tocaron)", clase: "text-suave", filtro: (f) => f.resultado === "ya_tenia", texto: (f) => `${f.producto?.nombre}${f.color ? ` · ${f.color.color}` : ""}` },
    { titulo: "Color no cargado en la planilla", clase: "text-amber-800", filtro: (f) => f.estado === "color_no_encontrado" || (f.estado === "listo" && !!f.fila.sufijo && !f.color), texto: (f) => `${f.fila.sku_base} · ${f.fila.color}${f.estado === "listo" ? " (se cargó solo como foto principal)" : ""}` },
    { titulo: "SKU repetido en dos productos", clase: "text-amber-800", filtro: (f) => f.estado === "sku_repetido", texto: (f) => `${f.fila.sku_base} — subila a mano desde la ficha del producto` },
    { titulo: "Falta el archivo .webp", clase: "text-amber-800", filtro: (f) => f.estado === "sin_archivo", texto: (f) => f.fila.miniatura },
    { titulo: "Con error", clase: "text-red-700", filtro: (f) => f.resultado === "error", texto: (f) => `${f.fila.miniatura}: ${f.detalle}` },
  ];

  return (
    <div className="space-y-4">
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (estado !== "subiendo") elegir([...e.dataTransfer.files]); }}
        className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-linea bg-white px-6 py-8 text-center">
        <span className="font-semibold">Elegí la carpeta <code>FINALES\miniaturas</code></span>
        <div className="flex flex-wrap justify-center gap-2">
          <label className={`boton cursor-pointer ${estado === "subiendo" ? "pointer-events-none opacity-60" : ""}`}>
            Elegir carpeta
            {/* @ts-expect-error webkitdirectory: elegir una carpeta entera */}
            <input type="file" webkitdirectory="" multiple className="hidden" onChange={(e) => { elegir([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <label className={`boton-borde cursor-pointer ${estado === "subiendo" ? "pointer-events-none opacity-60" : ""}`}>
            Elegir .webp + CSV
            <input type="file" multiple accept=".webp,.csv,image/webp,text/csv" className="hidden" onChange={(e) => { elegir([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
        </div>
        <span className="text-xs text-suave">Tiene que estar el archivo <b>_variantes-colores.csv</b> junto con las fotos.</span>
      </div>
      {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{aviso}</p>}

      {filas && estado === "listo" && (
        <div className="tarjeta space-y-3 text-sm">
          <p><b>{aSubir}</b> fotos listas para subir de {filas.length} filas del CSV.
            {n((f) => f.estado === "sku_no_encontrado") > 0 && <> {n((f) => f.estado === "sku_no_encontrado")} con SKU que no está en el sistema.</>}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} className="mt-1" />
            <span>Reemplazar las fotos que ya están cargadas <span className="block text-suave">Si no lo marcás, los productos y colores que ya tienen foto quedan como están.</span></span>
          </label>
          <button className="boton" disabled={!aSubir} onClick={importar}>Importar {aSubir} fotos</button>
        </div>
      )}
      {estado === "subiendo" && <p className="text-sm">Subiendo… {hecho} de {aSubir}</p>}

      {filas && (estado === "terminado" || estado === "subiendo") && (
        <div className="space-y-3">
          <p className="text-base font-semibold">
            <span className="text-green-800">{n((f) => f.resultado === "cargada")} cargadas</span>
            {" · "}<span className="text-red-700">{n((f) => f.estado === "sku_no_encontrado")} SKU no encontrado</span>
            {" · "}<span className="text-suave">{n((f) => f.resultado === "ya_tenia")} ya tenían foto</span>
          </p>
          {grupos.map((g) => {
            const lista = filas.filter(g.filtro);
            if (!lista.length) return null;
            return (
              <details key={g.titulo} open={g.titulo !== "Cargadas"} className="rounded-xl border border-linea bg-white p-3 text-sm">
                <summary className={`cursor-pointer font-semibold ${g.clase}`}>{g.titulo} ({lista.length})</summary>
                <ul className="mt-2 space-y-1">
                  {lista.map((f, i) => (
                    <li key={i} className="flex items-center gap-2">
                      {g.titulo === "Cargadas" && <Miniatura ruta={f.url} tam={32} />}
                      <span>{g.texto(f)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
