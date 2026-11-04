export const maxDuration = 120; // facturar muchos cobros juntos puede tardar
import Link from "next/link";
import { facturarAhora, marcarCobro, traerCobrosDesde } from "../acciones";
import { BotonAccion, Formulario } from "../componentes";
import { diaArgentina, restarDias } from "@/lib/fechas";
import { fechaCorta, hora, ORIGENES, pesos } from "@/lib/formato";
import { clienteServidor, posiblesDuplicados } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

const PESTANAS = [
  { id: "revisar", texto: "Para revisar", ayuda: "Transferencias y otros cobros: decidí si son ventas." },
  { id: "a_facturar", texto: "Por facturar", ayuda: "Ventas confirmadas que todavía no tienen factura." },
  { id: "error", texto: "Errores", ayuda: "ARCA rechazó la factura o no respondió." },
  { id: "facturado", texto: "Facturados", ayuda: "Ya tienen factura." },
  { id: "ya_facturado", texto: "Ya facturados", ayuda: "Coinciden en importe y fecha con una factura hecha a mano en ARCA. Si alguno no corresponde, tocá “No era esta”." },
  { id: "no_es_venta", texto: "No son venta", ayuda: "Se marcaron como que no hay que facturarlos." },
] as const;

type Fila = {
  id: string; dia: string; fecha_hora: string; importe: number; origen: string;
  detalle: string | null; estado: string; mensaje: string | null;
};

function Acciones({ c }: { c: Fila }) {
  return (
    <div className="flex items-center justify-end gap-3">
      {["revisar", "error", "no_es_venta"].includes(c.estado) && (
        <form action={marcarCobro.bind(null, c.id, "a_facturar")}>
          <button className="boton-borde !px-3 !py-1.5">{c.estado === "error" ? "Reintentar" : "Es venta"}</button>
        </form>
      )}
      {c.estado === "ya_facturado" && (
        <form action={marcarCobro.bind(null, c.id, c.origen === "posnet" || c.origen === "qr" ? "a_facturar" : "revisar")}>
          <button className="py-1.5 text-sm text-suave underline">No era esta</button>
        </form>
      )}
      {["revisar", "error", "a_facturar"].includes(c.estado) && (
        <form action={marcarCobro.bind(null, c.id, "no_es_venta")}>
          <button className="py-1.5 text-sm text-suave underline">No es venta</button>
        </form>
      )}
    </div>
  );
}

export default async function Cobros({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await usuarioActual();
  const db = clienteServidor();
  const ver = (await searchParams).ver ?? "revisar";
  const pestana = PESTANAS.find((p) => p.id === ver) ?? PESTANAS[0];

  const [{ data: filas }, { data: todos }, { data: emisor }] = await Promise.all([
    db.from("cobros").select("*").eq("usuario_id", u.id).eq("estado", pestana.id).order("fecha_hora", { ascending: false }).limit(300),
    db.from("cobros").select("estado").eq("usuario_id", u.id).in("estado", ["revisar", "a_facturar", "error"]),
    db.from("emisores").select("ambiente, facturar_automatico, punto_venta").eq("usuario_id", u.id).maybeSingle(),
  ]);
  const duplicados = await posiblesDuplicados(db, u.id, emisor?.punto_venta ?? null);
  const cuenta = (estado: string) => (todos ?? []).filter((t) => t.estado === estado).length;

  return (
    <div className="space-y-6">
      {!emisor && (
        <div className="tarjeta border-amber-300 bg-amber-50">
          Todavía no cargaste tus datos. Andá a <Link href="/configuracion" className="font-semibold underline">Configuración</Link> para empezar.
        </div>
      )}
      {emisor?.ambiente === "homologacion" && (
        <p className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Modo <b>prueba</b>: las facturas que se emitan no tienen validez.
        </p>
      )}

      {duplicados.length > 0 && (
        <details className="tarjeta border-red-300 bg-red-50 text-red-900">
          <summary className="cursor-pointer font-semibold">
            Atención: {duplicados.length} {duplicados.length === 1 ? "venta podría estar facturada" : "ventas podrían estar facturadas"} dos veces
          </summary>
          <p className="mt-2 text-sm">
            El sistema las facturó y además hay una factura hecha a mano con el mismo importe y fecha cercana.
            Revisá cada una en ARCA; si es la misma venta, hay que anular una con nota de crédito.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {duplicados.map((d) => (
              <li key={d.cobroId}>
                {fechaCorta(d.dia)} · <b>{pesos(d.importe)}</b> · sistema {d.facturaSistema} · a mano {d.facturaMano} ({fechaCorta(d.fechaMano)})
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="tarjeta">
          <h2 className="font-semibold">Traer cobros de Mercado Pago</h2>
          <p className="ayuda">El sistema lo hace solo cada 15 minutos. Usalo para traer cobros viejos.</p>
          <Formulario accion={traerCobrosDesde} boton="Traer cobros">
            <label className="etiqueta mt-3" htmlFor="desde">Desde el día</label>
            <input id="desde" name="desde" type="date" className="campo" defaultValue={restarDias(diaArgentina(), 7)} max={diaArgentina()} />
          </Formulario>
        </div>
        <div className="tarjeta">
          <h2 className="font-semibold">Facturar</h2>
          <p className="ayuda">
            {emisor?.facturar_automatico
              ? "La facturación automática está prendida: las ventas se facturan solas."
              : "La facturación automática está apagada. Podés facturar a mano lo que está en “Por facturar”."}
          </p>
          <div className="mt-4">
            <BotonAccion accion={facturarAhora} texto={`Facturar ahora (${cuenta("a_facturar")})`} />
          </div>
        </div>
      </div>

      <div>
        <div className="-mx-4 flex gap-1 overflow-x-auto border-b border-linea px-4 whitespace-nowrap md:mx-0 md:flex-wrap md:px-0">
          {PESTANAS.map((p) => {
            const n = ["revisar", "a_facturar", "error"].includes(p.id) ? cuenta(p.id) : null;
            const activa = p.id === pestana.id;
            return (
              <Link key={p.id} href={`/?ver=${p.id}`}
                className={`-mb-px rounded-t-lg px-4 py-2 text-sm ${activa ? "border border-b-white border-linea bg-white font-semibold" : "text-suave hover:text-tinta"}`}>
                {p.texto}
                {n ? <span className={`ml-2 rounded-full px-2 text-xs ${p.id === "error" ? "bg-red-100 text-red-800" : "bg-marca-claro text-marca"}`}>{n}</span> : null}
              </Link>
            );
          })}
        </div>
        <div className="rounded-b-2xl border border-t-0 border-linea bg-white">
          <p className="px-4 pt-4 text-sm text-suave md:px-6">{pestana.ayuda}</p>
          {(filas ?? []).length === 0 ? (
            <p className="px-6 py-10 text-center text-suave">No hay cobros acá.</p>
          ) : (
            <>
            <ul className="mt-2 divide-y divide-linea md:hidden">
              {(filas as Fila[]).map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-semibold">{pesos(Number(c.importe))}</span>
                    <span className="text-sm text-suave">{fechaCorta(c.dia)} {hora(c.fecha_hora)}</span>
                  </div>
                  <p className="text-sm text-suave">{ORIGENES[c.origen] ?? c.origen}{c.detalle ? ` · ${c.detalle}` : ""}</p>
                  {c.mensaje && <p className="mt-1 text-sm text-red-700">{c.mensaje}</p>}
                  {["revisar", "error", "no_es_venta", "a_facturar", "ya_facturado"].includes(c.estado) && <div className="mt-2"><Acciones c={c} /></div>}
                </li>
              ))}
            </ul>
            <table className="mt-2 hidden w-full text-sm md:table">
              <thead className="text-left text-suave">
                <tr className="border-b border-linea">
                  <th className="px-6 py-2 font-medium">Fecha</th>
                  <th className="py-2 font-medium">Origen</th>
                  <th className="py-2 font-medium">Detalle</th>
                  <th className="py-2 text-right font-medium">Importe</th>
                  <th className="px-6 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(filas as Fila[]).map((c) => (
                  <tr key={c.id} className="border-b border-linea last:border-0 align-top">
                    <td className="px-6 py-3 whitespace-nowrap">{fechaCorta(c.dia)} <span className="text-suave">{hora(c.fecha_hora)}</span></td>
                    <td className="py-3">{ORIGENES[c.origen] ?? c.origen}</td>
                    <td className="py-3 text-suave">
                      {c.detalle || "—"}
                      {c.mensaje && <div className="mt-1 text-red-700">{c.mensaje}</div>}
                    </td>
                    <td className="py-3 text-right font-semibold whitespace-nowrap">{pesos(Number(c.importe))}</td>
                    <td className="px-6 py-3">
                      <Acciones c={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </div>
        {pestana.id === "error" && (filas ?? []).some((c) => (c as Fila).mensaje?.startsWith("[VERIFICAR")) && (
          <p className="mt-3 text-sm text-red-800">
            Los marcados “[VERIFICAR EN ARCA]” pueden haberse facturado igual. Antes de reintentar, fijate en
            “Comprobantes en línea → Consultas” si existe la factura.
          </p>
        )}
      </div>
    </div>
  );
}
