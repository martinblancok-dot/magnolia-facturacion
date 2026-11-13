// Caja de prueba: la misma caja, solo para los dueños. Lo que se hace acá queda marcado como prueba.
import type { Metadata } from "next";
import { soloDuenio } from "@/lib/supabase/sesion";
import { Caja } from "../caja";

export const metadata: Metadata = { title: "Caja de prueba · Magnolia" };

export default async function PaginaCajaPrueba() {
  await soloDuenio();
  return <Caja />;
}
