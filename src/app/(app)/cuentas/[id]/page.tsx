import Link from "next/link";
import { notFound } from "next/navigation";
import { activarClienteCC, anularPagoClienteCC, guardarClienteCC, pagoClienteCC } from "../../../acciones";
import { BotonAccion, Formulario } from "../../../componentes";
import { nombreMedio } from "@/lib/caja";
import { pesos } from "@/lib/formato";
import { linkWhatsapp, numeroWhatsapp } from "@/lib/resumen-cierre";
import { clienteServidor } from "@/lib/supabase/almacen";
import { fichaCC, MEDIOS_PAGO_CC } from "@/lib/supabase/cuentas";
import { soloDuenio } from "@/lib/supabase/sesion";

const fecha = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

export default async function FichaCuenta({ params }: { params: Promise<{ id: string }> }) {
  await soloDuenio();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = clienteServidor();
  const f = await fichaCC(db, id);
  if (!f) notFound();
  const { cliente: c, movimientos, saldo } = f;
  const { data: cajas } = await db.from("turnos_caja").select("id, local_id, abierta_en").is("cerrada_en", null).order("abierta_en");
  const local = (n: number | null | undefined) => (n === 2 ? "Beauty" : n === 1 ? "Home" : "");
  const pasada = saldo > c.limite;

  // Resumen de cuenta para mandarle por WhatsApp (últimos movimientos)
  const lineas = movimientos.filter((m) => !m.anulado).slice(0, 12).reverse()
    .map((m) => `${new Date(m.fecha).toLocaleDateString("es-AR")} ${m.tipo === "pago" ? "Pago" : m.tipo === "cambio" ? "Cambio" : "Compra"}: ${m.monto < 0 ? "−" : ""}${pesos(Math.abs(m.monto)).replace(",00", "")}`);
  const texto = [`Hola ${c.nombre.split(" ")[0]}! Te paso el resumen de tu cuenta en Magnolia:`, ...lineas, "", `*Saldo: ${pesos(Math.max(0, saldo)).replace(",00", "")}*`, "Gracias!"].join("\n");
  const wa = c.telefono ? numeroWhatsapp(c.telefono) : null;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/cuentas" className="text-sm text-suave">← Cuentas corrientes</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{c.nombre}</h1>
            <p className="text-sm text-suave">{[c.telefono, c.dni && `DNI ${c.dni}`, c.notas].filter(Boolean).join(" · ") || "Sin datos de contacto"}{!c.activo && " · dada de baja"}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-suave">{saldo < -0.5 ? "A favor" : "Debe"}</p>
            <p className={`text-3xl font-semibold ${pasada ? "text-red-700" : saldo <= 0.5 ? "text-green-700" : ""}`}>{pesos(Math.abs(saldo))}</p>
            <p className="text-xs text-suave">Límite {pesos(c.limite)} · máximo {pesos(2 * c.limite)}</p>
          </div>
        </div>
      </div>

      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Registrar un pago</h2>
        <Formulario accion={pagoClienteCC.bind(null, c.id)} boton="Registrar pago" className="grid gap-3 sm:grid-cols-2">
          <label><span className="etiqueta">Monto</span><input name="monto" className="campo" inputMode="decimal" required defaultValue={saldo > 0 ? String(Math.round(saldo)) : ""} /></label>
          <label><span className="etiqueta">Cómo pagó</span>
            <select name="medio" className="campo" defaultValue="efectivo">{MEDIOS_PAGO_CC.map((m) => <option key={m} value={m}>{nombreMedio(m)}</option>)}</select></label>
          <label><span className="etiqueta">Si fue en efectivo, ¿entra a una caja?</span>
            <select name="turno_id" className="campo" defaultValue={cajas?.[0]?.id ?? ""}>
              <option value="">No (lo recibí yo)</option>
              {(cajas ?? []).map((t) => <option key={t.id} value={t.id}>Caja abierta de {local(t.local_id)}</option>)}
            </select></label>
          <label><span className="etiqueta">Nota (opcional)</span><input name="nota" className="campo" placeholder="Ej: pagó la mitad" /></label>
        </Formulario>
        <p className="ayuda">Si paga por transferencia, cuando llega a Mercado Pago el sistema la reconoce y la pasa a &quot;Por facturar&quot;.</p>
        <div className="flex flex-wrap gap-2">
          {wa && <a className="boton-borde !py-1.5 text-sm" target="_blank" rel="noreferrer" href={linkWhatsapp(texto, wa)}>Mandarle el resumen por WhatsApp</a>}
          {!wa && <a className="boton-borde !py-1.5 text-sm" target="_blank" rel="noreferrer" href={linkWhatsapp(texto)}>Resumen por WhatsApp</a>}
        </div>
      </section>

      <section className="rounded-2xl border border-linea bg-white">
        <h2 className="border-b border-linea px-4 py-3 font-semibold md:px-6">Movimientos</h2>
        {movimientos.length === 0 ? <p className="px-6 py-8 text-center text-suave">Sin movimientos todavía.</p> : (
          <ul className="divide-y divide-linea">
            {movimientos.map((m) => (
              <li key={m.id} className={`px-4 py-3 md:px-6 ${m.anulado ? "opacity-50" : ""}`}>
                <details>
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                    <span><b>{m.detalle}</b>{m.anulado && <span className="ml-2 text-xs font-semibold text-red-700">ANULADO</span>}
                      <span className="block text-sm text-suave">{fecha(m.fecha)}{m.local_id ? ` · ${local(m.local_id)}` : ""}{m.medio ? ` · ${nombreMedio(m.medio)}` : ""}</span></span>
                    <span className="text-right tabular-nums">
                      <b className={m.monto < 0 ? "text-green-700" : ""}>{m.monto < 0 ? "−" : "+"}{pesos(Math.abs(m.monto))}</b>
                      <span className="block text-xs text-suave">saldo {pesos(m.saldo)}</span>
                    </span>
                  </summary>
                  {m.items && <ul className="mt-2 space-y-0.5 text-sm">{m.items.map((i) => <li key={i.n} className="flex justify-between gap-2"><span>{Number(i.cantidad)} × {i.nombre}</span><span>{pesos(Number(i.total))}</span></li>)}</ul>}
                  {m.tipo === "pago" && !m.anulado && <div className="mt-2"><BotonAccion accion={anularPagoClienteCC.bind(null, c.id, m.id)} texto="Anular este pago" borde /></div>}
                  {m.tipo !== "pago" && <p className="mt-2 text-xs text-suave">Para anularla o cambiar algo, buscala en Ventas.</p>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="tarjeta">
        <summary className="cursor-pointer font-semibold">Editar datos</summary>
        <Formulario accion={guardarClienteCC.bind(null, c.id)} boton="Guardar" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label><span className="etiqueta">Nombre y apellido</span><input name="nombre" className="campo" required defaultValue={c.nombre} /></label>
          <label><span className="etiqueta">Teléfono (WhatsApp)</span><input name="telefono" className="campo" defaultValue={c.telefono ?? ""} /></label>
          <label><span className="etiqueta">DNI</span><input name="dni" className="campo" defaultValue={c.dni ?? ""} /></label>
          <label><span className="etiqueta">Límite de deuda</span><input name="limite" className="campo" inputMode="numeric" defaultValue={String(c.limite)} /></label>
          <label className="sm:col-span-2"><span className="etiqueta">Notas</span><input name="notas" className="campo" defaultValue={c.notas ?? ""} /></label>
        </Formulario>
        <div className="mt-3"><BotonAccion accion={activarClienteCC.bind(null, c.id, !c.activo)} texto={c.activo ? "Dar de baja la cuenta" : "Volver a activar"} borde /></div>
      </details>
    </div>
  );
}
