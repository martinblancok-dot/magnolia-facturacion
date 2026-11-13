import Link from "next/link";
import { notFound } from "next/navigation";
import { Codigos } from "./codigos";
import { FotoProducto } from "./foto";
import { Miniatura } from "../../../miniatura";
import { rutaCorta } from "@/lib/fotos";
import { EliminarProducto, FormProducto } from "./formulario";
import { adminDesbloqueado } from "@/lib/admin";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";
import { leerEstado } from "@/lib/supabase/planilla";

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  await usuarioActual();
  const { id } = await params;
  if (!(await adminDesbloqueado())) {
    // Los colaboradores ven la ficha con la foto, pero no pueden cambiar nada
    const { data: v } = /^[0-9a-f-]{36}$/i.test(id)
      ? await clienteServidor().from("productos").select("nombre, sku, barcode, imagen_url").eq("id", id).maybeSingle()
      : { data: null };
    return (
      <div className="max-w-xl space-y-4">
        <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
        {v && (
          <div className="tarjeta flex items-center gap-4">
            <Miniatura ruta={rutaCorta(v.imagen_url)} tam={120} alt={v.nombre} />
            <div><p className="font-semibold">{v.nombre}</p><p className="text-sm text-suave">{v.sku} · {v.barcode}</p></div>
          </div>
        )}
        <div className="tarjeta"><p className="text-sm">Editar productos lo pueden hacer solo Martín y Sofi, desde su usuario.</p></div>
      </div>
    );
  }
  const nuevo = id === "nuevo";
  let p = null;
  let codigos: { codigo: string; origen: string }[] = [];
  let colores: { id: string; color: string; sku_variante: string; activo: boolean; stock_variantes: { local_id: number; cantidad: number }[] }[] = [];
  if (!nuevo) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await clienteServidor().from("productos").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    p = data;
    const r = await clienteServidor().from("producto_codigos").select("codigo, origen").eq("producto_id", id).order("creado_en");
    codigos = r.error ? [] : r.data ?? [];
    const cv = await clienteServidor().from("producto_variantes").select("id, color, sku_variante, activo, orden, stock_variantes(local_id, cantidad)").eq("producto_id", id).order("orden").order("color");
    colores = cv.error ? [] : ((cv.data ?? []) as unknown as typeof colores);
  }
  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <h1 className="text-2xl font-semibold">{nuevo ? "Nuevo producto" : "Editar producto"}</h1>
      {p && <FotoProducto productoId={p.id} ruta={rutaCorta(p.imagen_url)} nombre={p.nombre} />}
      <FormProducto p={p} hojas={nuevo ? (await leerEstado(clienteServidor()))?.hojas ?? [] : []} />
      {p && <Codigos productoId={p.id} interno={p.barcode} codigos={codigos} />}
      {p && colores.length > 0 && (
        <div className="tarjeta">
          <h2 className="font-semibold">Colores y stock por color</h2>
          <p className="ayuda">Se cargan en la columna &quot;Colores&quot; de Precios Deco. El código de cada color es interno (la etiqueta sigue siendo la del producto).</p>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-suave"><th className="py-1">Color</th><th>Código</th><th className="text-right">Home</th><th className="text-right">Beauty</th></tr></thead>
            <tbody className="divide-y divide-linea">
              {colores.map((c) => {
                const en = (l: number) => Number(c.stock_variantes.find((s) => s.local_id === l)?.cantidad ?? 0);
                return (
                  <tr key={c.id} className={c.activo ? "" : "text-suave line-through"}>
                    <td className="py-1.5">{c.color}{!c.activo && <span className="ml-1 text-xs no-underline">(ya no está en la planilla)</span>}</td>
                    <td className="font-mono text-xs">{c.sku_variante}</td>
                    <td className="text-right tabular-nums">{en(1)}</td>
                    <td className="text-right tabular-nums">{en(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {p && (
        <div className="tarjeta border-red-200">
          <h2 className="font-semibold text-red-800">Eliminar producto</h2>
          <p className="ayuda">Deja de aparecer en la caja y en las listas. Las ventas que ya tuvo se conservan.{p.hoja ? " En la planilla queda como está (borralo ahí si no lo vas a usar más)." : ""}</p>
          <EliminarProducto id={p.id} />
        </div>
      )}
    </div>
  );
}
