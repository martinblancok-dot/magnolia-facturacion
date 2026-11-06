// Revisión antes de arrancar: qué está listo y qué falta para usar el sistema en los locales.
import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/almacen";
import { leerEstado } from "@/lib/supabase/planilla";
import { soloDuenio } from "@/lib/supabase/sesion";

type Item = { ok: boolean | "aviso"; titulo: string; detalle: string };

function haceMenosDe(iso: string, dias: number) {
  return Date.now() - Date.parse(iso) < dias * 86400_000;
}

async function medirBase(db: ReturnType<typeof clienteServidor>) {
  const tiempos: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await db.from("locales").select("id").limit(1);
    tiempos.push(performance.now() - t0);
  }
  return Math.round(tiempos.sort((a, b) => a - b)[1]);
}

export default async function Revision() {
  await soloDuenio();
  const db = clienteServidor();
  const MIGRACIONES: [string, string, string][] = [
    ["0008_turnos_caja.sql", "turnos_caja", "id"],
    ["0009_usuarios.sql", "perfiles", "rol"],
    ["0010_pedidos_anulacion.sql", "ventas", "anulacion_pedida_en"],
    ["0011_giftcards.sql", "giftcards", "saldo"],
    ["0012_planilla.sql", "planilla_cambios", "id"],
    ["0013_terminales.sql", "terminales", "id"],
  ];
  const [ms, migr, { data: emisores }, { data: secretos }, planilla, { data: perfiles }, { count: conStock }, { data: ultFactura }] = await Promise.all([
    medirBase(db),
    Promise.all(MIGRACIONES.map(async ([archivo, tabla, col]) => ({ archivo, falta: !!(await db.from(tabla).select(col).limit(1)).error }))),
    db.from("emisores").select("usuario_id, nombre, ambiente, facturar_automatico, punto_venta"),
    db.from("secretos").select("usuario_id, mp_token, certificado_real"),
    leerEstado(db),
    db.from("perfiles").select("rol, activo"),
    db.from("stock").select("producto_id", { count: "exact", head: true }).gt("cantidad", 0),
    db.from("facturas").select("creado_en").eq("ambiente", "produccion").order("creado_en", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const faltan = migr.filter((m) => m.falta).map((m) => m.archivo);
  const items: Item[] = [
    {
      ok: faltan.length === 0,
      titulo: "Base de datos al día",
      detalle: faltan.length ? `Falta correr en Supabase (en este orden): ${faltan.join(", ")}. Después corré también 0014_rendimiento.sql.` : "Todas las migraciones están corridas. Si no lo hiciste, corré 0014_rendimiento.sql (acelera las pantallas).",
    },
    {
      ok: ms < 60 ? true : "aviso",
      titulo: `Velocidad de la base: ${ms} ms por consulta`,
      detalle: ms < 60 ? "Bien: el servidor y la base están cerca." : "Lento: la base de Supabase está lejos del servidor (Vercel está en San Pablo). Mirá en Supabase → Project Settings → General la región y avisale a Claude.",
    },
    ...(emisores ?? []).map((e): Item => {
      const s = secretos?.find((x) => x.usuario_id === e.usuario_id);
      const ok = e.ambiente === "produccion" && !!e.facturar_automatico && !!s?.mp_token && !!s?.certificado_real;
      return {
        ok, titulo: `Facturación de ${e.nombre}`,
        detalle: ok ? `ARCA en modo real, punto de venta ${e.punto_venta}, Mercado Pago conectado y facturación automática prendida.`
          : [e.ambiente !== "produccion" && "ARCA está en modo prueba", !e.facturar_automatico && "la facturación automática está apagada", !s?.mp_token && "falta el token de Mercado Pago", !s?.certificado_real && "falta el certificado real"].filter(Boolean).join(", ") + ".",
      };
    }),
    {
      ok: !!ultFactura && haceMenosDe(ultFactura.creado_en, 3) ? true : "aviso",
      titulo: "Facturas automáticas",
      detalle: ultFactura ? `Última factura real emitida: ${new Date(ultFactura.creado_en).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}.` : "Todavía no se emitió ninguna factura real.",
    },
    {
      ok: !!planilla && !planilla.error ? true : "aviso",
      titulo: "Precios Deco conectada",
      detalle: !planilla ? "Todavía no se sincronizó." : planilla.error ? `Último intento con error: ${planilla.error}` : `Sincronizada. ${planilla.repetidos.length ? `Quedan ${planilla.repetidos.length} códigos de barras repetidos para corregir.` : "Sin códigos repetidos."}`,
    },
    {
      ok: (perfiles ?? []).some((p) => p.rol === "colaborador" && p.activo) ? true : "aviso",
      titulo: "Usuarios de los colaboradores",
      detalle: (perfiles ?? []).some((p) => p.rol === "colaborador") ? `${(perfiles ?? []).filter((p) => p.rol === "colaborador" && p.activo).length} colaboradores activos.` : "Todavía no creaste usuarios para el equipo (Configuración → Usuarios).",
    },
    {
      ok: (conStock ?? 0) > 0 ? true : false,
      titulo: "Stock inicial",
      detalle: (conStock ?? 0) > 0 ? `${conStock} productos con stock cargado.` : "El stock está en 0. Antes de arrancar conviene contar la mercadería con el lector (Stock → Conteo); si no, el stock va a quedar en negativo.",
    },
  ];
  const icono = (ok: Item["ok"]) => (ok === true ? "✓" : ok === "aviso" ? "!" : "✗");
  const color = (ok: Item["ok"]) => (ok === true ? "bg-green-100 text-green-800" : ok === "aviso" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800");

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/configuracion" className="text-sm text-suave underline">← Configuración</Link>
      <div>
        <h1 className="text-2xl font-semibold">Revisión antes de arrancar</h1>
        <p className="text-sm text-suave">Lo que el sistema puede revisar solo. Abajo está lo que hay que hacer en los locales.</p>
      </div>
      <ul className="divide-y divide-linea rounded-2xl border border-linea bg-white">
        {items.map((it) => (
          <li key={it.titulo} className="flex gap-3 px-4 py-3 md:px-6">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${color(it.ok)}`}>{icono(it.ok)}</span>
            <span><b>{it.titulo}</b><span className="block text-sm text-suave">{it.detalle}</span></span>
          </li>
        ))}
      </ul>
      <section className="tarjeta space-y-2 text-sm">
        <h2 className="font-semibold">En cada local, una vez</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Abrir el sistema en cada compu, iniciar sesión y dejar que baje el catálogo (arriba dice “5.935 productos”).</li>
          <li>Instalarlo como app: en Chrome, ícono de instalar en la barra de direcciones (o en iPad: Compartir → Agregar a inicio).</li>
          <li>Probar el lector de códigos en la caja y en Stock.</li>
          <li>Imprimir un recibo X y un ticket de cambio de prueba: elegir la impresora térmica, márgenes “Ninguno”, sin encabezados.</li>
          <li>Prueba sin internet: desconectar el wifi, hacer una venta, reconectar y ver que diga “✓ Al día”.</li>
          <li>Hacer una venta de prueba con débito y transferencia, y un cierre de caja completo para practicar el arqueo.</li>
        </ul>
      </section>
    </div>
  );
}
