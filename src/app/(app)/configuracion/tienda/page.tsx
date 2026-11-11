import Link from "next/link";
import { headers } from "next/headers";
import { desconectarTiendanube } from "../../../acciones";
import { BotonAccion } from "../../../componentes";
import { configTN, leerCredencialesTN, tn } from "@/lib/tiendanube";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

const MENSAJES: Record<string, [boolean, string]> = {
  ok: [true, "¡Listo! La tienda quedó conectada."],
  "falta-config": [false, "Falta cargar TIENDANUBE_APP_ID y TIENDANUBE_CLIENT_SECRET en Vercel (y volver a publicar)."],
  estado: [false, "La autorización no coincidió. Probá de nuevo desde este botón."],
  "sin-codigo": [false, "Tiendanube no mandó el código de autorización. Probá de nuevo."],
  error: [false, "Tiendanube no aceptó la conexión. Revisá que el número de app y la clave secreta en Vercel sean los de esta app, y probá de nuevo (el código vence en 30 segundos)."],
};

export default async function TiendaOnline({ searchParams }: { searchParams: Promise<{ tn?: string }> }) {
  await soloDuenio();
  const { tn: aviso } = await searchParams;
  const h = await headers();
  const origen = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const cfg = configTN();
  const c = await leerCredencialesTN(clienteServidor());
  let tienda: { nombre: string; url: string } | null = null;
  let errorTN = "";
  if (c) {
    try {
      const s = await tn<{ name: Record<string, string> | string; original_domain?: string; url_with_protocol?: string }>(c, "/store");
      tienda = { nombre: typeof s.name === "string" ? s.name : s.name.es ?? Object.values(s.name)[0] ?? "", url: s.url_with_protocol ?? s.original_domain ?? "" };
    } catch (e) { errorTN = (e as Error).message; }
  }
  const m = aviso ? MENSAJES[aviso] : null;
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href="/configuracion" className="text-sm text-suave">← Configuración</Link>
        <h1 className="text-2xl font-semibold">Tienda online (Tiendanube)</h1>
        <p className="text-sm text-suave">Conecta el sistema con la tienda para mandarle productos, precios y stock, y recibir los pedidos.</p>
      </div>
      {m && <p className={`rounded-lg px-3 py-2 text-sm ${m[0] ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{m[1]}</p>}

      <section className="tarjeta space-y-3">
        <h2 className="font-semibold">Estado</h2>
        {c ? (
          <>
            <p className="text-sm">✅ Conectada a la tienda <b>{tienda?.nombre || `#${c.tienda}`}</b>{tienda?.url ? <> · <a className="text-marca underline" href={tienda.url} target="_blank">{tienda.url}</a></> : null}</p>
            <p className="text-xs text-suave">Permisos: {c.scope || "—"} · conectada el {new Date(c.conectada).toLocaleDateString("es-AR")}</p>
            {errorTN && <p className="text-sm text-red-700">⚠ {errorTN}</p>}
            <a href="/tienda-online" className="boton inline-block">Elegir qué productos publicar →</a>
            <div className="flex flex-wrap gap-3">
              <a href="/api/tiendanube/conectar" className="boton-borde">Volver a conectar</a>
              <BotonAccion accion={desconectarTiendanube} texto="Desconectar" borde />
            </div>
          </>
        ) : cfg.lista ? (
          <>
            <p className="text-sm">La app ya está configurada. Falta autorizarla en tu tienda.</p>
            <a href="/api/tiendanube/conectar" className="boton inline-block">Conectar con Tiendanube</a>
          </>
        ) : (
          <p className="text-sm">Todavía falta crear la app en Tiendanube y cargar sus datos en Vercel (ver abajo).</p>
        )}
      </section>

      <section className="tarjeta space-y-2 text-sm">
        <h2 className="font-semibold">Datos para la app de Tiendanube</h2>
        <p>URL de redirección (copiala tal cual en el portal de socios):</p>
        <code className="block select-all rounded bg-marca-claro px-3 py-2">{origen}/api/tiendanube/callback</code>
        <p className="text-suave">Variables en Vercel: <code>TIENDANUBE_APP_ID</code> {cfg.appId ? "✅" : "❌"} · <code>TIENDANUBE_CLIENT_SECRET</code> {cfg.secreto ? "✅" : "❌"}</p>
      </section>
    </div>
  );
}
