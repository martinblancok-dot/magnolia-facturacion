import { guardarConfiguracion, probarARCA } from "../../acciones";
import { BotonAccion, Formulario } from "../../componentes";
import { infoCertificado } from "@/lib/arca/certificados";
import { fechaCorta } from "@/lib/formato";
import { descifrar } from "@/lib/secretos";
import { clienteServidor } from "@/lib/supabase/almacen";
import { soloDuenio } from "@/lib/supabase/sesion";

function estadoCert(cifrado: string | null | undefined): string {
  if (!cifrado) return "No cargado";
  try {
    const i = infoCertificado(descifrar(cifrado));
    return `Cargado (${i.alias}, vence ${fechaCorta(i.vence.toISOString().slice(0, 10))})`;
  } catch {
    return "Cargado";
  }
}

export default async function Configuracion() {
  const u = await soloDuenio();
  const db = clienteServidor();
  const [{ data: e }, { data: s }] = await Promise.all([
    db.from("emisores").select("*").eq("usuario_id", u.id).maybeSingle(),
    db.from("secretos").select("*").eq("usuario_id", u.id).maybeSingle(),
  ]);

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h1 className="text-2xl font-semibold">Configuración</h1><span className="flex flex-wrap gap-x-4 gap-y-1"><a href="/configuracion/revision" className="text-sm font-semibold text-marca underline">Revisión antes de arrancar →</a><a href="/configuracion/caja-prueba" className="text-sm font-semibold text-marca underline">Caja de prueba →</a><a href="/configuracion/borrar-pruebas" className="text-sm text-marca underline">Borrar datos de prueba →</a><a href="/configuracion/planilla" className="text-sm text-marca underline">Precios Deco ⇄ sistema →</a><a href="/usuarios" className="text-sm text-marca underline">Usuarios y colaboradores →</a><a href="/configuracion/resumen" className="text-sm text-marca underline">Resumen del cierre por WhatsApp y mail →</a><a href="/configuracion/aronium" className="text-sm text-marca underline">Ventas anteriores (importar de Aronium) →</a><a href="/configuracion/cargos" className="text-sm text-marca underline">Costos por medio de pago (para la ganancia) →</a><a href="/configuracion/tienda" className="text-sm font-semibold text-marca underline">Tienda online (Tiendanube) →</a></span></div>
      <p className="mt-1 text-suave">Tus datos para facturar. Cada uno carga los suyos con su usuario.</p>

      <Formulario accion={guardarConfiguracion} boton="Guardar" className="mt-6 space-y-6">
        <section className="tarjeta space-y-4">
          <h2 className="font-semibold">Tus datos</h2>
          <div>
            <label className="etiqueta" htmlFor="nombre">Nombre y apellido</label>
            <input id="nombre" name="nombre" className="campo" defaultValue={e?.nombre ?? ""} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="cuit">CUIT</label>
              <input id="cuit" name="cuit" className="campo" inputMode="numeric" defaultValue={e?.cuit ?? ""} required />
            </div>
            <div>
              <label className="etiqueta" htmlFor="punto_venta">Punto de venta (Web Services)</label>
              <input id="punto_venta" name="punto_venta" type="number" min={1} className="campo" defaultValue={e?.punto_venta ?? ""} required />
            </div>
          </div>
          <div>
            <label className="etiqueta" htmlFor="domicilio">Domicilio comercial</label>
            <input id="domicilio" name="domicilio" className="campo" defaultValue={e?.domicilio ?? ""} placeholder="San Martín 1031, General Alvear" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="ingresos_brutos">Ingresos Brutos</label>
              <input id="ingresos_brutos" name="ingresos_brutos" className="campo" defaultValue={e?.ingresos_brutos ?? ""} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="inicio_actividades">Inicio de actividades</label>
              <input id="inicio_actividades" name="inicio_actividades" type="date" className="campo" defaultValue={e?.inicio_actividades ?? ""} />
            </div>
          </div>
          <p className="ayuda">El domicilio, Ingresos Brutos e inicio de actividades salen impresos en la factura. Están en tu constancia de inscripción.</p>
          <div>
            <label className="etiqueta" htmlFor="tope_anual">Tope anual de tu categoría de monotributo (opcional)</label>
            <input id="tope_anual" name="tope_anual" className="campo" inputMode="decimal" defaultValue={e?.tope_anual ?? ""} placeholder="Ej: 26000000" />
            <p className="ayuda">Sirve para avisarte cuánto te queda antes de pasarte de categoría.</p>
          </div>
        </section>

        <section className="tarjeta space-y-4">
          <h2 className="font-semibold">Archivos de ARCA</h2>
          <p className="ayuda !mt-0">Están en Documentos/ARCA. Si ya los cargaste, dejá vacío para no cambiarlos.</p>
          {[
            ["clave", "Clave privada (.key)", s?.clave_privada ? "Cargada" : "No cargada", ".key,.pem,.txt"],
            ["certificado_prueba", "Certificado de prueba (magnolia-prueba.crt)", estadoCert(s?.certificado_prueba), ".crt,.pem,.cer,.txt"],
            ["certificado_real", "Certificado real (magnolia-real.crt)", estadoCert(s?.certificado_real), ".crt,.pem,.cer,.txt"],
          ].map(([id, texto, estado, acepta]) => (
            <div key={id}>
              <label className="etiqueta" htmlFor={id}>{texto}</label>
              <input id={id} name={id} type="file" accept={acepta} className="block text-sm" />
              <p className="ayuda">{estado}</p>
            </div>
          ))}
        </section>

        <section className="tarjeta space-y-3">
          <h2 className="font-semibold">Mercado Pago</h2>
          <label className="etiqueta" htmlFor="mp_token">Credencial (Access Token de producción)</label>
          <input id="mp_token" name="mp_token" type="password" className="campo" placeholder={s?.mp_token ? "Ya cargada — dejá vacío para no cambiarla" : "APP_USR-…"} autoComplete="off" />
        </section>

        <section className="tarjeta space-y-4">
          <h2 className="font-semibold">Cómo factura</h2>
          <fieldset className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="ambiente" value="homologacion" defaultChecked={(e?.ambiente ?? "homologacion") === "homologacion"} />
              Prueba (las facturas no valen)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="ambiente" value="produccion" defaultChecked={e?.ambiente === "produccion"} />
              Real (facturas válidas en ARCA)
            </label>
          </fieldset>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="facturar_automatico" defaultChecked={!!e?.facturar_automatico} className="mt-1" />
            <span>
              Facturar automáticamente las ventas de posnet y QR
              <span className="ayuda block">Las transferencias siempre esperan a que las marques como venta.</span>
            </span>
          </label>
        </section>
      </Formulario>

      <section className="tarjeta mt-6">
        <h2 className="font-semibold">Probar conexión con ARCA</h2>
        <p className="ayuda">Guardá primero. Esto no emite ninguna factura: solo verifica que ARCA te reconozca.</p>
        <div className="mt-3"><BotonAccion accion={probarARCA} texto="Probar conexión" borde /></div>
      </section>
    </div>
  );
}
