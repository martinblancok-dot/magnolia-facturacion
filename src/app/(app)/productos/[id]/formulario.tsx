"use client";
import { useRef, useState } from "react";
import { eliminarProducto, guardarProducto } from "../../../acciones";
import { Formulario } from "../../../componentes";

type P = { id: string; nombre: string; sku: string; barcode: string; categoria: string | null; proveedor: string | null; precio_lista: number; precio_efectivo: number; costo: number | null } | null;

export function EliminarProducto({ id }: { id: string }) {
  const [seguro, setSeguro] = useState(false);
  return seguro ? (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold text-red-800">¿Seguro?</span>
      <button className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => eliminarProducto(id)}>Sí, eliminar</button>
      <button className="text-sm text-suave underline" onClick={() => setSeguro(false)}>Cancelar</button>
    </div>
  ) : (
    <button className="mt-3 rounded-lg border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50" onClick={() => setSeguro(true)}>Eliminar</button>
  );
}

export function FormProducto({ p }: { p: P }) {
  const efectivo = useRef<HTMLInputElement>(null);
  const tocado = useRef(false);
  const campo = (name: string, label: string, valor: unknown, extra: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="etiqueta">{label}</span>
      <input name={name} defaultValue={valor === null || valor === undefined ? "" : String(valor)} className="campo" {...extra} />
    </label>
  );
  return (
    <Formulario accion={guardarProducto} boton="Guardar" className="tarjeta space-y-4">
      <input type="hidden" name="id" value={p?.id ?? ""} />
      {campo("nombre", "Nombre", p?.nombre, { required: true })}
      <div className="grid gap-4 sm:grid-cols-2">
        {campo("sku", "SKU (Articulo Interno)", p?.sku, { required: true })}
        {campo("barcode", "Código de barras", p?.barcode, { required: true })}
        {campo("proveedor", "Proveedor", p?.proveedor)}
        {campo("categoria", "Categoría", p?.categoria)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="etiqueta">Precio lista</span>
          <input name="precio_lista" defaultValue={p?.precio_lista ?? ""} className="campo" inputMode="decimal" required
            onChange={(e) => {
              // se recalcula el efectivo (15%, redondeado a $50), salvo que lo hayas escrito a mano
              const n = Number(e.target.value.replace(/\./g, "").replace(",", "."));
              if (!tocado.current && efectivo.current && n > 0) efectivo.current.value = String(Math.round((n * 0.85) / 50) * 50);
            }} />
        </label>
        <label className="block">
          <span className="etiqueta">Precio efectivo (15%)</span>
          <input ref={efectivo} name="precio_efectivo" defaultValue={p?.precio_efectivo ?? ""} className="campo" inputMode="decimal"
            placeholder="se calcula solo" onChange={() => { tocado.current = true; }} />
        </label>
        {campo("costo", "Costo", p?.costo, { inputMode: "decimal" })}
      </div>
      <p className="ayuda">El 10% de transferencia y tarjeta se calcula solo sobre el precio de lista. El costo solo se ve con la clave.</p>
    </Formulario>
  );
}
