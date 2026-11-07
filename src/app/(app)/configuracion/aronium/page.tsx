import Link from "next/link";
import { soloDuenio } from "@/lib/supabase/sesion";
import { Importar } from "./importar";

export default async function ImportarAronium() {
  await soloDuenio();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/configuracion" className="text-sm text-suave">← Configuración</Link>
        <h1 className="text-2xl font-semibold">Ventas anteriores (Aronium)</h1>
        <p className="text-sm text-suave">Carga el historial de ventas de Aronium para verlo en Ventas y Reportes. No toca el stock, los cierres, la facturación ni los cambios. Se puede repetir sin duplicar nada.</p>
      </div>
      <Importar />
    </div>
  );
}
