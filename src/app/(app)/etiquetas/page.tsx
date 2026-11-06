import { usuarioActual } from "@/lib/supabase/sesion";
import { Etiquetas } from "./etiquetas";

export default async function PaginaEtiquetas() {
  await usuarioActual();
  return <Etiquetas />;
}
