"use client";
import { useRef, useState } from "react";
import { eliminarProducto, guardarProducto } from "../../../acciones";
import { Formulario } from "../../../componentes";

type P = { id: string; nombre: string; sku: string; barcode: string; categoria: string | null; proveedor: string | null; precio_lista: number; precio_efectivo: number; costo: number | null; hoja?: string | null } | null;
const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

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

export function FormProducto({ p, hojas = [] }: { p: P; hojas?: string[] }) {
  const efectivo = useRef<HTMLInputElement>(null);
  const tocado = useRef(false);
  const [hoja, setHoja] = useState(hojas.length && !p ? hojas[0] : "");
  const campo = (name: string, label: string, valor: unknown, extra: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="etiqueta">{label}</span>
      <input name={name} defaultValue={valor === null || valor === undefined ? "" : String(valor)} className="campo" {...extra} />
    </label>
  );
  // ---- Producto de la planilla: los precios salen de las fórmulas de Precios Deco
  if (p?.hoja) {
    return (
      <Formulario accion={guardarProducto} boton="Guardar" className="tarjeta space-y-4">
        <input type="hidden" name="id" value={p.id} />
        <p className="rounded-lg bg-marca-claro px-3 py-2 text-sm">Viene de la pestaña <b>{p.hoja}</b> de Precios Deco. Lo que cambies acá se escribe en la planilla solo.</p>
        {campo("nombre", "Nombre", p.nombre, { required: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("costo", "Costo (precio unitario)", p.costo, { inputMode: "decimal" })}
          {campo("categoria", "Categoría", p.categoria)}
        </div>
        <dl className="grid gap-x-6 gap-y-1 rounded-lg border border-linea px-3 py-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between"><dt className="text-suave">SKU</dt><dd>{p.sku}</dd></div>
          <div className="flex justify-between"><dt className="text-suave">Código de barras</dt><dd>{p.barcode}</dd></div>
          <div className="flex justify-between"><dt className="text-suave">Precio lista</dt><dd><b>{pesos(Number(p.precio_lista))}</b></dd></div>
          <div className="flex justify-between"><dt className="text-suave">Precio efectivo</dt><dd><b>{pesos(Number(p.precio_efectivo))}</b></dd></div>
        </dl>
        <p className="ayuda">Los precios se cambian en la planilla. Si cambiás el costo, la planilla recalcula los precios con su fórmula y vuelven solos al sistema (hasta 10 minutos).</p>
      </Formulario>
    );
  }

  // ---- Producto nuevo que va a una pestaña de la planilla
  if (!p && hoja) {
    return (
      <Formulario accion={guardarProducto} boton="Agregar a la planilla" className="tarjeta space-y-4">
        <input type="hidden" name="id" value="" />
        <label className="block"><span className="etiqueta">Pestaña de Precios Deco (proveedor)</span>
          <select name="hoja" value={hoja} onChange={(e) => setHoja(e.target.value)} className="campo">
            {hojas.map((h) => <option key={h} value={h}>{h}</option>)}
            <option value="">— No va a la planilla (solo en el sistema) —</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("articulo_prov", "Artículo del proveedor", "", { required: true, placeholder: "Ej: 1030" })}
          {campo("costo", "Costo (precio unitario)", "", { required: true, inputMode: "decimal" })}
        </div>
        {campo("nombre", "Nombre", "", { required: true, placeholder: "Ej: Frasco cilindro bambu grande" })}
        {campo("categoria", "Categoría (opcional)", "", { placeholder: "Si la dejás vacía, la planilla la calcula" })}
        <p className="ayuda">Se agrega como fila nueva en esa pestaña, con las fórmulas de las filas de arriba: la planilla arma el SKU, el código de barras y los precios, y el producto aparece en la caja en la próxima sincronización. Al nombre se le agrega el SKU si no lo tiene.</p>
      </Formulario>
    );
  }

  return (
    <Formulario accion={guardarProducto} boton="Guardar" className="tarjeta space-y-4">
      <input type="hidden" name="id" value={p?.id ?? ""} />
      {!p && hojas.length > 0 && (
        <label className="block"><span className="etiqueta">Pestaña de Precios Deco (proveedor)</span>
          <select name="hoja" value={hoja} onChange={(e) => setHoja(e.target.value)} className="campo">
            {hojas.map((h) => <option key={h} value={h}>{h}</option>)}
            <option value="">— No va a la planilla (solo en el sistema) —</option>
          </select>
        </label>
      )}
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
