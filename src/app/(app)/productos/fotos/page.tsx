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
        <p><b>Cómo se asocian:</b> elegí la carpeta de fotos finales (en tu compu: <code>G:\Mi unidad\Magnolia\Fotos Magnolia Deco\FINALES</code>) y el sistema hace todo solo.</p>
        <ul className="list-disc space-y-1 pl-5 text-suave">
          <li>Usa solo la foto del producto solo: la que termina en <code>-1.jpg</code> (ej. <code>EC8651-botella-verde-rayada-1.jpg</code>). Las <code>-2-ambiente</code> se saltean.</li>
          <li>El producto es el SKU con que empieza el nombre; si hay dos posibles, gana el más largo (<code>EC9864-2-vaso…</code> va a EC9864-2). Si el SKU tiene barra, en el nombre va con guion.</li>
          <li>Si un producto tiene varias fotos <code>-1</code>, la primera en orden alfabético es la principal, y cada una se guarda en su color si alguna palabra del nombre coincide con el color (sin importar mayúsculas ni tildes): <code>ZA5977-botella-corcho-rosa-1.jpg</code> → Rosa tornasolado, <code>BR9116-compotera-labrada-rayada-1.jpg</code> → Transparente rayada. Si coincide con dos colores, gana el de más palabras.</li>
          <li>Se achican solas a 300×300 (recorte al centro). Si ya había foto, se reemplaza.</li>
        </ul>
      </div>
      <SubirFotos />
    </div>
  );
}
