import Link from "next/link";
import { diaArgentina, restarDias } from "@/lib/fechas";
import { fechaCorta, numeroFactura, pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function sumarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function Facturas({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const u = await soloDuenio();
  const db = clienteServidor();
  const hoy = diaArgentina();
  const pedido = (await searchParams).mes;
  const mes = pedido && /^\d{4}-\d{2}$/.test(pedido) ? pedido : hoy.slice(0, 7);

  const { data: e } = await db.from("emisores").select("ambiente, tope_anual").eq("usuario_id", u.id).maybeSingle();
  const ambiente = e?.ambiente ?? "homologacion";
  const [{ data: delMes }, { data: anio }] = await Promise.all([
    db.from("facturas").select("*").eq("usuario_id", u.id).eq("ambiente", ambiente)
      .gte("fecha", `${mes}-01`).lt("fecha", `${sumarMes(mes, 1)}-01`).order("numero", { ascending: false }),
    db.from("facturas").select("importe").eq("usuario_id", u.id).eq("ambiente", ambiente).gt("fecha", restarDias(hoy, 365)),
  ]);
  const totalMes = (delMes ?? []).reduce((s, f) => s + Number(f.importe), 0);
  const total12 = (anio ?? []).reduce((s, f) => s + Number(f.importe), 0);
  const tope = e?.tope_anual ? Number(e.tope_anual) : null;
  const usado = tope ? Math.min(100, (total12 / tope) * 100) : null;
  const [a, m] = mes.split("-").map(Number);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Facturas</h1>
          {ambiente === "homologacion" && <p className="text-sm text-blue-900">Mostrando facturas de prueba.</p>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/facturas?mes=${sumarMes(mes, -1)}`} className="boton-borde !px-4 !py-2">←</Link>
          <span className="w-36 text-center font-semibold capitalize">{MESES[m - 1]} {a}</span>
          <Link href={`/facturas?mes=${sumarMes(mes, 1)}`} className="boton-borde !px-4 !py-2">→</Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="tarjeta">
          <p className="text-sm text-suave">Facturado en {MESES[m - 1]}</p>
          <p className="mt-1 text-2xl font-semibold">{pesos(totalMes)}</p>
          <p className="text-sm text-suave">{(delMes ?? []).length} facturas</p>
        </div>
        <div className="tarjeta">
          <p className="text-sm text-suave">Últimos 12 meses (lo que mira el monotributo)</p>
          <p className="mt-1 text-2xl font-semibold">{pesos(total12)}</p>
          {usado !== null ? (
            <>
              <div className="mt-2 h-2 rounded-full bg-marca-claro">
                <div className={`h-2 rounded-full ${usado > 85 ? "bg-red-600" : "bg-marca"}`} style={{ width: `${usado}%` }} />
              </div>
              <p className="mt-1 text-sm text-suave">{usado.toFixed(0)}% del tope de tu categoría ({pesos(tope!)})</p>
            </>
          ) : (
            <p className="text-sm text-suave">Cargá el tope de tu categoría en Configuración para ver cuánto te queda.</p>
          )}
          <p className="mt-2 text-xs text-suave">Solo cuenta lo facturado por este sistema, no lo de efectivo.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-linea bg-white">
        {(delMes ?? []).length === 0 ? (
          <p className="px-6 py-10 text-center text-suave">No hay facturas este mes.</p>
        ) : (
          <>
          <ul className="divide-y divide-linea md:hidden">
            {(delMes ?? []).map((f) => (
              <li key={f.id}>
                <a href={`/facturas/${f.id}/pdf`} target="_blank" className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block font-mono text-sm">{numeroFactura(f.punto_venta, f.numero)}</span>
                    <span className="text-sm text-suave">
                      {fechaCorta(f.fecha)}
                      {f.fuera_de_termino && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">fuera de término</span>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold">{pesos(Number(f.importe))}</span>
                    <span className="text-sm text-marca underline">PDF</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-sm md:table">
            <thead className="text-left text-suave">
              <tr className="border-b border-linea">
                <th className="px-6 py-2 font-medium">Número</th>
                <th className="py-2 font-medium">Fecha</th>
                <th className="py-2 font-medium">CAE</th>
                <th className="py-2 text-right font-medium">Importe</th>
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(delMes ?? []).map((f) => (
                <tr key={f.id} className="border-b border-linea last:border-0">
                  <td className="px-6 py-3 font-mono">{numeroFactura(f.punto_venta, f.numero)}</td>
                  <td className="py-3">
                    {fechaCorta(f.fecha)}
                    {f.fuera_de_termino && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">fuera de término</span>}
                  </td>
                  <td className="py-3 font-mono text-suave">{f.cae}</td>
                  <td className="py-3 text-right font-semibold">{pesos(Number(f.importe))}</td>
                  <td className="px-6 py-3 text-right">
                    <a href={`/facturas/${f.id}/pdf`} target="_blank" className="text-marca underline">PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
    </div>
  );
}
