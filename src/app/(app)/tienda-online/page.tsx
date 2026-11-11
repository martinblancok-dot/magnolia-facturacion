import Link from "next/link";
import { guardarCategoriasTienda, sincronizarTiendaAhora } from "../../acciones";
import { BotonAccion, Formulario } from "../../componentes";
import { ListaTienda, type FilaTienda } from "./lista";
import { pesos } from "@/lib/formato";
import { leerCredencialesTN } from "@/lib/tiendanube";
import { CATEGORIAS_TIENDA, stockOnline, sugerirCategoria } from "@/lib/tiendanube-sync";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

export const maxDuration = 60;

type Filtro = { q?: string; cat?: string; estado?: string; ver?: string };

export default async function TiendaOnline({ searchParams }: { searchParams: Promise<Filtro> }) {
  await soloDuenio();
  const f = await searchParams;
  const db = clienteServidor();
  const cred = await leerCredencialesTN(db);

  // Categorías del sistema (para filtros y equivalencias)
  const { data: catsFilas } = await db.from("productos").select("categoria").eq("activo", true).not("categoria", "is", null).limit(20000);
  const conteo = new Map<string, number>();
  for (const r of catsFilas ?? []) conteo.set(String(r.categoria), (conteo.get(String(r.categoria)) ?? 0) + 1);
  const categorias = [...conteo.keys()].sort((a, b) => a.localeCompare(b, "es"));
  const { data: eq, error: eqError } = await db.from("tn_categorias").select("categoria, tn_categoria");
  const equivalencia = new Map((eq ?? []).map((e) => [String(e.categoria), (e.tn_categoria as string | null) ?? ""]));
  const faltaMigracion = !!eqError && /tn_categorias/.test(eqError.message);

  const encabezado = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tienda online</h1>
          <p className="text-sm text-suave">
            {cred ? <>Conectada a <a className="text-marca underline" href="https://magnolia244.mitiendanube.com" target="_blank">la tienda</a>. Precios y stock se actualizan solos cada pocos minutos.</> : <>La tienda no está conectada: <Link className="text-marca underline" href="/configuracion/tienda">conectala acá</Link>.</>}
          </p>
        </div>
        {cred && <BotonAccion accion={sincronizarTiendaAhora} texto="Sincronizar ahora" />}
      </div>
      <nav className="flex gap-4 border-b border-linea text-sm">
        <Link href="/tienda-online" className={`-mb-px border-b-2 px-1 pb-2 ${f.ver !== "categorias" ? "border-marca font-semibold" : "border-transparent text-suave"}`}>Productos</Link>
        <Link href="/tienda-online?ver=categorias" className={`-mb-px border-b-2 px-1 pb-2 ${f.ver === "categorias" ? "border-marca font-semibold" : "border-transparent text-suave"}`}>Categorías</Link>
      </nav>
      {faltaMigracion && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0027_tiendanube.sql</b> en Supabase.</p>}
    </div>
  );

  if (f.ver === "categorias") {
    return (
      <div className="max-w-3xl space-y-5">
        {encabezado}
        <p className="text-sm text-suave">A qué categoría de la tienda va cada categoría del sistema. Puse una sugerencia según el nombre; revisala. Se usa al crear cada producto en la tienda (después lo podés mover allá).</p>
        <Formulario accion={guardarCategoriasTienda} boton="Guardar equivalencias" className="tarjeta">
          <datalist id="cats-tienda">{CATEGORIAS_TIENDA.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="divide-y divide-linea">
            {categorias.map((c) => {
              const guardada = equivalencia.get(c);
              const sugerida = sugerirCategoria(c);
              return (
                <label key={c} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><b>{c}</b> <span className="text-suave">· {conteo.get(c)} productos</span>{guardada === undefined && sugerida ? <span className="ml-1 text-xs text-amber-700">(sugerida)</span> : null}</span>
                  <input name={`cat:${c}`} list="cats-tienda" defaultValue={guardada ?? sugerida ?? ""} placeholder="Sin categoría" className="campo !w-64" />
                </label>
              );
            })}
          </div>
        </Formulario>
      </div>
    );
  }

  // Lista de productos
  let q = db.from("productos")
    .select("id, nombre, sku, categoria, precio_lista, publicar_web, tn_producto_id, tn_stock, tn_precio, tn_publicado, tn_error, tn_sincronizado_en, stock(local_id, cantidad)")
    .eq("activo", true).order("nombre").limit(400);
  if (f.cat) q = q.eq("categoria", f.cat);
  if (f.estado === "online") q = q.eq("publicar_web", true);
  if (f.estado === "no") q = q.eq("publicar_web", false);
  if (f.estado === "error") q = q.not("tn_error", "is", null);
  if (f.q) {
    const l = f.q.replace(/[%,()*"\\]/g, " ").trim();
    if (l) q = q.or(`nombre.ilike.%${l}%,sku.ilike.%${l}%,proveedor.ilike.%${l}%`);
  }
  const { data, error } = await q;
  const filas: FilaTienda[] = (data ?? []).map((p) => {
    const st = (p.stock ?? []) as { local_id: number; cantidad: number }[];
    const local = (id: number) => Number(st.find((s) => s.local_id === id)?.cantidad ?? 0);
    const online = stockOnline(st.map((s) => Number(s.cantidad)));
    const pendiente = p.publicar_web !== !!p.tn_publicado || (p.publicar_web && (Number(p.tn_stock) !== online || Number(p.tn_precio) !== Number(p.precio_lista)));
    return {
      id: p.id, nombre: p.nombre, sku: p.sku, categoria: p.categoria, precio: pesos(Number(p.precio_lista)),
      deco: local(1), beauty: local(2), online, publicar: !!p.publicar_web, enTienda: !!p.tn_producto_id,
      estado: p.tn_error ? `Error: ${p.tn_error}` : pendiente ? "Pendiente de sincronizar" : p.publicar_web ? "Al día" : p.tn_producto_id ? "Oculto" : "",
      error: !!p.tn_error,
    };
  });

  return (
    <div className="space-y-5">
      {encabezado}
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={f.q ?? ""} placeholder="Buscar por nombre, SKU o proveedor" className="campo !w-72" />
        <select name="cat" defaultValue={f.cat ?? ""} className="campo !w-56">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c} ({conteo.get(c)})</option>)}
        </select>
        <select name="estado" defaultValue={f.estado ?? ""} className="campo !w-48">
          <option value="">Todos</option>
          <option value="online">Publicados</option>
          <option value="no">No publicados</option>
          <option value="error">Con error</option>
        </select>
        <button className="boton">Filtrar</button>
      </form>
      {error && !faltaMigracion && <p className="text-sm text-red-700">{error.message}</p>}
      <ListaTienda filas={filas} />
      <p className="text-xs text-suave">Stock online = el local con más unidades, menos 1 (si queda 1, se publica 1). Fotos y descripciones se cargan en Tiendanube; el sistema no las toca.</p>
    </div>
  );
}
