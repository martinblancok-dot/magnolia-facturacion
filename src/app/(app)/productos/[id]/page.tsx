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
  if (!nuevo) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await clienteServidor().from("productos").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    p = data;
    const r = await clienteServidor().from("producto_codigos").select("codigo, origen").eq("producto_id", id).order("creado_en");
    codigos = r.error ? [] : r.data ?? [];
  }
  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <h1 className="text-2xl font-semibold">{nuevo ? "Nuevo producto" : "Editar producto"}</h1>
      {p && <FotoProducto productoId={p.id} ruta={rutaCorta(p.imagen_url)} nombre={p.nombre} />}
      <FormProducto p={p} hojas={nuevo ? (await leerEstado(clienteServidor()))?.hojas ?? [] : []} />
      {p && <Codigos productoId={p.id} interno={p.barcode} codigos={codigos} />}
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
