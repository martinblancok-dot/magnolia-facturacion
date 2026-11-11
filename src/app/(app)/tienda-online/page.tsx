import Link from "next/link";
import { guardarCategoriasTienda, marcarPedidoEntregado, revisarPedidosAhora, sincronizarTiendaAhora } from "../../acciones";
import { NOMBRE_ESTADO, type EstadoPedido } from "@/lib/tiendanube-pedidos";
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
        <Link href="/tienda-online" className={`-mb-px border-b-2 px-1 pb-2 ${!f.ver ? "border-marca font-semibold" : "border-transparent text-suave"}`}>Productos</Link>
        <Link href="/tienda-online?ver=pedidos" className={`-mb-px border-b-2 px-1 pb-2 ${f.ver === "pedidos" ? "border-marca font-semibold" : "border-transparent text-suave"}`}>Pedidos</Link>
        <Link href="/tienda-online?ver=categorias" className={`-mb-px border-b-2 px-1 pb-2 ${f.ver === "categorias" ? "border-marca font-semibold" : "border-transparent text-suave"}`}>Categorías</Link>
      </nav>
      {faltaMigracion && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0027_tiendanube.sql</b> en Supabase.</p>}
    </div>
  );

  if (f.ver === "pedidos") {
    const activos = f.estado !== "todos";
    let qp = db.from("pedidos_web")
      .select("id, numero, estado, pago, medio, entrega, entrega_detalle, retira_local, cliente, telefono, email, direccion, nota, total, creado_en, pedidos_web_items(n, nombre, sku, cantidad, local_id, producto_id, preparado_en)")
      .order("creado_en", { ascending: false }).limit(activos ? 100 : 200);
    if (activos) qp = qp.in("estado", ["pendiente_pago", "a_preparar", "preparado"]);
    const { data: pedidos, error: errP } = await qp;
    const faltaTabla = !!errP && /pedidos_web/.test(errP.message);
    const LOCAL: Record<number, string> = { 1: "Home", 2: "Beauty" };
    const color: Record<EstadoPedido, string> = {
      pendiente_pago: "bg-amber-50 text-amber-900", a_preparar: "bg-marca-claro text-marca", preparado: "bg-blue-50 text-blue-900",
      entregado: "bg-green-50 text-green-800", cancelado: "bg-gray-100 text-suave",
    };
    return (
      <div className="max-w-4xl space-y-5">
        {encabezado}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-sm text-suave">Los pedidos entran solos. Cada producto sale del local con más unidades: ahí se descuenta el stock y esa caja ve el aviso para prepararlo cuando el pago está aprobado. Si se cancela, el stock vuelve.</p>
          {cred && <BotonAccion accion={revisarPedidosAhora} texto="Revisar pedidos ahora" borde />}
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/tienda-online?ver=pedidos" className={activos ? "font-semibold text-marca" : "text-suave underline"}>En curso</Link>
          <Link href="/tienda-online?ver=pedidos&estado=todos" className={!activos ? "font-semibold text-marca" : "text-suave underline"}>Todos</Link>
        </nav>
        {faltaTabla && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0028_pedidos_online.sql</b> en Supabase.</p>}
        {errP && !faltaTabla && <p className="text-sm text-red-700">{errP.message}</p>}
        {!errP && !(pedidos ?? []).length && <p className="rounded-2xl border border-linea bg-white px-6 py-10 text-center text-suave">{activos ? "No hay pedidos en curso." : "Todavía no entró ningún pedido."}</p>}
        <div className="space-y-3">
          {(pedidos ?? []).map((p) => {
            const items = ((p.pedidos_web_items ?? []) as { n: number; nombre: string; sku: string | null; cantidad: number; local_id: number | null; producto_id: string | null; preparado_en: string | null }[]).sort((a, b) => a.n - b.n);
            const estado = p.estado as EstadoPedido;
            return (
              <div key={p.id} className="tarjeta space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p><b className="text-base">#{p.numero}</b> · {new Date(p.creado_en).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {p.cliente ?? "Sin nombre"}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color[estado]}`}>{NOMBRE_ESTADO[estado]}</span>
                </div>
                <p className="text-suave">
                  {p.entrega === "retiro" ? `Retira en ${p.retira_local ? `Magnolia ${LOCAL[p.retira_local]}` : p.entrega_detalle ?? "el local"}` : `Envío: ${p.entrega_detalle ?? ""}${p.direccion ? ` · ${p.direccion}` : ""}`}
                  {" · "}{pesos(Number(p.total))}{p.medio ? ` · ${p.medio}` : ""}
                  {p.telefono ? ` · ${p.telefono}` : ""}{p.email ? ` · ${p.email}` : ""}
                </p>
                {p.nota && <p className="rounded-lg bg-amber-50 px-2 py-1">Nota del cliente: {p.nota}</p>}
                <ul className="divide-y divide-linea rounded-xl border border-linea">
                  {items.map((i) => (
                    <li key={i.n} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                      <span>{i.nombre}{i.sku ? <span className="text-xs text-suave"> · {i.sku}</span> : null}{!i.producto_id && <span className="ml-1 text-xs text-amber-700">(no se encontró en el sistema: no descontó stock)</span>}</span>
                      <span className="text-suave">{i.cantidad} u. · sale de <b className="text-tinta">{i.local_id ? LOCAL[i.local_id] : "—"}</b>{i.preparado_en ? " · ✓ preparado" : ""}</span>
                    </li>
                  ))}
                </ul>
                {["a_preparar", "preparado"].includes(estado) && <BotonAccion accion={marcarPedidoEntregado.bind(null, Number(p.id))} texto={p.entrega === "retiro" ? "Marcar como retirado" : "Marcar como despachado"} borde />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

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
