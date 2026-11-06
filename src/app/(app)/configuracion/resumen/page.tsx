import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerConfigAviso } from "@/lib/supabase/aviso-cierre";
import { soloDuenio } from "@/lib/supabase/sesion";
import { FormAviso } from "./form";

export default async function ConfigResumen() {
  await soloDuenio();
  const cfg = await leerConfigAviso(clienteServidor());
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href="/configuracion" className="text-sm text-suave">← Configuración</Link>
        <h1 className="text-2xl font-semibold">Resumen del cierre</h1>
        <p className="text-sm text-suave">Al cerrar la caja aparece un botón para mandar el resumen (ventas por medio, arqueo, diferencias y lo más vendido) por WhatsApp a estos números. Opcional: que llegue solo por mail.</p>
      </div>
      <FormAviso inicial={cfg} />
    </div>
  );
}
