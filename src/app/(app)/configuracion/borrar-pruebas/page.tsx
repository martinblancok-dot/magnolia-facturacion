import Link from "next/link";
import { borrarPruebas } from "../../../acciones";
import { Formulario } from "../../../componentes";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

const hoyArgentina = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export default async function BorrarPruebas() {
  await soloDuenio();
  const db = clienteServidor();
  const [{ count: ventas }, { count: cajas }, { count: tarjetas }, { count: stock }] = await Promise.all([
    db.from("ventas").select("id", { count: "exact", head: true }),
    db.from("turnos_caja").select("id", { count: "exact", head: true }),
    db.from("giftcards").select("id", { count: "exact", head: true }),
    db.from("stock").select("producto_id", { count: "exact", head: true }).neq("cantidad", 0),
  ]);
  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/configuracion" className="text-sm text-suave underline">← Configuración</Link>
      <div>
        <h1 className="text-2xl font-semibold">Borrar datos de prueba</h1>
        <p className="text-sm text-suave">Para empezar limpios antes de usar el sistema de verdad. Hoy hay {ventas ?? 0} ventas, {cajas ?? 0} cajas, {tarjetas ?? 0} gift cards y {stock ?? 0} productos con stock distinto de 0.</p>
      </div>
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
        <b>No se toca:</b> productos y precios, cobros de Mercado Pago, facturas de ARCA, monotributo, usuarios ni configuración.
      </div>
      <Formulario accion={borrarPruebas} boton="Borrar definitivamente" className="tarjeta space-y-4">
        <label className="block"><span className="etiqueta">Borrar todo lo de la caja hasta el día (inclusive)</span>
          <input type="date" name="dia" defaultValue={hoyArgentina()} className="campo" required /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="ventas" defaultChecked className="mt-1" />
          <span><b>Ventas, cajas y gift cards</b>: ventas (con sus anulaciones), aperturas y cierres de caja, retiros y gastos, gift cards vendidas.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="stock" className="mt-1" />
          <span><b>Stock</b>: pone todo el stock de los dos locales en 0 y borra sus movimientos. Marcalo si las ventas de prueba dejaron el stock en negativo, <b>pero no si ya hicieron el conteo inicial</b>.</span></label>
        <label className="block"><span className="etiqueta">Para confirmar, escribí BORRAR</span>
          <input name="confirmar" className="campo uppercase" autoComplete="off" required /></label>
        <p className="text-sm text-red-800">No se puede deshacer. Antes de borrar, cerrá las cajas abiertas; las compus que tengan una caja abierta de prueba van a pedir abrir una nueva.</p>
      </Formulario>
    </div>
  );
}
