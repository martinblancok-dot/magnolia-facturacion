import { Stock } from "./stock";
import { perfilDe, usuarioActual } from "@/lib/supabase/sesion";

export default async function PaginaStock() {
  const u = await usuarioActual();
  const { rol } = await perfilDe(u.id);
  return <Stock duenio={rol === "duenio"} />;
}
