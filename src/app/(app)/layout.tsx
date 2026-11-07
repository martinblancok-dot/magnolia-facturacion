import { salir } from "../acciones";
import { AvisosDuenio } from "../avisos-duenio";
import { Menu } from "../componentes";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerEstado } from "@/lib/supabase/planilla";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { u, rol, nombre } = await usuarioConRol();
  const db = clienteServidor();
  const duenio = rol === "duenio";
  const [{ data: e }, pedidos, descuentos, planilla] = await Promise.all([
    db.from("emisores").select("nombre").eq("usuario_id", u.id).maybeSingle(),
    duenio ? db.from("ventas").select("id", { count: "exact", head: true }).not("anulacion_pedida_en", "is", null).eq("anulada", false) : null,
    duenio ? db.from("autorizaciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente") : null,
    duenio ? leerEstado(db).catch(() => null) : null,
  ]);
  const inicial = { anulaciones: pedidos && !pedidos.error ? pedidos.count ?? 0 : 0, descuentos: descuentos && !descuentos.error ? descuentos.count ?? 0 : 0, codigos: planilla?.codigos?.repetidos.length ?? 0 };
  return (
    <>
      <Menu nombre={e?.nombre || nombre || u.email || ""} duenio={duenio} salir={salir} />
      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 md:px-6 md:py-8">
        {duenio && <AvisosDuenio inicial={inicial} />}
        {children}
      </main>
    </>
  );
}
