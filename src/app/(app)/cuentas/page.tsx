import Link from "next/link";
import { guardarClienteCC } from "../../acciones";
import { Formulario } from "../../componentes";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { clientesCC } from "@/lib/supabase/cuentas";
import { soloDuenio } from "@/lib/supabase/sesion";

const diasDesde = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400_000) : null);

export default async function Cuentas() {
  await soloDuenio();
  let clientes: Awaited<ReturnType<typeof clientesCC>> = [];
  let error: string | null = null;
  try { clientes = await clientesCC(clienteServidor(), false); } catch (e) { error = (e as Error).message; }
  const activas = clientes.filter((c) => c.activo || Math.abs(c.saldo.debe) > 0.5).sort((a, b) => b.saldo.debe - a.saldo.debe);
  const total = activas.reduce((s, c) => s + Math.max(0, c.saldo.debe), 0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Cuentas corrientes</h1>
        <p className="text-sm text-suave">Solo las ven Martín y Sofi. Las ventas a cuenta se hacen desde la caja (medio de pago &quot;Cuenta corriente&quot;) y van a precio de lista.</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Les deben en total</p><p className="text-2xl font-semibold">{pesos(total)}</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Clientas con deuda</p><p className="text-2xl font-semibold">{activas.filter((c) => c.saldo.debe > 0.5).length}</p></div>
        <div className="tarjeta !p-4"><p className="text-sm text-suave">Pasadas del límite</p><p className="text-2xl font-semibold text-red-700">{activas.filter((c) => c.saldo.debe > c.limite).length}</p></div>
      </div>

      <section className="rounded-2xl border border-linea bg-white">
        {activas.length === 0 ? <p className="px-6 py-10 text-center text-suave">Todavía no hay cuentas corrientes.</p> : (
          <ul className="divide-y divide-linea">
            {activas.map((c) => {
              const dias = diasDesde(c.saldo.deudaDesde);
              const pasada = c.saldo.debe > c.limite;
              return (
                <li key={c.id}>
                  <Link href={`/cuentas/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-marca-claro/40 md:px-6">
                    <span className="min-w-0">
                      <b>{c.nombre}</b>{!c.activo && <span className="ml-2 text-xs text-suave">(dada de baja)</span>}
                      <span className="block text-sm text-suave">
                        {c.saldo.debe > 0.5 ? `Debe desde hace ${dias} día${dias === 1 ? "" : "s"}` : "Al día"}
                        {c.saldo.ultimoPago ? ` · último pago ${new Date(c.saldo.ultimoPago).toLocaleDateString("es-AR")}` : ""}
                        {pasada ? " · " : ""}{pasada && <b className="text-red-700">pasó el límite de {pesos(c.limite)}</b>}
                      </span>
                    </span>
                    <span className={`shrink-0 text-lg font-semibold tabular-nums ${c.saldo.debe > 0.5 ? (pasada ? "text-red-700" : "") : "text-green-700"}`}>{pesos(Math.max(0, c.saldo.debe))}{c.saldo.debe < -0.5 ? <span className="block text-xs font-normal">a favor {pesos(-c.saldo.debe)}</span> : null}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="tarjeta">
        <summary className="cursor-pointer font-semibold">+ Nueva cuenta corriente</summary>
        <Formulario accion={guardarClienteCC.bind(null, null)} boton="Crear cuenta" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label><span className="etiqueta">Nombre y apellido</span><input name="nombre" className="campo" required /></label>
          <label><span className="etiqueta">Teléfono (WhatsApp)</span><input name="telefono" className="campo" inputMode="tel" placeholder="2625 15 123456" /></label>
          <label><span className="etiqueta">DNI (opcional)</span><input name="dni" className="campo" inputMode="numeric" /></label>
          <label><span className="etiqueta">Límite de deuda</span><input name="limite" className="campo" inputMode="numeric" defaultValue="100000" />
            <span className="ayuda block">Pasado este monto la caja avisa; al doble no deja vender.</span></label>
          <label className="sm:col-span-2"><span className="etiqueta">Notas</span><input name="notas" className="campo" /></label>
        </Formulario>
      </details>
    </div>
  );
}
