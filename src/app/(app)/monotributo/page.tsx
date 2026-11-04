import { importarMisComprobantes } from "../../acciones";
import { Formulario } from "../../componentes";
import { diaArgentina } from "@/lib/fechas";
import { pesos } from "@/lib/formato";
import { mesSiguiente, periodosRecategorizacion, totalesPorMes, ultimos12, type Movimiento } from "@/lib/periodos";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesCorto = (m: string) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
const mesLargo = (m: string) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

async function todos<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const res: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await consulta(i, i + 999);
    res.push(...(data ?? []));
    if (!data || data.length < 1000) return res;
  }
}

export default async function Monotributo() {
  const u = await usuarioActual();
  const db = clienteServidor();
  const hoy = diaArgentina();

  const [{ data: e }, importados, delSistema] = await Promise.all([
    db.from("emisores").select("tope_anual").eq("usuario_id", u.id).maybeSingle(),
    todos<{ tipo: number; punto_venta: number; numero_desde: number; fecha: string; importe: number }>((a, b) =>
      db.from("comprobantes_arca").select("tipo, punto_venta, numero_desde, fecha, importe").eq("usuario_id", u.id).order("fecha").range(a, b)),
    todos<{ punto_venta: number; numero: number; fecha: string; importe: number }>((a, b) =>
      db.from("facturas").select("punto_venta, numero, fecha, importe").eq("usuario_id", u.id).eq("ambiente", "produccion").order("fecha").range(a, b)),
  ]);

  // Juntar sin duplicar: lo importado de ARCA manda; del sistema se suma lo que todavía no está importado.
  const clave = (tipo: number, pv: number, n: number) => `${tipo}-${pv}-${n}`;
  const yaImportado = new Set(importados.map((c) => clave(c.tipo, c.punto_venta, c.numero_desde)));
  const movs: Movimiento[] = [
    ...importados.map((c) => ({ fecha: c.fecha, importe: Number(c.importe) })),
    ...delSistema.filter((f) => !yaImportado.has(clave(11, f.punto_venta, f.numero))).map((f) => ({ fecha: f.fecha, importe: Number(f.importe) })),
  ];

  const tope = e?.tope_anual ? Number(e.tope_anual) : null;
  const periodos = periodosRecategorizacion(movs, hoy);
  const proxima = periodos[0];
  const corridos = ultimos12(movs, hoy);
  const porMes = totalesPorMes(movs);
  const ultimoImportado = importados.reduce<string | null>((max, c) => (!max || c.fecha > max ? c.fecha : max), null);

  // Gráfico: últimos 24 meses
  const meses = Array.from({ length: 24 }, (_, i) => mesSiguiente(hoy.slice(0, 7), i - 23));
  const maxMes = Math.max(1, ...meses.map((m) => porMes.get(m)?.total ?? 0));

  const barraTope = (valor: number) => {
    if (!tope) return null;
    const p = Math.min(100, (valor / tope) * 100);
    return (
      <>
        <div className="mt-3 h-2 rounded-full bg-marca-claro">
          <div className={`h-2 rounded-full ${p > 85 ? "bg-red-600" : "bg-marca"}`} style={{ width: `${p}%` }} />
        </div>
        <p className="mt-1 text-sm text-suave">{((valor / tope) * 100).toFixed(0)}% del tope cargado ({pesos(tope)})</p>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Monotributo</h1>
        <p className="mt-1 text-suave">
          Todo lo facturado según ARCA, por período de recategorización. Cada recategorización (enero y julio) mira los 12 meses anteriores.
        </p>
      </div>

      {movs.length === 0 ? (
        <div className="tarjeta text-suave">Todavía no hay datos. Subí el archivo de Mis Comprobantes (abajo) para ver todo tu historial.</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {proxima && (
              <div className="tarjeta">
                <p className="text-sm text-suave">
                  Próxima recategorización: <b className="text-tinta">{proxima.nombre}</b> ({mesLargo(proxima.desde)} a {mesLargo(proxima.hasta)})
                </p>
                <p className="mt-1 text-2xl font-semibold">{pesos(proxima.total)}</p>
                <p className="text-sm text-suave">{proxima.cantidad} comprobantes{proxima.enCurso ? " · período en curso" : ""}</p>
                {barraTope(proxima.total)}
              </div>
            )}
            <div className="tarjeta">
              <p className="text-sm text-suave">Últimos 12 meses corridos ({mesLargo(mesSiguiente(hoy.slice(0, 7), -11))} a hoy)</p>
              <p className="mt-1 text-2xl font-semibold">{pesos(corridos)}</p>
              <p className="text-sm text-suave">Si en cualquier momento superás el tope de la categoría más alta, ARCA te puede excluir.</p>
              {barraTope(corridos)}
            </div>
          </div>

          <div className="tarjeta">
            <h2 className="font-semibold">Mes a mes</h2>
            <div className="mt-4 flex h-36 items-end gap-0.5 md:h-44 md:gap-1">
              {meses.map((m) => {
                const v = porMes.get(m)?.total ?? 0;
                return (
                  <div key={m} className="group relative flex h-full flex-1 flex-col justify-end">
                    <div className="rounded-t bg-marca/80 group-hover:bg-marca" style={{ height: `${Math.max(0, (v / maxMes) * 100)}%` }} />
                    <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-tinta px-2 py-0.5 text-xs text-white group-hover:block">
                      {mesLargo(m)}: {pesos(v)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1 text-[10px] text-suave">
              {meses.map((m, i) => <span key={m} className="flex-1 text-center">{i % 3 === 0 ? mesCorto(m) : ""}</span>)}
            </div>
          </div>

          <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white md:hidden">
            {periodos.map((p) => (
              <li key={p.nombre} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block font-semibold">
                    {p.nombre}
                    {p.enCurso && <span className="ml-2 rounded bg-marca-claro px-1 text-xs font-normal text-marca">en curso</span>}
                  </span>
                  <span className="text-sm text-suave">{mesLargo(p.desde)} a {mesLargo(p.hasta)} · {p.cantidad} comp.</span>
                  {p.mesesConDatos < 12 && !p.enCurso && <span className="block text-xs text-amber-800">solo {p.mesesConDatos} meses con datos</span>}
                </span>
                <span className="font-semibold whitespace-nowrap">{pesos(p.total)}</span>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-2xl border border-linea bg-white md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-suave">
                <tr className="border-b border-linea">
                  <th className="px-6 py-3 font-medium">Recategorización</th>
                  <th className="py-3 font-medium">Período que mira</th>
                  <th className="py-3 text-right font-medium">Comprobantes</th>
                  <th className="px-6 py-3 text-right font-medium">Facturado</th>
                </tr>
              </thead>
              <tbody>
                {periodos.map((p) => (
                  <tr key={p.nombre} className="border-b border-linea last:border-0">
                    <td className="px-6 py-3 font-semibold">
                      {p.nombre}
                      {p.enCurso && <span className="ml-2 rounded bg-marca-claro px-1 text-xs font-normal text-marca">en curso</span>}
                    </td>
                    <td className="py-3">
                      {mesLargo(p.desde)} a {mesLargo(p.hasta)}
                      {p.mesesConDatos < 12 && !p.enCurso && (
                        <span className="ml-2 text-xs text-amber-800">solo {p.mesesConDatos} meses con datos</span>
                      )}
                    </td>
                    <td className="py-3 text-right">{p.cantidad}</td>
                    <td className="px-6 py-3 text-right font-semibold">{pesos(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-suave">
            Las notas de crédito restan. Los topes cambian cada semestre: consultalos en arca.gob.ar/monotributo/categorias.asp y cargá el de tu
            categoría en Configuración. La recategorización también mira superficie, energía y alquileres, que acá no están.
          </p>
        </>
      )}

      <div className="tarjeta">
        <h2 className="font-semibold">Traer el historial de ARCA</h2>
        <p className="ayuda">
          {ultimoImportado ? `Último comprobante cargado: ${ultimoImportado.split("-").reverse().join("/")}. ` : ""}
          Incluye todo lo que facturaste, también lo de efectivo hecho a mano.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>En ARCA entrá a <b>Mis Comprobantes → Emitidos</b>.</li>
          <li>Elegí un rango de fechas (hasta 1 año por vez) y tocá <b>Buscar</b>.</li>
          <li>Descargá en <b>Excel</b> (si son más de 500 comprobantes, ARCA solo deja <b>CSV</b>: sirve igual).</li>
          <li>Subí el archivo acá. Podés subir varios años; si repetís un período no se duplica.</li>
        </ol>
        <Formulario accion={importarMisComprobantes} boton="Subir">
          <input name="archivo" type="file" multiple accept=".xlsx,.csv" className="mt-4 block text-sm" />
        </Formulario>
      </div>
    </div>
  );
}
