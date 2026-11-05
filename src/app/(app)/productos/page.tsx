import Link from "next/link";
import { bloquearAdmin } from "../../acciones";
import { Desbloquear } from "./desbloquear";
import { ImportarCatalogo } from "./importar";
import { adminDesbloqueado, pinGuardado } from "@/lib/admin";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function Productos({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await usuarioActual();
  const db = clienteServidor();
  const [admin, hayPin] = await Promise.all([adminDesbloqueado(), pinGuardado()]);
  const q = ((await searchParams).q ?? "").trim();
  const { count } = await db.from("productos").select("id", { count: "exact", head: true }).eq("activo", true);
  let consulta = db.from("productos")
    .select("id, barcode, sku, nombre, categoria, proveedor, precio_lista, precio_efectivo, stock(local_id, cantidad)")
    .eq("activo", true).order("nombre").limit(80);
  if (q) {
    const limpio = q.replace(/[%,()*"\\]/g, " ").trim();
    consulta = consulta.or(`nombre.ilike.%${limpio}%,sku.ilike.%${limpio}%,proveedor.ilike.%${limpio}%,categoria.ilike.%${limpio}%,barcode.eq.${limpio}`);
  }
  const { data: productos } = await consulta;
  const stockDe = (p: { stock?: { local_id: number; cantidad: number }[] }, local: number) =>
    Number(p.stock?.find((s) => s.local_id === local)?.cantidad ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Productos</h1>
          <p className="mt-1 text-suave">{count ?? 0} productos en el catálogo.</p>
        </div>
        {admin && (
          <div className="flex items-center gap-3">
            <Link href="/productos/nuevo" className="boton">+ Nuevo producto</Link>
            <form action={bloquearAdmin}><button className="text-sm text-suave underline">Bloquear edición</button></form>
          </div>
        )}
      </div>

      {!admin && (
        <div className="tarjeta">
          {hayPin ? (
            <>
              <p className="mb-3 text-sm text-suave">Para editar, eliminar, ver costos o importar, ingresá la clave de administrador.</p>
              <Desbloquear />
            </>
          ) : (
            <p className="text-sm">
              Para poder editar productos, primero creá una <b>clave de administrador</b> en{" "}
              <Link href="/configuracion#clave" className="underline">Configuración</Link>.
            </p>
          )}
        </div>
      )}

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Buscar por nombre, SKU, código, proveedor o categoría" className="campo" />
        <button className="boton">Buscar</button>
      </form>

      <div className="rounded-2xl border border-linea bg-white">
        {(productos ?? []).length === 0 ? (
          <p className="px-6 py-10 text-center text-suave">{count ? "No encontré productos." : "Todavía no hay productos: importá Precios Deco."}</p>
        ) : (
          <ul className="divide-y divide-linea">
            {(productos ?? []).map((p) => {
              const fila = (
                <>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nombre}</span>
                    <span className="text-sm text-suave">{p.sku} · {p.categoria ?? "Sin categoría"} · {p.proveedor}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-semibold">{pesos(Number(p.precio_lista))} <span className="font-normal text-suave">lista</span></span>
                    <span className="block">{pesos(Number(p.precio_efectivo))} <span className="text-suave">efectivo</span></span>
                    <span className="block text-xs text-suave">Stock Home {stockDe(p, 1)} · Beauty {stockDe(p, 2)}</span>
                  </span>
                </>
              );
              const clase = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 md:px-6";
              return (
                <li key={p.id}>
                  {admin ? <Link href={`/productos/${p.id}`} className={`${clase} hover:bg-marca-claro`}>{fila}</Link> : <div className={clase}>{fila}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {admin && (
        <div className="tarjeta">
          <h2 className="font-semibold">Importar desde Precios Deco</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>Abrí Precios Deco en Google Sheets → <b>Archivo → Descargar → Microsoft Excel (.xlsx)</b>.</li>
            <li>Subí ese archivo acá. Se leen todas las pestañas de proveedores, incluida Jean Cartier.</li>
            <li>Los productos se reconocen por el código de barras: si ya estaban, se actualizan nombre y precios (el stock no se toca).</li>
          </ol>
          <p className="ayuda">Ojo: la planilla manda. Si editaste un producto acá y sigue en Precios Deco, la próxima importación vuelve a poner lo de la planilla (y reactiva los eliminados).</p>
          <ImportarCatalogo />
        </div>
      )}
    </div>
  );
}
