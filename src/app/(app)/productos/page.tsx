import { claveCodigo } from "@/lib/caja";
import Link from "next/link";
import { ImportarCatalogo } from "./importar";
import { Miniatura } from "../../miniatura";
import { rutaCorta } from "@/lib/fotos";
import { adminDesbloqueado } from "@/lib/admin";
import { pesos } from "@/lib/formato";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioActual } from "@/lib/supabase/sesion";

export default async function Productos({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await usuarioActual();
  const db = clienteServidor();
  const admin = await adminDesbloqueado();
  const q = ((await searchParams).q ?? "").trim();
  const { count } = await db.from("productos").select("id", { count: "exact", head: true }).eq("activo", true);
  let consulta = db.from("productos")
    .select("id, barcode, sku, nombre, categoria, precio_lista, precio_efectivo, imagen_url, stock(local_id, cantidad)")
    .eq("activo", true).order("nombre").limit(80);
  if (q) {
    const limpio = q.replace(/[%,()*"\\]/g, " ").trim();
    // También por código original (de fábrica): busca a qué producto pertenece
    const alt = await db.from("producto_codigos").select("producto_id").eq("clave", claveCodigo(limpio)).limit(5);
    const ids = alt.error ? [] : (alt.data ?? []).map((x) => x.producto_id);
    consulta = consulta.or(`nombre.ilike.%${limpio}%,sku.ilike.%${limpio}%,proveedor.ilike.%${limpio}%,categoria.ilike.%${limpio}%,barcode.eq.${limpio}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`);
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
            <Link href="/productos/fotos" className="boton-borde">Fotos</Link>
            <Link href="/promos" className="boton-borde">Promociones</Link>
            <Link href="/productos/nuevo" className="boton">+ Nuevo producto</Link>
          </div>
        )}
      </div>

      {!admin && <p className="text-sm text-suave">Editar, eliminar e importar productos lo pueden hacer solo Martín y Sofi.</p>}

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Buscar por nombre, SKU, código o categoría" className="campo" />
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
                  <span className="flex min-w-0 items-center gap-3">
                    <Miniatura ruta={rutaCorta(p.imagen_url)} tam={48} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.nombre}</span>
                      <span className="text-sm text-suave">{p.sku} · {p.categoria ?? "Sin categoría"}</span>
                    </span>
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
