import Link from "next/link";
import { salir } from "../acciones";
import { Menu } from "../componentes";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { clienteServidor } from "@/lib/supabase/almacen";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { u, rol, nombre } = await usuarioConRol();
  const db = clienteServidor();
  const [{ data: e }, pedidos] = await Promise.all([
    db.from("emisores").select("nombre").eq("usuario_id", u.id).maybeSingle(),
    rol === "duenio" ? db.from("ventas").select("id", { count: "exact", head: true }).not("anulacion_pedida_en", "is", null).eq("anulada", false) : null,
  ]);
  const aAutorizar = pedidos && !pedidos.error ? pedidos.count ?? 0 : 0;
  return (
    <>
      <Menu nombre={e?.nombre || nombre || u.email || ""} duenio={rol === "duenio"} salir={salir} />
      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 md:px-6 md:py-8">
        {aAutorizar > 0 && (
          <Link href="/ventas" className="mb-5 block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ⚠ {aAutorizar === 1 ? "Hay 1 anulación de venta" : `Hay ${aAutorizar} anulaciones de venta`} esperando tu autorización. <u>Revisar →</u>
          </Link>
        )}
        {children}
      </main>
    </>
  );
}
