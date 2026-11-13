import Link from "next/link";
import { borrarCajasPrueba } from "../../../acciones";
import { BotonAccion } from "../../../componentes";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

export default async function CajaPrueba() {
  await soloDuenio();
  const db = clienteServidor();
  const [{ data: turnos, error }, { data: ventas }] = await Promise.all([
    db.from("turnos_caja").select("id, local_id, abierta_en, cerrada_en").eq("prueba", true).order("abierta_en", { ascending: false }),
    db.from("ventas").select("total, anulada").eq("prueba", true),
  ]);
  const abiertas = (turnos ?? []).filter((t) => !t.cerrada_en);
  const cerradas = (turnos ?? []).filter((t) => t.cerrada_en);
  const total = (ventas ?? []).filter((v) => !v.anulada).reduce((s, v) => s + Number(v.total), 0);
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Caja de prueba</h1>
        <p className="mt-1 text-suave">Es la misma caja, solo para vos y Sofi, para probar sin que cuente. Podés cobrar, hacer cambios, vender gift cards, cuentas corrientes y cerrar la caja.</p>
      </div>
      {error && /prueba/.test(error.message) && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0030_caja_prueba.sql</b> en Supabase.</p>}
      <section className="tarjeta space-y-3">
        <a href="/caja/prueba" className="boton inline-block">Abrir la caja de prueba</a>
        <ul className="list-disc space-y-1 pl-5 text-sm text-suave">
          <li>No descuenta stock y no aparece en Ventas, Reportes, Cierres ni en el cruce con Mercado Pago.</li>
          <li>Usa los productos y precios reales del local que elijas. No ve los pedidos de la tienda online.</li>
          <li>Las gift cards de prueba solo sirven en la caja de prueba, y las reales no se pueden usar acá.</li>
          <li>Ojo con las cuentas corrientes: una venta o un pago de prueba cambia el saldo de esa clienta hasta que borres los datos. Mejor creá una clienta &quot;Prueba&quot;.</li>
          <li>Los tickets salen igual que los reales: no se los des a nadie.</li>
          <li>En la compu de un local se puede usar sin problema: tiene su propio lugar y no se mezcla con la caja real.</li>
        </ul>
      </section>
      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Lo que hay de prueba</h2>
        <p className="text-sm">{abiertas.length} caja(s) abierta(s) · {cerradas.length} cerrada(s) · {(ventas ?? []).length} venta(s) por {pesos(total)} · <Link href="/ventas?prueba=1" className="text-marca underline">ver ventas de prueba</Link></p>
        {abiertas.length > 0 && <p className="text-sm text-amber-800">Para borrar todo, primero cerrá la caja de prueba (desde la misma caja, con &quot;Cerrar caja&quot;). Lo de una caja abierta no se borra.</p>}
        <BotonAccion accion={borrarCajasPrueba} texto="Borrar todo lo de prueba" borde />
      </section>
    </div>
  );
}
