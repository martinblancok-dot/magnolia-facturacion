import Link from "next/link";
import { notFound } from "next/navigation";
import { Desbloquear } from "../desbloquear";
import { EliminarProducto, FormProducto } from "./formulario";
import { adminDesbloqueado } from "@/lib/admin";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  await usuarioActual();
  const { id } = await params;
  if (!(await adminDesbloqueado())) {
    return (
      <div className="max-w-xl space-y-4">
        <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
        <div className="tarjeta"><p className="mb-3 text-sm">Esta pantalla necesita la clave de administrador.</p><Desbloquear texto="Desbloquear" /></div>
      </div>
    );
  }
  const nuevo = id === "nuevo";
  let p = null;
  if (!nuevo) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await clienteServidor().from("productos").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    p = data;
  }
  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <h1 className="text-2xl font-semibold">{nuevo ? "Nuevo producto" : "Editar producto"}</h1>
      <FormProducto p={p} />
      {p && (
        <div className="tarjeta border-red-200">
          <h2 className="font-semibold text-red-800">Eliminar producto</h2>
          <p className="ayuda">Deja de aparecer en la caja y en las listas. Las ventas que ya tuvo se conservan.</p>
          <EliminarProducto id={p.id} />
        </div>
      )}
    </div>
  );
}
