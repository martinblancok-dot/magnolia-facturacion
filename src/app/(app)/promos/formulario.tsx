"use client";
import { useState } from "react";
import { crearPromo } from "../../acciones";
import { Formulario } from "../../componentes";

export function NuevaPromo({ categorias, proveedores }: { categorias: string[]; proveedores: string[] }) {
  const [tipo, setTipo] = useState("segunda");
  const [alcance, setAlcance] = useState("todo");
  return (
    <Formulario accion={crearPromo} boton="Crear promo" className="tarjeta space-y-4">
      <h2 className="font-semibold">Nueva promo</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="etiqueta">Nombre (lo ve el cliente en el recibo)</span><input name="nombre" className="campo" required placeholder="2da unidad al 50%" /></label>
        <label><span className="etiqueta">Tipo</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo">
            <option value="segunda">% de descuento en la 2da unidad</option>
            <option value="nxm">Llevá N, pagá M (2x1, 3x2…)</option>
            <option value="porcentaje">% de descuento directo</option>
          </select>
        </label>
        {tipo === "nxm" ? (
          <div className="flex gap-3">
            <label className="flex-1"><span className="etiqueta">Lleva</span><input name="n" type="number" min={2} defaultValue={3} className="campo" /></label>
            <label className="flex-1"><span className="etiqueta">Paga</span><input name="m" type="number" min={1} defaultValue={2} className="campo" /></label>
          </div>
        ) : (
          <label><span className="etiqueta">Porcentaje de descuento</span><input name="pct" inputMode="decimal" className="campo" defaultValue={tipo === "segunda" ? 50 : 10} /></label>
        )}
        <label><span className="etiqueta">Se aplica a</span>
          <select name="alcance" value={alcance} onChange={(e) => setAlcance(e.target.value)} className="campo">
            <option value="todo">Todos los productos</option>
            <option value="categoria">Categorías</option>
            <option value="proveedor">Proveedores</option>
            <option value="sku">Productos puntuales (SKU)</option>
          </select>
        </label>
        {alcance !== "todo" && (
          <label className="sm:col-span-2"><span className="etiqueta">{alcance === "categoria" ? "Categorías" : alcance === "proveedor" ? "Proveedores (pestañas de Precios Deco)" : "SKU"} — separados por coma</span>
            <input name="valores" className="campo" list={`lista-${alcance}`} placeholder={alcance === "categoria" ? "Frascos, Velas" : alcance === "proveedor" ? "Camwa, Plasticuer" : "HA80, CAM1030"} />
            <datalist id="lista-categoria">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
            <datalist id="lista-proveedor">{proveedores.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        {tipo !== "porcentaje" && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="mismo_producto" defaultChecked />
            Solo con unidades del mismo producto (si lo desmarcás, se pueden combinar productos distintos de la promo; siempre se descuenta el más barato)</label>
        )}
        <label><span className="etiqueta">Desde (opcional)</span><input type="date" name="desde" className="campo" /></label>
        <label><span className="etiqueta">Hasta (opcional)</span><input type="date" name="hasta" className="campo" /></label>
      </div>
      <p className="ayuda">La promo se calcula sobre el precio del medio de pago: en efectivo se suma al 15%, con débito o transferencia al 10%. Cada producto entra en una sola promo.</p>
    </Formulario>
  );
}
