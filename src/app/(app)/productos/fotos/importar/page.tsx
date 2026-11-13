import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportarFotos } from "./importar";
import { adminDesbloqueado } from "@/lib/admin";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function ImportarFotosPage() {
  await usuarioActual();
  if (!(await adminDesbloqueado())) redirect("/productos");
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/productos" className="text-sm text-suave underline">← Productos</Link>
      <div>
        <h1 className="text-2xl font-semibold">Importar fotos</h1>
        <p className="mt-1 text-suave">Sube las miniaturas ya hechas (.webp) según el archivo <b>_variantes-colores.csv</b>: las que no tienen sufijo van al producto; las que tienen sufijo, a su color (y la marcada como principal del grupo, también al producto).</p>
      </div>
      <ImportarFotos />
    </div>
  );
}
