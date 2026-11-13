import Link from "next/link";
import { anularVenta, pedirAnulacion, rechazarAnulacion } from "../../acciones";
import { BotonAccion, Formulario } from "../../componentes";
import { MEDIOS_CAJA, claveCodigo, partesPago, nombreMedio } from "@/lib/caja";
import { diaArgentina, restarDias } from "@/lib/fechas";
import { fechaCorta, hora, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioConRol } from "@/lib/supabase/sesion";
import { codigoVenta, rangoCodigo, venceCambio } from "@/lib/impresion";
import { Reimprimir } from "./reimprimir";
import { DiaSelector } from "../../dia-selector";

type Venta = {
  id: string; numero: number; local_id: number; creada_en: string; medio_pago: string; total: number; total_lista: number;
  anulada: boolean; paga_con: number | null; terminal?: string | null;
  anulacion_pedida_por?: string | null; anulacion_pedida_en?: string | null; anulacion_motivo?: string | null; anulacion_rechazada_en?: string | null;
  giftcard_id?: string | null; giftcard_monto?: number | null; pagos?: { medio: string; monto: number }[] | null;
  venta_items: { n: number; nombre: string; sku: string | null; cantidad: number; precio_unitario: number; total: number }[];
};

function hace(horas: number) {
  return new Date(Date.now() - horas * 3600_000).toISOString();
}

export default async function Ventas({ searchParams }: { searchParams: Promise<{ dia?: string; local?: string; codigo?: string; prueba?: string }> }) {
  const { rol, u } = await usuarioConRol();
  const duenio = rol === "duenio";
  const db = clienteServidor();
  const sp = await searchParams;
  const verPrueba = duenio && sp.prueba === "1"; // ventas de la caja de prueba (aparte de las reales)
  const hoy = diaArgentina();
  const dia = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoy;
  const local = sp.local === "1" || sp.local === "2" ? Number(sp.local) : null;
  const siguiente = restarDias(dia, -1);

  const buscado = sp.codigo?.trim() ?? "";
  let rango = buscado ? rangoCodigo(buscado) : null;
  // Si no es un código de ticket, se busca por producto: nombre, SKU o código de barras (interno u original)
  let producto: { texto: string; ids: string[] } | null = null;
  const comillas = (x: string) => `"${x.replace(/"/g, "")}"`;
  const armarBusquedaProducto = async () => {
    const t = buscado.replace(/[%,()*\\]/g, " ").trim();
    if (t.length < 2) return null;
    const ids = new Set<string>();
    const [p, alt] = await Promise.all([
      db.from("productos").select("id").or(`barcode.eq.${comillas(t)},sku.ilike.${comillas(t)}`).limit(20),
      db.from("producto_codigos").select("producto_id").eq("clave", claveCodigo(t)).limit(5),
    ]);
    for (const x of p.data ?? []) ids.add(x.id);
    for (const x of alt.error ? [] : alt.data ?? []) ids.add(x.producto_id);
    return { texto: t, ids: [...ids] };
  };
  if (rango) {
    // parece un código de ticket; si no hay ninguna venta con ese código, se busca como producto (ej. un SKU de 8 cifras)
    const { count } = await db.from("ventas").select("id", { count: "exact", head: true }).gte("id", rango[0]).lte("id", rango[1]);
    if (!count) rango = null;
  }
  if (buscado && !rango) producto = await armarBusquedaProducto();
  // Colaboradores: solo ven su caja abierta (la que abrieron o en la que trabaja su compu), en tiempo real
  let misTurnos: { id: string; local_id: number; abierta_en: string }[] | null = null;
  if (!duenio && !rango) { // (también al buscar por producto: el colaborador busca solo en su caja)
    const { data: compus } = await db.from("terminales").select("turno_id").eq("usuario_id", u.id).gte("visto_en", hace(16)).not("turno_id", "is", null);
    const ids = [...new Set((compus ?? []).map((t) => t.turno_id as string))];
    const { data: abiertos } = await db.from("turnos_caja").select("id, local_id, abierta_en, abierta_por").is("cerrada_en", null);
    misTurnos = (abiertos ?? []).filter((t) => ids.includes(t.id) || t.abierta_por === u.id);
  }
  // Con búsqueda por producto se pide además "coincide": los renglones que coinciden (filtra las ventas)
  const BASE = "id, numero, local_id, creada_en, medio_pago, total, total_lista, anulada, paga_con, terminal, venta_items(n, nombre, sku, cantidad, precio_unitario, total)"
    + (producto ? ", coincide:venta_items!inner(n)" : "");
  const PEDIDOS = ", anulacion_pedida_por, anulacion_pedida_en, anulacion_motivo, anulacion_rechazada_en";
  const consulta = (cols: string) => {
    let q = db.from("ventas").select(cols).eq("prueba", verPrueba).order("creada_en", { ascending: false }).limit(producto ? 100 : 1000);
    if (verPrueba) return q;
    if (rango) q = q.gte("id", rango[0]).lte("id", rango[1]);
    else if (producto) {
      const nombre = `nombre.ilike.%${producto.texto.split(/\s+/).join("%")}%`;
      q = q.or([nombre, `sku.ilike.${comillas(producto.texto)}`, `barcode.eq.${comillas(producto.texto)}`, ...(producto.ids.length ? [`producto_id.in.(${producto.ids.join(",")})`] : [])].join(","), { referencedTable: "coincide" });
      if (misTurnos) q = q.in("turno_id", misTurnos.length ? misTurnos.map((t) => t.id) : ["00000000-0000-0000-0000-000000000000"]);
    }
    else if (misTurnos) q = q.in("turno_id", misTurnos.length ? misTurnos.map((t) => t.id) : ["00000000-0000-0000-0000-000000000000"]);
    else q = q.gte("creada_en", `${dia}T00:00:00-03:00`).lt("creada_en", `${siguiente}T00:00:00-03:00`);
    if (local && !rango && !misTurnos) q = q.eq("local_id", local);
    return q;
  };
  const [primera, { data: locales }, { data: perfiles }, pendientesQ] = await Promise.all([
    consulta(BASE + PEDIDOS),
    db.from("locales").select("id, nombre").order("id"),
    db.from("perfiles").select("usuario_id, nombre"),
    duenio ? db.from("ventas").select(BASE + PEDIDOS).not("anulacion_pedida_en", "is", null).eq("anulada", false).order("anulacion_pedida_en") : Promise.resolve({ data: [] }),
  ]);
  // si todavía no se corrieron las migraciones nuevas, se ve igual que antes
  const conPagos = primera.error ? null : await consulta(BASE + PEDIDOS + ", giftcard_id, giftcard_monto, pagos");
  const conGc = primera.error ? null : conPagos && !conPagos.error ? conPagos : await consulta(BASE + PEDIDOS + ", giftcard_id, giftcard_monto");
  const { data } = conGc && !conGc.error ? conGc : primera.error ? await consulta(BASE) : primera;
  const ventas = (data ?? []) as unknown as Venta[];
  const palabras = producto ? producto.texto.toLowerCase().split(/\s+/) : [];
  const coincide = (i: { nombre: string; sku: string | null }) => !!producto && (palabras.every((w) => i.nombre.toLowerCase().includes(w)) || i.sku?.toLowerCase() === producto.texto.toLowerCase());
  const pendientes = ((pendientesQ.data ?? []) as unknown as Venta[]);
  const conTarjeta = ventas.filter((v) => Number(v.giftcard_monto) > 0 || v.venta_items.some((i) => i.nombre.startsWith("Gift card ")));
  const { data: tarjetas } = conTarjeta.length
    ? await db.from("giftcards").select("id, codigo, monto, venta_id")
        .or([...conTarjeta.map((v) => `venta_id.eq.${v.id}`), ...conTarjeta.filter((v) => v.giftcard_id).map((v) => `id.eq.${v.giftcard_id}`)].join(","))
    : { data: [] as { id: string; codigo: string; monto: number; venta_id: string }[] };
  const tarjetaUsada = (v: Venta) => (Number(v.giftcard_monto) > 0 ? tarjetas?.find((g) => g.id === v.giftcard_id) : undefined);
  const tarjetaVendida = (v: Venta) => tarjetas?.find((g) => g.venta_id === v.id);
  const medioTexto = (v: Venta) => Number(v.giftcard_monto) > 0
    ? `Gift card ${pesos(Number(v.giftcard_monto))}${Number(v.total) > 0 ? ` + ${nombreMedio(v.medio_pago)}` : ""}`
    : v.pagos?.length ? v.pagos.map((p) => `${nombreMedio(p.medio)} ${pesos(Number(p.monto))}`).join(" + ")
    : nombreMedio(v.medio_pago);
  const quien = (id?: string | null) => perfiles?.find((p) => p.usuario_id === id)?.nombre || "un colaborador";
  const validas = ventas.filter((v) => !v.anulada);
  const canjeado = validas.reduce((s, v) => s + Number(v.giftcard_monto ?? 0), 0);
  const total = validas.reduce((s, v) => s + Number(v.total), 0);
  const partes = validas.flatMap((v) => partesPago(v));
  const porMedio = MEDIOS_CAJA.map((m) => ({ ...m, total: partes.filter((p) => p.medio === m.id).reduce((s, p) => s + p.monto, 0), n: partes.filter((p) => p.medio === m.id).length }));
  const nombreLocal = (id: number) => locales?.find((l) => l.id === id)?.nombre ?? `Local ${id}`;
  const url = (d: string, l: number | null) => `/ventas?dia=${d}${l ? `&local=${l}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{verPrueba ? "Ventas de la caja de prueba" : misTurnos ? "Ventas de tu caja" : "Ventas"}</h1>
          {verPrueba && <p className="text-sm text-orange-800">No cuentan en nada. Se borran desde Configuración → Caja de prueba. <Link href="/ventas" className="underline">Volver a las ventas reales</Link></p>}
          {misTurnos ? (
            <p className="text-sm text-suave">
              {misTurnos.length
                ? misTurnos.map((t) => `${nombreLocal(t.local_id)}, abierta desde las ${new Date(t.abierta_en).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}`).join(" · ")
                : "No tenés una caja abierta. Cuando abras la caja (o te sumes a una), acá vas a ver sus ventas."}
              {" · "}<Link href="/giftcards" className="text-marca underline">Gift cards →</Link>
            </p>
          ) : (
            <span className="flex gap-4"><Link href="/cierres" className="text-sm text-marca underline">Cierres de caja y arqueos →</Link>
              <Link href="/giftcards" className="text-sm text-marca underline">Gift cards →</Link></span>
          )}
        </div>
        {!misTurnos && !verPrueba && <DiaSelector dia={dia} hoy={hoy} ruta="/ventas" extra={local ? { local: String(local) } : {}} />}
      </div>

      {pendientes.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Anulaciones para autorizar ({pendientes.length})</h2>
          <ul className="mt-2 divide-y divide-amber-200">
            {pendientes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-sm">
                  <b>#{v.numero}</b> · {new Date(v.creada_en).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {nombreLocal(v.local_id)} · <b>{pesos(Number(v.total) + Number(v.giftcard_monto ?? 0))}</b> · {medioTexto(v)}
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
        <input name="codigo" defaultValue={buscado} inputMode="text" autoComplete="off" placeholder="Código del ticket, o un producto (nombre, SKU o código de barras)"
          className="w-full rounded-lg border border-linea bg-white px-3 py-2" />
        <button className="boton !px-4">Buscar</button>
      </form>
      {buscado && (
        <div className={`rounded-lg px-3 py-2 text-sm ${(rango || producto) && ventas.length ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
          {producto ? (ventas.length === 0 ? `No encontré ventas con "${buscado}"${misTurnos ? " en tu caja" : ""}.` :
              `${ventas.length === 100 ? "Las últimas 100 ventas" : `${ventas.length} venta${ventas.length === 1 ? "" : "s"}`} con "${buscado}"${misTurnos ? " en tu caja" : local ? ` en ${nombreLocal(local)}` : ""}. Lo que coincide está resaltado.`) :
            !rango ? "Escribí al menos 2 letras del producto, o el código del ticket (8 letras y números, por ejemplo 3F9A0C21)." :
            ventas.length === 0 ? `No encontré ninguna venta con el código ${buscado.toUpperCase()}.` :
            `Venta ${buscado.toUpperCase()} encontrada.`} <Link href="/ventas" className="underline">{duenio ? "Volver al día" : "Volver a tu caja"}</Link>
        </div>
      )}

      {!buscado && !misTurnos && <div className="flex flex-wrap gap-2 text-sm">
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
          {canjeado > 0 && <p className="mt-1 text-sm text-suave">Además se usaron {pesos(canjeado)} de gift cards (no entran a la caja)</p>}
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
                <details open={!!rango}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>#{v.numero}</b> · {buscado ? `${new Date(v.creada_en).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} ` : ""}{hora(v.creada_en)} · {nombreLocal(v.local_id)} {v.terminal?.startsWith("Aronium") && <span className="rounded bg-gray-100 px-1.5 text-xs text-suave">{v.terminal}</span>} <span className="font-mono text-xs text-suave">{codigoVenta(v.id)}</span>
                      <span className="block text-sm text-suave">
                        {medioTexto(v)} · {v.venta_items.reduce((s, i) => s + Number(i.cantidad), 0)} u.
                        {v.anulada && <span className="ml-2 font-semibold text-red-700">ANULADA</span>}
                        {!v.anulada && v.anulacion_pedida_en && <span className="ml-2 font-semibold text-amber-700">ANULACIÓN PEDIDA</span>}
                      </span>
                    </span>
                    <span className={`font-semibold ${v.anulada ? "line-through" : ""}`}>{pesos(Number(v.total))}</span>
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {v.venta_items.sort((a, b) => a.n - b.n).map((i) => (
                      <li key={i.n} className={`flex justify-between gap-3 ${producto && coincide(i) ? "-mx-1 rounded bg-amber-100 px-1 font-semibold" : ""}`}>
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
                        {enPlazo && <Link href={`/caja?cambio=${codigoVenta(v.id)}`} className="boton-borde mt-2 inline-flex !px-3 !py-1.5 text-sm">↺ Hacer cambio en la caja</Link>}
                        {v.terminal?.startsWith("Aronium") ? <p className="mt-2 text-xs text-suave">Venta importada de Aronium: no se reimprime ni se anula. Para cambiar algo usá “Hacer cambio en la caja” (o el código {codigoVenta(v.id)} en Caja → Cambio).</p> : <div className="mt-2 flex flex-wrap gap-2">
                          <Reimprimir venta={{ id: v.id, local_id: v.local_id, creada_en: v.creada_en, medio: nombreMedio(v.medio_pago),
                            giftcard: tarjetaUsada(v) ? { codigo: tarjetaUsada(v)!.codigo, usado: Number(v.giftcard_monto), saldo: null } : null,
                            giftcard_nueva: tarjetaVendida(v) ? { codigo: tarjetaVendida(v)!.codigo, monto: Number(tarjetaVendida(v)!.monto) } : null,
                            total: Number(v.total), paga_con: v.paga_con == null ? null : Number(v.paga_con),
                            items: [...v.venta_items].sort((a, b) => a.n - b.n).map((i) => ({ nombre: i.nombre, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), total: Number(i.total) })) }} />
                          {duenio && <BotonAccion accion={anularVenta.bind(null, v.id)} texto="Anular venta" borde />}
                        </div>}
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
