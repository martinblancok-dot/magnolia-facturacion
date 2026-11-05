import type { Metadata } from "next";
import { Caja } from "./caja";

export const metadata: Metadata = { title: "Caja · Magnolia" };

export default function PaginaCaja() {
  return <Caja />;
}
