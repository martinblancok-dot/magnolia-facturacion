import Link from "next/link";
import { redirect } from "next/navigation";
import { SubirFotos } from "./subir";
import { adminDesbloqueado } from "@/lib/admin";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function FotosProductos() {
  await usuarioActual();
  if (!(await adminDesbloqueado())) redirect("/productos");
  const db = clienteServidor();
  const [{ count: total }, { count: conFoto, error }] = await Promise.all([
    db.from("productos").select("id", { count: "exact", head: true }).eq("activo", true),
    db.from("productos").select("id", { count: "exact", head: true }).eq("activo", true).not("imagen_url", "is", null),
  ]);
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <div>
        <h1 className="text-2xl font-semibold">Fotos de productos</h1>
        <p className="mt-1 text-suave">{error ? "—" : `${conFoto ?? 0} de ${total ?? 0} productos tienen foto.`}</p>
      </div>
      {error && /imagen_url/.test(error.message) && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0031_fotos_productos.sql</b> en Supabase.</p>}
      <div className="tarjeta space-y-2 text-sm">
        <p><b>Cómo nombrar las fotos:</b> con el SKU del producto. Ej.: <code>Cam1030.jpg</code>, <code>D00123.png</code>.</p>
        <ul className="list-disc space-y-1 pl-5 text-suave">
          <li>Si el SKU tiene barra, poné guion: <code>1954/3</code> → <code>1954-3.jpg</code>.</li>
          <li>Si no coincide con ningún SKU, se prueba con el código de barras.</li>
          <li>Sirven .jpg, .png y .webp, de cualquier tamaño: se achican solas a 300×300.</li>
          <li>Si el producto ya tenía foto, se reemplaza.</li>
        </ul>
      </div>
      <SubirFotos />
    </div>
  );
}
