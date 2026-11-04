import { salir } from "../acciones";
import { Menu } from "../componentes";
import { usuarioActual } from "@/lib/supabase/sesion";
import { clienteServidor } from "@/lib/supabase/almacen";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const u = await usuarioActual();
  const { data: e } = await clienteServidor().from("emisores").select("nombre").eq("usuario_id", u.id).maybeSingle();
  return (
    <>
      <Menu nombre={e?.nombre ?? u.email ?? ""} salir={salir} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </>
  );
}
