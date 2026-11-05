import { salir } from "../acciones";
import { Menu } from "../componentes";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { clienteServidor } from "@/lib/supabase/almacen";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { u, rol, nombre } = await usuarioConRol();
  const { data: e } = await clienteServidor().from("emisores").select("nombre").eq("usuario_id", u.id).maybeSingle();
  return (
    <>
      <Menu nombre={e?.nombre || nombre || u.email || ""} duenio={rol === "duenio"} salir={salir} />
      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 md:px-6 md:py-8">{children}</main>
    </>
  );
}
