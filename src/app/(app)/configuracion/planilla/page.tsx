import Link from "next/link";
import { descartarCambioPlanilla, pedirColoresPlanilla, reintentarCambioPlanilla } from "../../../acciones";
import { BotonAccion } from "../../../componentes";
import { SCRIPT_PLANILLA } from "@/lib/planilla-script";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerEstado } from "@/lib/supabase/planilla";
import { soloDuenio } from "@/lib/supabase/sesion";
import { Copiar, GenerarClave } from "./clientes";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

export default async function PlanillaConfig() {
  await soloDuenio();
  const db = clienteServidor();
  const [estado, { data: token }, { data: pendientes, error: errorTabla }, { data: fallidos }, { data: resp }] = await Promise.all([
    leerEstado(db),
    db.from("ajustes").select("actualizado_en").eq("clave", "token_planilla").maybeSingle(),
    db.from("planilla_cambios").select("id, tipo, barcode, hoja, datos, creado_en").is("aplicado_en", null).is("error", null).order("id"),
    db.from("planilla_cambios").select("id, tipo, barcode, hoja, datos, creado_en, error").not("error", "is", null).is("aplicado_en", null).order("id", { ascending: false }).limit(20),
    db.from("ajustes").select("valor").eq("clave", "respaldo_ultimo").maybeSingle(),
  ]);
  // Lo que hay en el sistema: productos con colores (activos)
  const { data: varDb, error: errVar } = await db.from("producto_variantes").select("color, sku_variante, orden, productos(sku, nombre, hoja)").eq("activo", true).order("orden").limit(3000);
  const conColores = new Map<string, { sku: string; nombre: string; hoja: string | null; colores: string[] }>();
  for (const v of (varDb ?? []) as unknown as { color: string; productos: { sku: string; nombre: string; hoja: string | null } | null }[]) {
    const p = v.productos;
    if (!p) continue;
    const f = conColores.get(p.sku) ?? { sku: p.sku, nombre: p.nombre, hoja: p.hoja, colores: [] };
    f.colores.push(v.color);
    conColores.set(p.sku, f);
  }
  let respaldo: { cuando: string; archivo: string; filas: number; error: string | null } | null = null;
  try { respaldo = resp?.valor ? JSON.parse(resp.valor) : null; } catch {}
  const diasRespaldo = respaldo ? Math.floor((Date.now() - Date.parse(respaldo.cuando)) / 86400_000) : null;
  const describir = (c: { tipo: string; barcode: string | null; hoja: string; datos: Record<string, unknown> }) =>
    c.tipo === "nuevo"
      ? `Nuevo en "${c.hoja}": ${c.datos.nombre} (art. ${c.datos.articulo_prov}, costo $${c.datos.costo})`
      : `Editar ${c.barcode} en "${c.hoja}": ${Object.entries(c.datos).map(([k, v]) => `${k} → ${v}`).join(", ")}`;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/configuracion" className="text-sm text-suave underline">← Configuración</Link>
      <div>
        <h1 className="text-2xl font-semibold">Precios Deco ⇄ sistema</h1>
        <p className="text-sm text-suave">La planilla y el sistema se mantienen iguales solos, cada 10 minutos.</p>
      </div>

      {errorTabla && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Falta correr la migración <b>0012_planilla.sql</b> en Supabase.</p>}

      <section id="respaldo" className="tarjeta space-y-2">
        <h2 className="font-semibold">Copia de seguridad</h2>
        {!respaldo ? <p className="text-sm text-amber-800">Todavía no se hizo ninguna copia.</p>
          : respaldo.error ? <p className="text-sm text-red-700">✗ La última copia falló ({fechaHora(respaldo.cuando)}): {respaldo.error}</p>
          : <p className={`text-sm ${diasRespaldo! > 9 ? "text-amber-800" : "text-green-800"}`}>{diasRespaldo! > 9 ? "⚠️ " : "✓ "}Última copia: {fechaHora(respaldo.cuando)} · {respaldo.archivo} · {respaldo.filas.toLocaleString("es-AR")} filas{diasRespaldo! > 9 ? ` (hace ${diasRespaldo} días: revisá que siga activa)` : ""}</p>}
        <p className="ayuda">La hace el script de Precios Deco todos los domingos a las 4 y la guarda en tu Google Drive, carpeta &quot;Respaldos Magnolia&quot; (quedan las últimas 12). Para activarla: pegá la versión nueva del script (abajo) y en la planilla tocá menú Magnolia → Copia de seguridad: activar todas las semanas. Incluye productos, stock, ventas, cajas, gift cards, cuentas corrientes, pedidos online y facturas; no incluye claves ni certificados.</p>
      </section>

      <section className="tarjeta space-y-2">
        <h2 className="font-semibold">Estado</h2>
        {!estado ? <p className="text-sm text-suave">Todavía no se sincronizó nunca.</p> : (
          <>
            <p className={`text-sm ${estado.error ? "text-red-700" : "text-green-800"}`}>
              {estado.error ? `✗ Última vez con error (${fechaHora(estado.cuando)}): ${estado.error}`
                : `✓ Última sincronización con cambios: ${fechaHora(estado.cuando)} — ${estado.productos} productos en la planilla, ${estado.nuevos} nuevos, ${estado.actualizados} actualizados, ${estado.bajas} dados de baja.`}
            </p>
            <p className="ayuda">Si en la planilla no cambia nada, el script no manda nada (por eso esta fecha puede ser vieja aunque esté funcionando).</p>
            {estado.bajasFrenadas > 0 && <p className="text-sm text-amber-800">Llegaron muy pocos productos y no se dio de baja nada ({estado.bajasFrenadas} quedaron igual). Revisá la planilla.</p>}
            {estado.repetidos.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-amber-800">{estado.repetidos.length} códigos de barras repetidos en la planilla (se usa el primero)</summary>
                <ul className="mt-2 space-y-1">{estado.repetidos.map((r) => <li key={r.barcode + r.descartado}><b>{r.barcode}</b>: queda {r.queda} · se ignora {r.descartado}</li>)}</ul>
              </details>
            )}
            {estado.codigos && (
              <div className="text-sm">
                {estado.codigos.error ? <p className="text-red-700">Códigos originales: {estado.codigos.error}</p> : (
                  <p className="text-suave">Códigos originales (columna &quot;Barcode original&quot;): {estado.codigos.total} cargados
                    {estado.codigos.agregados || estado.codigos.quitados ? ` · en la última: ${estado.codigos.agregados} nuevos, ${estado.codigos.quitados} quitados` : ""}.</p>
                )}
                {estado.codigos.repetidos.length > 0 && (
                  <details open className="mt-1 rounded-lg bg-amber-50 p-2">
                    <summary className="cursor-pointer font-semibold text-amber-900">⚠️ {estado.codigos.repetidos.length} código{estado.codigos.repetidos.length === 1 ? "" : "s"} original{estado.codigos.repetidos.length === 1 ? "" : "es"} repetido{estado.codigos.repetidos.length === 1 ? "" : "s"}: no se cargaron, corregilos en la planilla</summary>
                    <ul className="mt-2 space-y-1">{estado.codigos.repetidos.map((r) => <li key={r.codigo + r.detalle}><b className="font-mono">{r.codigo}</b>: {r.detalle}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
            {estado.colores?.sinProducto?.length ? <p className="text-sm text-amber-800">Con colores en la planilla pero sin producto en el sistema: {estado.colores.sinProducto.join(", ")}</p> : null}
            {estado.colores && (
              estado.colores.error ? <p className="text-sm text-red-700">Colores: {estado.colores.error}</p> : (
                <p className="text-sm text-suave">Colores (columna &quot;Colores&quot;): {estado.colores.productos} productos con colores
                  {estado.colores.nuevos || estado.colores.quitados ? ` · en la última: ${estado.colores.nuevos} colores nuevos, ${estado.colores.quitados} quitados` : ""}.</p>
              )
            )}
          </>
        )}
      </section>

      <section id="colores" className="tarjeta space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Colores</h2>
            <p className="text-sm text-suave">Se leen de la columna <b>Colores</b> (fila 1) de todas las pestañas de proveedores.{estado?.colores?.cuando ? ` Última actualización: ${fechaHora(estado.colores.cuando)}.` : ""}</p>
          </div>
          <BotonAccion accion={pedirColoresPlanilla} texto="Actualizar colores desde la planilla" />
        </div>
        {errVar ? <p className="text-sm text-red-700">Falta correr la migración 0032_variantes_color.sql.</p> : conColores.size === 0 ? (
          <p className="text-sm text-amber-800">Todavía no hay ningún producto con colores en el sistema.</p>
        ) : (
          <details className="text-sm">
            <summary className="cursor-pointer">{conColores.size} productos con colores en el sistema</summary>
            <ul className="mt-2 space-y-0.5">
              {[...conColores.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map((p) => (
                <li key={p.sku}><b>{p.sku}</b> <span className="text-suave">({p.hoja ?? "—"})</span>: {p.colores.join(", ")}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {(pendientes?.length || fallidos?.length) ? (
        <section className="tarjeta space-y-3">
          <h2 className="font-semibold">Cambios del sistema para la planilla</h2>
          {!!pendientes?.length && (
            <div><p className="text-sm text-suave">Esperando la próxima sincronización:</p>
              <ul className="mt-1 list-disc pl-5 text-sm">{pendientes.map((c) => <li key={c.id}>{describir(c)}</li>)}</ul></div>
          )}
          {!!fallidos?.length && (
            <div><p className="text-sm font-semibold text-red-800">No se pudieron escribir:</p>
              <ul className="mt-1 space-y-2 text-sm">{fallidos.filter((c) => c.error !== "descartado").map((c) => (
                <li key={c.id} className="rounded-lg bg-red-50 p-2">
                  {describir(c)}<span className="block text-red-800">{c.error}</span>
                  <span className="mt-1 flex gap-2"><BotonAccion accion={reintentarCambioPlanilla.bind(null, c.id)} texto="Reintentar" borde /><BotonAccion accion={descartarCambioPlanilla.bind(null, c.id)} texto="Descartar" borde /></span>
                </li>
              ))}</ul></div>
          )}
        </section>
      ) : null}

      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Clave de la planilla</h2>
        <p className="text-sm text-suave">{token ? `Hay una clave (creada el ${fechaHora(token.actualizado_en)}).` : "Todavía no hay clave."} La planilla la usa para hablar con el sistema.</p>
        <GenerarClave hay={!!token} />
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Instalar en la planilla (una sola vez)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Abrí <b>Precios Deco</b> en la compu, con la cuenta dueña de la planilla.</li>
          <li>Menú <b>Extensiones → Apps Script</b>. Se abre otra pestaña con un archivo <i>Código.gs</i>.</li>
          <li>Borrá todo lo que tenga, tocá <b>Copiar el código</b> acá abajo y pegalo. Tocá el ícono de guardar (💾).</li>
          <li>Volvé a la planilla y recargala (F5). Arriba aparece un menú nuevo: <b>Magnolia</b>.</li>
          <li>Generá la clave acá arriba y copiala.</li>
          <li>En la planilla: <b>Magnolia → Configurar conexión</b>. La primera vez Google pide permiso: <i>Continuar</i> → elegí tu cuenta → <i>Configuración avanzada</i> → <i>Ir a proyecto (no seguro)</i> → <i>Permitir</i>. Es tu propio script; Google lo marca así porque no está publicado.</li>
          <li>Te pide la dirección (dejala como está) y la clave (pegala). Al terminar sincroniza y te muestra un resumen.</li>
        </ol>
        <div className="flex items-center gap-3"><Copiar texto={SCRIPT_PLANILLA} etiqueta="Copiar el código" /><span className="text-xs text-suave">{SCRIPT_PLANILLA.split("\n").length} líneas</span></div>
        <details><summary className="cursor-pointer text-sm text-suave underline">Ver el código</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-marca-claro p-3 text-xs">{SCRIPT_PLANILLA}</pre></details>
      </section>

      <section className="tarjeta space-y-2 text-sm">
        <h2 className="font-semibold">Cómo funciona</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Planilla → sistema</b> (cada 10 min o con <i>Magnolia → Sincronizar ahora</i>): productos nuevos, precios, nombres y categorías. Lo que se borra de la planilla deja de aparecer en la caja.</li>
          <li><b>Sistema → planilla</b>: si editás nombre, costo o categoría de un producto, o agregás uno nuevo eligiendo su pestaña, se escribe en la planilla. Los precios se cambian solo en la planilla (con el costo se recalculan).</li>
          <li><b>Compras</b>: después de cargar la compra y armar <i>Lista Etiquetas</i>, usá <i>Magnolia → Sumar &quot;Lista Etiquetas&quot; al stock</i> del local donde queda la mercadería. Si la misma lista ya se sumó, te avisa.</li>
        </ul>
      </section>
    </div>
  );
}
