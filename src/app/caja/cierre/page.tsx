import type { Metadata } from "next";
import { Suspense } from "react";
import { CierreCaja } from "./cierre";

export const metadata: Metadata = { title: "Cerrar caja · Magnolia" };

export default function PaginaCierre() {
  return <Suspense><CierreCaja /></Suspense>;
}
