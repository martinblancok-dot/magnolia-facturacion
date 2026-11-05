import Link from "next/link";
import { anularVenta, pedirAnulacion, rechazarAnulacion } from "../../acciones";
import { BotonAccion, Formulario } from "../../componentes";
import { MEDIOS } from "@/lib/caja";
import { diaArgentina, restarDias } from "@/lib/fechas";
import { fechaCorta, hora, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { codigoVenta, rangoCodigo, venceCambio } from "@/lib/impresion";
import { Reimprimir } from "./reimprimir";

type Venta = {
  id: string; numero: number; local_id: number; creada_en: string; medio_pago: string; total: number; total_lista: number;
  anulada: boolean; paga_con: number | null;
  anulacion_pedida_por?: string | null; anulacion_pedida_en?: string | null; anulacion_motivo?: string | null; anulacion_rechazada_en?: string | null;
  venta_items: { n: number; nombre: string; sku: string | null; cantidad: number; precio_unitario: number; total: number }[];
};

export default async function Ventas({ searchParams }: { searchParams: Promise<{ dia?: string; local?: string; codigo?: string }> }) {
  const { rol } = await usuarioConRol();
  const duenio = rol === "duenio";
  const db = clienteServidor();
  const sp = await searchParams;
  const hoy = diaArgentina();
  const dia = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoy;
  const local = sp.local === "1" || sp.local === "2" ? Number(sp.local) : null;
  const siguiente = restarDias(dia, -1);

  const buscado = sp.codigo?.trim() ?? "";
  const rango = buscado ? rangoCodigo(buscado) : null;
  const BASE = "id, numero, local_id, creada_en, medio_pago, total, total_lista, anulada, paga_con, venta_items(n, nombre, sku, cantidad, precio_unitario, total)";
  const PEDIDOS = ", anulacion_pedida_por, anulacion_pedida_en, anulacion_motivo, anulacion_rechazada_en";
  const consulta = (cols: string) => {
    let q = db.from("ventas").select(cols).order("creada_en", { ascending: false }).limit(1000);
    if (rango) q = q.gte("id", rango[0]).lte("id", rango[1]);
    else q = q.gte("creada_en", `${dia}T00:00:00-03:00`).lt("creada_en", `${siguiente}T00:00:00-03:00`);
    if (local && !rango) q = q.eq("local_id", local);
    return q;
  };
  const [primera, { data: locales }, { data: perfiles }, pendientesQ] = await Promise.all([
    consulta(BASE + PEDIDOS),
    db.from("locales").select("id, nombre").order("id"),
    db.from("perfiles").select("usuario_id, nombre"),
    duenio ? db.from("ventas").select(BASE + PEDIDOS).not("anulacion_pedida_en", "is", null).eq("anulada", false).order("anulacion_pedida_en") : Promise.resolve({ data: [] }),
  ]);
  // si todavía no se corrió la migración 0010, se ve igual que antes
  const { data } = primera.error ? await consulta(BASE) : primera;
  const ventas = (data ?? []) as unknown as Venta[];
  const pendientes = ((pendientesQ.data ?? []) as unknown as Venta[]);
  const quien = (id?: string | null) => perfiles?.find((p) => p.usuario_id === id)?.nombre || "un colaborador";
  const validas = ventas.filter((v) => !v.anulada);
  const total = validas.reduce((s, v) => s + Number(v.total), 0);
  const porMedio = MEDIOS.map((m) => ({ ...m, total: validas.filter((v) => v.medio_pago === m.id).reduce((s, v) => s + Number(v.total), 0), n: validas.filter((v) => v.medio_pago === m.id).length }));
  const nombreLocal = (id: number) => locales?.find((l) => l.id === id)?.nombre ?? `Local ${id}`;
  const url = (d: string, l: number | null) => `/ventas?dia=${d}${l ? `&local=${l}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ventas</h1>
          <Link href="/cierres" className="text-sm text-marca underline">Cierres de caja y arqueos →</Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={url(restarDias(dia, 1), local)} className="boton-borde !px-4 !py-2">←</Link>
          <span className="w-28 text-center font-semibold">{dia === hoy ? "Hoy" : fechaCorta(dia)}</span>
          {dia < hoy ? <Link href={url(siguiente, local)} className="boton-borde !px-4 !py-2">→</Link> : <span className="w-11" />}
        </div>
      </div>

      {pendientes.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Anulaciones para autorizar ({pendientes.length})</h2>
          <ul className="mt-2 divide-y divide-amber-200">
            {pendientes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-sm">
                  <b>#{v.numero}</b> · {new Date(v.creada_en).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {nombreLocal(v.local_id)} · <b>{pesos(Number(v.total))}</b> en {MEDIOS.find((m) => m.id === v.medio_pago)?.nombre}
                  <span className="block text-amber-900">Pide {quien(v.anulacion_pedida_por)}: “{v.anulacion_motivo}”</span>
                  <span className="block text-suave">{v.venta_items.map((i) => `${Number(i.cantidad)} × ${i.nombre}`).join(" · ")}</span>
                </span>
                <span className="flex gap-2">
                  <BotonAccion accion={anularVenta.bind(null, v.id)} texto="Confirmar anulación" />
                  <BotonAccion accion={rechazarAnulacion.bind(null, v.id)} texto="Rechazar" borde />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action="/ventas" className="flex gap-2">
        <input name="codigo" defaultValue={buscado} inputMode="text" autoComplete="off" placeholder="Escaneá o escribí el código del ticket"
          className="w-full rounded-lg border border-linea bg-white px-3 py-2 uppercase" />
        <button className="boton !px-4">Buscar</button>
      </form>
      {buscado && (
        <div className={`rounded-lg px-3 py-2 text-sm ${rango && ventas.length ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
          {!rango ? "El código del ticket tiene 8 letras y números (por ejemplo 3F9A0C21)." :
            ventas.length === 0 ? `No encontré ninguna venta con el código ${buscado.toUpperCase()}.` :
            `Venta ${buscado.toUpperCase()} encontrada.`} <Link href="/ventas" className="underline">Volver al día</Link>
        </div>
      )}

      {!buscado && <div className="flex flex-wrap gap-2 text-sm">
        {[null, 1, 2].map((l) => (
          <Link key={String(l)} href={url(dia, l)} className={`rounded-full border px-3 py-1.5 ${local === l ? "border-marca bg-marca text-white" : "border-linea bg-white"}`}>
            {l ? nombreLocal(l) : "Los dos locales"}
          </Link>
        ))}
      </div>}

      {!buscado && <div className="grid gap-4 md:grid-cols-3">
        <div className="tarjeta">
          <p className="text-sm text-suave">Vendido</p>
          <p className="mt-1 text-2xl font-semibold">{pesos(total)}</p>
          <p className="text-sm text-suave">{validas.length} ventas{ventas.length > validas.length ? ` · ${ventas.length - validas.length} anuladas` : ""}</p>
        </div>
        <div className="tarjeta md:col-span-2">
          <p className="text-sm text-suave">Por medio de pago</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {porMedio.map((m) => (
              <li key={m.id} className="flex justify-between gap-2"><span>{m.nombre}</span><b>{pesos(m.total)}</b></li>
            ))}
          </ul>
        </div>
      </div>}

      <div className="rounded-2xl border border-linea bg-white">
        {ventas.length === 0 ? (
          <p className="px-6 py-10 text-center text-suave">{buscado ? "Sin resultados." : "No hay ventas este día."}</p>
        ) : (
          <ul className="divide-y divide-linea">
            {ventas.map((v) => (
              <li key={v.id} className={`px-4 py-3 md:px-6 ${v.anulada ? "opacity-50" : ""}`}>
                <details open={!!buscado}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>#{v.numero}</b> · {buscado ? `${new Date(v.creada_en).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} ` : ""}{hora(v.creada_en)} · {nombreLocal(v.local_id)} <span className="font-mono text-xs text-suave">{codigoVenta(v.id)}</span>
                      <span className="block text-sm text-suave">
                        {MEDIOS.find((m) => m.id === v.medio_pago)?.nombre} · {v.venta_items.reduce((s, i) => s + Number(i.cantidad), 0)} u.
                        {v.anulada && <span className="ml-2 font-semibold text-red-700">ANULADA</span>}
                        {!v.anulada && v.anulacion_pedida_en && <span className="ml-2 font-semibold text-amber-700">ANULACIÓN PEDIDA</span>}
                      </span>
                    </span>
                    <span className={`font-semibold ${v.anulada ? "line-through" : ""}`}>{pesos(Number(v.total))}</span>
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {v.venta_items.sort((a, b) => a.n - b.n).map((i) => (
                      <li key={i.n} className="flex justify-between gap-3">
                        <span>{Number(i.cantidad)} × {i.nombre} <span className="text-suave">({pesos(Number(i.precio_unitario))})</span></span>
                        <span>{pesos(Number(i.total))}</span>
                      </li>
                    ))}
                  </ul>
                  {!v.anulada && (() => {
                    const vence = venceCambio(v.creada_en);
                    const enPlazo = Date.now() <= vence.getTime();
                    return (
                      <>
                        <p className={`mt-3 text-sm font-medium ${enPlazo ? "text-green-700" : "text-red-700"}`}>
                          {enPlazo ? "Dentro del plazo de cambio" : "Plazo de cambio vencido"} (vence {vence.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })})
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Reimprimir venta={{ id: v.id, local_id: v.local_id, creada_en: v.creada_en, medio: MEDIOS.find((m) => m.id === v.medio_pago)?.nombre ?? v.medio_pago,
                            total: Number(v.total), paga_con: v.paga_con == null ? null : Number(v.paga_con),
                            items: [...v.venta_items].sort((a, b) => a.n - b.n).map((i) => ({ nombre: i.nombre, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), total: Number(i.total) })) }} />
                          {duenio && <BotonAccion accion={anularVenta.bind(null, v.id)} texto="Anular venta" borde />}
                        </div>
                        {v.anulacion_pedida_en ? (
                          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            Anulación pedida por {quien(v.anulacion_pedida_por)} (“{v.anulacion_motivo}”). {duenio ? "Confirmala o rechazala arriba." : "Esperando que Martín o Sofi la confirmen."}
                          </p>
                        ) : !duenio && (
                          <>
                            {v.anulacion_rechazada_en && <p className="mt-3 text-sm text-red-700">El pedido de anulación anterior fue rechazado.</p>}
                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm text-marca underline">Pedir anulación</summary>
                              <Formulario accion={pedirAnulacion.bind(null, v.id)} boton="Enviar pedido" className="mt-2 max-w-md">
                                <label><span className="etiqueta">¿Por qué hay que anularla?</span>
                                  <input name="motivo" className="campo" required minLength={3} maxLength={300} placeholder="Ej.: cobré dos veces, el cliente se arrepintió" /></label>
                              </Formulario>
                            </details>
                          </>
                        )}
                      </>
                    );
                  })()}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
