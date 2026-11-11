"use client";
import { useState, useTransition } from "react";
import { publicarEnTienda, type Mensaje } from "../../acciones";
import { Aviso } from "../../componentes";

export type FilaTienda = {
  id: string; nombre: string; sku: string; categoria: string | null; precio: string;
  deco: number; beauty: number; online: number; publicar: boolean; enTienda: boolean; estado: string; error: boolean;
};

export function ListaTienda({ filas }: { filas: FilaTienda[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [cargando, empezar] = useTransition();
  const todos = filas.length > 0 && filas.every((f) => sel.has(f.id));
  const marcar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const aplicar = (publicar: boolean, ids = [...sel]) => empezar(async () => { setMsg(await publicarEnTienda(ids, publicar)); setSel(new Set()); });

  if (!filas.length) return <p className="rounded-2xl border border-linea bg-white px-6 py-10 text-center text-suave">No hay productos con ese filtro.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-suave">{sel.size ? `${sel.size} elegidos` : `${filas.length} productos`}</span>
        <button className="boton !py-1.5" disabled={!sel.size || cargando} onClick={() => aplicar(true)}>Publicar en la tienda</button>
        <button className="boton-borde !py-1.5" disabled={!sel.size || cargando} onClick={() => aplicar(false)}>Ocultar de la tienda</button>
        {cargando && <span className="text-suave">Guardando…</span>}
      </div>
      <Aviso m={msg} />
      <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
        <table className="w-full text-sm">
          <thead className="bg-marca-claro text-left text-xs uppercase text-suave">
            <tr>
              <th className="px-3 py-2"><input type="checkbox" aria-label="Elegir todos" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(filas.map((f) => f.id)))} /></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Precio lista</th>
              <th className="px-3 py-2 text-right">Deco</th>
              <th className="px-3 py-2 text-right">Beauty</th>
              <th className="px-3 py-2 text-right">Online</th>
              <th className="px-3 py-2">En la tienda</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {filas.map((f) => (
              <tr key={f.id} className={sel.has(f.id) ? "bg-marca-claro/60" : ""}>
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Elegir ${f.nombre}`} checked={sel.has(f.id)} onChange={() => marcar(f.id)} /></td>
                <td className="px-3 py-2"><span className="block font-medium">{f.nombre}</span><span className="text-xs text-suave">{f.sku} · {f.categoria ?? "Sin categoría"}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{f.precio}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.deco}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.beauty}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{f.online}</td>
                <td className="px-3 py-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={f.publicar} disabled={cargando} onChange={() => aplicar(!f.publicar, [f.id])} />
                    <span className={`text-xs ${f.error ? "text-red-700" : "text-suave"}`}>{f.estado || "No publicado"}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
