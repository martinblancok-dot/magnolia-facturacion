import { Stock } from "./stock";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function PaginaStock() {
  await usuarioActual();
  return <Stock />;
}
