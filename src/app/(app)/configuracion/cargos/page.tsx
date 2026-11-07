import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerCargos } from "@/lib/supabase/cargos";
import { soloDuenio } from "@/lib/supabase/sesion";
import { FormCargos } from "./form";

export default async function Cargos() {
  await soloDuenio();
  const cargos = await leerCargos(clienteServidor());
  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link href="/reportes" className="text-sm text-suave">← Reportes</Link>
        <h1 className="text-2xl font-semibold">Costos por medio de pago</h1>
        <p className="text-sm text-suave">Cuánto se pierde de cada $100 cobrados con cada medio (comisión de Mercado Pago, financiación de cuotas, IVA, retenciones…). Se descuenta de la ganancia en Reportes; no cambia precios ni la caja.</p>
      </div>
      <FormCargos inicial={cargos} />
    </div>
  );
}
