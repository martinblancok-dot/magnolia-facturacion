"use server";
// Todo lo que se hace con un botón: ingresar, guardar la configuración, marcar cobros, facturar.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claveCodigo } from "@/lib/caja";
import { UMBRAL_IDENTIFICACION } from "@/lib/arca/config";
import { claveCorresponde, infoCertificado, normalizarCertificado, normalizarClave } from "@/lib/arca/certificados";
import { pedirTicket } from "@/lib/arca/wsaa";
import { solicitarCAE, ultimoNumero } from "@/lib/arca/wsfe";
import { facturarPendientes } from "@/lib/facturador";
import { traerCobros } from "@/lib/mercadopago";
import { leerMisComprobantes } from "@/lib/mis-comprobantes";
import { leerPreciosDeco, type Conflicto } from "@/lib/catalogo";
import { abrirAdmin, adminDesbloqueado, cerrarAdmin, cifrarPin, pinCorrecto, pinGuardado } from "@/lib/admin";
import { cifrar, descifrar } from "@/lib/secretos";
import { almacenSupabase, clienteServidor, conciliarUsuario, guardarCobros, traerEmisor } from "@/lib/supabase/almacen";
import { numeroWhatsapp } from "@/lib/resumen-cierre";
import { enviarMail, leerConfigAviso } from "@/lib/supabase/aviso-cierre";
import { confirmarTransferenciasConCaja } from "@/lib/supabase/turnos";
import { anularPagoCC, registrarPagoCC, saldosCC } from "@/lib/supabase/cuentas";
import { URL_SISTEMA, borrarCredencialesTN, leerCredencialesTN } from "@/lib/tiendanube";
import { sincronizarTienda } from "@/lib/tiendanube-sync";
import { marcarEntregado, registrarAvisosTN, revisarPedidosTN } from "@/lib/tiendanube-pedidos";
import { clienteUsuario, mailDeUsuario, perfilDe, soloDuenio, usuarioActual } from "@/lib/supabase/sesion";

export interface Mensaje {
  ok: boolean;
  texto: string;
}

const arca = { pedirTicket, ultimoNumero, solicitarCAE };

// ---------- Sesión ----------

export async function ingresar(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const sb = await clienteUsuario();
  const { error } = await sb.auth.signInWithPassword({
    email: mailDeUsuario(String(form.get("email") ?? "")),
    password: String(form.get("clave") ?? ""),
  });
  if (error) return { ok: false, texto: "Usuario o contraseña incorrectos." };
  const { data } = await sb.auth.getUser();
  if (data.user && !(await perfilDe(data.user.id)).activo) {
    await sb.auth.signOut();
    return { ok: false, texto: "Este usuario está dado de baja." };
  }
  redirect("/");
}

export async function salir() {
  const sb = await clienteUsuario();
  await sb.auth.signOut();
  redirect("/ingresar");
}

// ---------- Configuración ----------

async function archivo(form: FormData, nombre: string): Promise<Buffer | null> {
  const f = form.get(nombre);
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > 50_000) throw new Error(`El archivo de "${nombre}" es demasiado grande. ¿Elegiste el correcto?`);
  return Buffer.from(await f.arrayBuffer());
}

function cuitValido(c: string): boolean {
  if (!/^\d{11}$/.test(c)) return false;
  const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = m.reduce((acc, x, i) => acc + x * Number(c[i]), 0);
  let d = 11 - (s % 11);
  if (d === 11) d = 0;
  if (d === 10) d = 9;
  return d === Number(c[10]);
}

export async function guardarConfiguracion(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await soloDuenio();
  const db = clienteServidor();
  try {
    const cuit = String(form.get("cuit") ?? "").replace(/\D/g, "");
    if (!cuitValido(cuit)) return { ok: false, texto: "El CUIT no es válido." };
    const pv = Number(form.get("punto_venta"));
    if (!Number.isInteger(pv) || pv < 1 || pv > 99999) return { ok: false, texto: "El punto de venta tiene que ser un número." };
    const ambiente = form.get("ambiente") === "produccion" ? "produccion" : "homologacion";
    const tope = String(form.get("tope_anual") ?? "").replace(/\./g, "").replace(",", ".");

    // Secretos: solo se reemplazan los que se cargan de nuevo
    const { data: previos } = await db.from("secretos").select("*").eq("usuario_id", u.id).maybeSingle();
    const claveNueva = await archivo(form, "clave");
    const clave = claveNueva ? normalizarClave(claveNueva) : previos?.clave_privada ? descifrar(previos.clave_privada) : null;
    const leerCert = async (campo: string, previo?: string | null) => {
      const b = await archivo(form, campo);
      return b ? normalizarCertificado(b) : previo ? descifrar(previo) : null;
    };
    const certPrueba = await leerCert("certificado_prueba", previos?.certificado_prueba);
    const certReal = await leerCert("certificado_real", previos?.certificado_real);
    const tokenNuevo = String(form.get("mp_token") ?? "").trim();
    const mpToken = tokenNuevo || (previos?.mp_token ? descifrar(previos.mp_token) : null);

    for (const [nombre, cert] of [["de prueba", certPrueba], ["real", certReal]] as const) {
      if (!cert) continue;
      if (clave && !claveCorresponde(clave, cert))
        return { ok: false, texto: `El certificado ${nombre} no corresponde a la clave privada cargada. Revisá que sean los archivos de la misma persona y del mismo pedido.` };
      const info = infoCertificado(cert);
      if (info.cuit && info.cuit !== cuit) return { ok: false, texto: `El certificado ${nombre} es del CUIT ${info.cuit}, no del ${cuit}.` };
    }
    if (ambiente === "produccion" && !certReal) return { ok: false, texto: "Para facturar de verdad primero cargá el certificado real." };
    if (mpToken && !/^APP_USR-/.test(mpToken)) return { ok: false, texto: "La credencial de Mercado Pago tiene que empezar con APP_USR-." };

    // Al pasar de prueba a real: los cobros que solo tienen factura de prueba vuelven
    // a su estado inicial (posnet/QR → por facturar; el resto → revisar).
    const { data: antes } = await db.from("emisores").select("ambiente").eq("usuario_id", u.id).maybeSingle();
    if (antes?.ambiente === "homologacion" && ambiente === "produccion") {
      const { data: dePrueba } = await db.from("facturas").select("cobro_id").eq("usuario_id", u.id).eq("ambiente", "homologacion").not("cobro_id", "is", null);
      const ids = (dePrueba ?? []).map((f) => f.cobro_id as string);
      if (ids.length) {
        await db.from("facturas").update({ cobro_id: null }).in("cobro_id", ids);
        await db.from("cobros").update({ estado: "revisar", mensaje: "Tenía solo factura de prueba" }).in("id", ids);
        await db.from("cobros").update({ estado: "a_facturar", mensaje: null }).in("id", ids)
          .in("origen", ["posnet", "qr"]).lt("importe", UMBRAL_IDENTIFICACION);
      }
    }

    const { error: e1 } = await db.from("emisores").upsert({
      usuario_id: u.id,
      nombre: String(form.get("nombre") ?? "").trim() || (u.email ?? ""),
      cuit,
      punto_venta: pv,
      ambiente,
      facturar_automatico: form.get("facturar_automatico") === "on",
      domicilio: String(form.get("domicilio") ?? "").trim() || null,
      ingresos_brutos: String(form.get("ingresos_brutos") ?? "").trim() || null,
      inicio_actividades: String(form.get("inicio_actividades") ?? "") || null,
      tope_anual: tope ? Number(tope) : null,
    });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db.from("secretos").upsert({
      usuario_id: u.id,
      clave_privada: clave ? cifrar(clave) : null,
      certificado_prueba: certPrueba ? cifrar(certPrueba) : null,
      certificado_real: certReal ? cifrar(certReal) : null,
      mp_token: mpToken ? cifrar(mpToken) : null,
      actualizado_en: new Date().toISOString(),
    });
    if (e2) throw new Error(e2.message);
    revalidatePath("/configuracion");
    return { ok: true, texto: "Configuración guardada." };
  } catch (err) {
    return { ok: false, texto: `No se pudo guardar: ${(err as Error).message}` };
  }
}

export async function probarARCA(): Promise<Mensaje> {
  const u = await soloDuenio();
  const db = clienteServidor();
  const e = await traerEmisor(db, u.id);
  if (!e) return { ok: false, texto: "Falta cargar la clave, el certificado o el punto de venta." };
  try {
    const t = await pedirTicket(e.ambiente, e.certificadoPem, e.clavePem);
    await almacenSupabase(db).guardarTicket(u.id, e.ambiente, t);
    const n = await ultimoNumero({ ambiente: e.ambiente, cuit: e.cuit, token: t.token, sign: t.sign }, e.puntoVenta);
    const donde = e.ambiente === "produccion" ? "producción" : "prueba";
    return { ok: true, texto: `Conexión con ARCA (${donde}) correcta. Punto de venta ${e.puntoVenta}: última factura C número ${n}.` };
  } catch (err) {
    const m = (err as Error).message;
    if (m.includes("TA valido")) return { ok: true, texto: "ARCA ya tiene una sesión abierta de hace un rato: la conexión funciona." };
    return { ok: false, texto: `ARCA respondió: ${m}` };
  }
}

// ---------- Cobros ----------

export async function marcarCobro(id: string, nuevo: "a_facturar" | "no_es_venta" | "revisar" | "ya_facturado") {
  const u = await soloDuenio();
  const db = clienteServidor();
  const { data: c } = await db.from("cobros").select("estado, usuario_id").eq("id", id).maybeSingle();
  if (!c || c.usuario_id !== u.id) return;
  const permitido: Record<string, string[]> = {
    a_facturar: ["revisar", "error", "no_es_venta", "ya_facturado"],
    no_es_venta: ["revisar", "error", "a_facturar"],
    revisar: ["a_facturar", "no_es_venta", "ya_facturado"],
    ya_facturado: [],
  };
  if (!permitido[nuevo].includes(c.estado)) return;
  // Si sale de "ya facturado" es porque no era esa factura: se suelta y no se vuelve a cruzar.
  const extra = c.estado === "ya_facturado" ? { comprobante_id: null, no_conciliar: true } : {};
  await db.from("cobros").update({ estado: nuevo, mensaje: null, ...extra }).eq("id", id);
  revalidatePath("/cobros");
}

/** Marca varios cobros juntos (selección masiva en Cobros). Devuelve cuántos cambió. */
export async function marcarCobros(ids: string[], nuevo: "a_facturar" | "no_es_venta" | "revisar"): Promise<{ ok: boolean; cambiados: number; texto?: string }> {
  const u = await soloDuenio();
  const lista = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
  if (!lista.length) return { ok: true, cambiados: 0 };
  const permitido: Record<string, string[]> = {
    a_facturar: ["revisar", "error", "no_es_venta", "ya_facturado"],
    no_es_venta: ["revisar", "error", "a_facturar"],
    revisar: ["a_facturar", "no_es_venta", "ya_facturado"],
  };
  const db = clienteServidor();
  let cambiados = 0;
  for (let i = 0; i < lista.length; i += 200) {
    const lote = lista.slice(i, i + 200);
    const normales = permitido[nuevo].filter((e) => e !== "ya_facturado");
    const a = await db.from("cobros").update({ estado: nuevo, mensaje: null }).eq("usuario_id", u.id).in("id", lote).in("estado", normales).select("id");
    if (a.error) return { ok: false, cambiados, texto: a.error.message };
    cambiados += a.data?.length ?? 0;
    if (permitido[nuevo].includes("ya_facturado")) {
      // Si sale de "ya facturado" es porque no era esa factura: se suelta y no se vuelve a cruzar.
      const b = await db.from("cobros").update({ estado: nuevo, mensaje: null, comprobante_id: null, no_conciliar: true }).eq("usuario_id", u.id).in("id", lote).eq("estado", "ya_facturado").select("id");
      if (b.error) return { ok: false, cambiados, texto: b.error.message };
      cambiados += b.data?.length ?? 0;
    }
  }
  revalidatePath("/cobros");
  return { ok: true, cambiados };
}

export async function traerCobrosDesde(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await soloDuenio();
  const db = clienteServidor();
  const e = await traerEmisor(db, u.id);
  if (!e?.mpToken) return { ok: false, texto: "Primero cargá la credencial de Mercado Pago en Configuración." };
  const desde = String(form.get("desde") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { ok: false, texto: "Elegí una fecha." };
  try {
    const cobros = await traerCobros(e.mpToken, `${desde}T00:00:00.000-03:00`, new Date().toISOString());
    const nuevos = await guardarCobros(db, u.id, cobros);
    const yaFacturados = await conciliarUsuario(db, u.id, e.puntoVenta);
    revalidatePath("/cobros");
    return {
      ok: true,
      texto: `Se revisaron ${cobros.length} cobros; ${nuevos} eran nuevos.` +
        (yaFacturados ? ` ${yaFacturados} ya tenían factura hecha a mano (pestaña "Ya facturados").` : ""),
    };
  } catch (err) {
    return { ok: false, texto: (err as Error).message };
  }
}

export async function facturarAhora(): Promise<Mensaje> {
  const u = await soloDuenio();
  const db = clienteServidor();
  const e = await traerEmisor(db, u.id);
  if (!e) return { ok: false, texto: "Falta terminar la configuración." };
  try {
    await conciliarUsuario(db, u.id, e.puntoVenta);
    const r = await facturarPendientes(e, almacenSupabase(db), arca);
    revalidatePath("/cobros");
    revalidatePath("/facturas");
    if (r.emitidas === 0 && r.errores.length === 0) return { ok: true, texto: "No había cobros para facturar." };
    return {
      ok: r.errores.length === 0,
      texto: `Facturas emitidas: ${r.emitidas}.` +
        (r.quedan ? ` Quedan ${r.quedan}: tocá de nuevo "Facturar ahora".` : "") +
        (r.errores.length ? ` Con problemas: ${r.errores.length} (mirá la pestaña Errores).` : ""),
    };
  } catch (err) {
    return { ok: false, texto: (err as Error).message };
  }
}

// ---------- Monotributo ----------

export async function importarMisComprobantes(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await soloDuenio();
  const db = clienteServidor();
  const archivos = form.getAll("archivo").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (archivos.length === 0) return { ok: false, texto: "Elegí el archivo que bajaste de Mis Comprobantes." };
  let total = 0, ignoradas = 0;
  try {
    for (const f of archivos) {
      if (f.size > 4_000_000) return { ok: false, texto: `"${f.name}" es demasiado grande. Bajalo en períodos más cortos.` };
      const r = await leerMisComprobantes(Buffer.from(await f.arrayBuffer()), f.name);
      ignoradas += r.ignoradas;
      for (let i = 0; i < r.comprobantes.length; i += 500) {
        const filas = r.comprobantes.slice(i, i + 500).map((c) => ({
          usuario_id: u.id, tipo: c.tipo, tipo_texto: c.tipoTexto, punto_venta: c.puntoVenta,
          numero_desde: c.desde, numero_hasta: c.hasta, fecha: c.fecha, importe: c.importe, cae: c.cae,
        }));
        const { error } = await db.from("comprobantes_arca").upsert(filas, { onConflict: "usuario_id,tipo,punto_venta,numero_desde" });
        if (error) throw new Error(error.message);
      }
      total += r.comprobantes.length;
    }
    const { data: em } = await db.from("emisores").select("punto_venta").eq("usuario_id", u.id).maybeSingle();
    const yaFacturados = await conciliarUsuario(db, u.id, em?.punto_venta ?? null);
    revalidatePath("/monotributo");
    revalidatePath("/cobros");
    return { ok: true, texto: `Se cargaron ${total} comprobantes.` + (yaFacturados ? ` ${yaFacturados} cobros pendientes ya tenían esa factura y se apartaron.` : "") + (ignoradas ? ` (${ignoradas} filas sin datos se saltearon)` : "") + " Si subís el mismo período otra vez no se duplica." };
  } catch (err) {
    return { ok: false, texto: (err as Error).message };
  }
}

// ---------- Catálogo ----------

export interface ResultadoImportacion extends Mensaje {
  conflictos?: Conflicto[];
}

export async function importarCatalogo(_prev: ResultadoImportacion | null, form: FormData): Promise<ResultadoImportacion> {
  await usuarioActual();
  if (!(await adminDesbloqueado())) return { ok: false, texto: "Importar productos lo pueden hacer solo Martín y Sofi." };
  const db = clienteServidor();
  const f = form.get("archivo");
  if (!f || typeof f === "string" || f.size === 0) return { ok: false, texto: "Elegí el Excel de Precios Deco." };
  if (f.size > 4_000_000) return { ok: false, texto: "El archivo es demasiado grande." };
  try {
    const r = await leerPreciosDeco(Buffer.from(await f.arrayBuffer()));
    if (r.productos.length === 0) return { ok: false, texto: "No encontré pestañas de proveedores con Barcode y Precio sugerido. ¿Es el Excel de Precios Deco?" };

    const ahora = new Date().toISOString();
    for (let i = 0; i < r.productos.length; i += 500) {
      const filas = r.productos.slice(i, i + 500).map((p) => ({
        barcode: p.barcode, sku: p.sku, nombre: p.nombre, categoria: p.categoria, proveedor: p.proveedor,
        costo: p.costo, precio_lista: p.precio_lista, precio_efectivo: p.precio_efectivo, activo: true, actualizado_en: ahora,
      }));
      const { error } = await db.from("productos").upsert(filas, { onConflict: "barcode" });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/productos");
    return {
      ok: true,
      texto: `Catálogo actualizado: ${r.productos.length} productos de ${r.hojas.length} pestañas.` +
        (r.conflictos.length ? ` Hay ${r.conflictos.length} códigos de barras repetidos para corregir en la planilla (abajo).` : ""),
      conflictos: r.conflictos,
    };
  } catch (err) {
    return { ok: false, texto: (err as Error).message };
  }
}

// ---------- Ventas ----------

export async function anularVenta(id: string): Promise<Mensaje> {
  const u = await soloDuenio(); // solo Martín y Sofi; los colaboradores piden la anulación
  const { data: v } = await clienteServidor().from("ventas").select("terminal").eq("id", id).maybeSingle();
  if (v?.terminal?.startsWith("Aronium")) return { ok: false, texto: "Las ventas importadas de Aronium son solo historial: no se anulan." };
  const { data, error } = await clienteServidor().rpc("anular_venta", { venta: id, usuario: u.id });
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/", "layout");
  return data ? { ok: true, texto: "Venta anulada y stock devuelto." } : { ok: false, texto: "Ya estaba anulada." };
}

export async function pedirAnulacion(id: string, _prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await usuarioActual();
  const motivo = String(form.get("motivo") ?? "").trim();
  if (motivo.length < 3) return { ok: false, texto: "Contá brevemente por qué hay que anularla." };
  const { data, error } = await clienteServidor().from("ventas")
    .update({ anulacion_pedida_por: u.id, anulacion_pedida_en: new Date().toISOString(), anulacion_motivo: motivo.slice(0, 300), anulacion_rechazada_por: null, anulacion_rechazada_en: null })
    .eq("id", id).eq("anulada", false).select("id");
  if (error) return { ok: false, texto: /anulacion_/.test(error.message) ? "Falta correr la migración 0010_pedidos_anulacion.sql en Supabase." : error.message };
  if (!data?.length) return { ok: false, texto: "Esa venta ya está anulada." };
  revalidatePath("/", "layout");
  return { ok: true, texto: "Pedido enviado. Avisale a Martín o a Sofi para que lo confirmen desde su usuario." };
}

export async function rechazarAnulacion(id: string): Promise<Mensaje> {
  const u = await soloDuenio();
  const { error } = await clienteServidor().from("ventas")
    .update({ anulacion_pedida_por: null, anulacion_pedida_en: null, anulacion_rechazada_por: u.id, anulacion_rechazada_en: new Date().toISOString() })
    .eq("id", id).eq("anulada", false);
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/", "layout");
  return { ok: true, texto: "Pedido rechazado: la venta sigue vigente." };
}

// ---------- Clave de administrador ----------

export async function definirPin(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const actual = String(form.get("actual") ?? "");
  const nuevo = String(form.get("nuevo") ?? "");
  const repetir = String(form.get("repetir") ?? "");
  const guardado = await pinGuardado();
  if (guardado && !pinCorrecto(actual, guardado)) return { ok: false, texto: "La clave actual no es correcta." };
  if (!/^\S{4,}$/.test(nuevo)) return { ok: false, texto: "La clave nueva tiene que tener al menos 4 caracteres, sin espacios." };
  if (nuevo !== repetir) return { ok: false, texto: "Las dos claves nuevas no coinciden." };
  const { error } = await clienteServidor().from("ajustes").upsert({ clave: "pin_admin", valor: cifrarPin(nuevo), actualizado_en: new Date().toISOString() });
  if (error) return { ok: false, texto: error.message };
  await abrirAdmin();
  revalidatePath("/configuracion");
  return { ok: true, texto: guardado ? "Clave cambiada." : "Clave creada. Guardala bien: sin ella no se pueden editar productos." };
}

export async function desbloquearAdmin(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await usuarioActual();
  const guardado = await pinGuardado();
  if (!guardado) return { ok: false, texto: "Todavía no hay clave: creala en Configuración → Clave de administrador." };
  // pequeña demora para que no se pueda probar claves a lo loco
  await new Promise((r) => setTimeout(r, 400));
  if (!pinCorrecto(String(form.get("pin") ?? ""), guardado)) return { ok: false, texto: "Clave incorrecta." };
  await abrirAdmin();
  revalidatePath("/productos", "layout");
  return { ok: true, texto: "Desbloqueado por 30 minutos." };
}

export async function bloquearAdmin() {
  await cerrarAdmin();
  revalidatePath("/productos", "layout");
}

// ---------- Editar productos ----------

export async function guardarProducto(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await usuarioActual();
  if (!(await adminDesbloqueado())) return { ok: false, texto: "Editar productos lo pueden hacer solo Martín y Sofi." };
  const id = String(form.get("id") ?? "");
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };
  const texto = (k: string) => String(form.get(k) ?? "").trim().replace(/\s+/g, " ");
  const db = clienteServidor();
  const hojaNueva = texto("hoja");

  // ---- Producto nuevo que va a la planilla: lo escribe el script y vuelve con sus precios
  if (!id && hojaNueva) {
    const articulo = texto("articulo_prov");
    const costo = num("costo");
    if (!articulo || !texto("nombre")) return { ok: false, texto: "Poné el artículo del proveedor y el nombre." };
    if (!(Number(costo) > 0)) return { ok: false, texto: "Poné el costo (precio unitario): con eso la planilla calcula los precios." };
    const { error } = await db.from("planilla_cambios").insert({
      tipo: "nuevo", hoja: hojaNueva, creado_por: u.id,
      datos: { articulo_prov: articulo, nombre: texto("nombre"), costo, categoria: texto("categoria") || null },
    });
    if (error) return { ok: false, texto: /planilla_cambios/.test(error.message) ? "Falta correr la migración 0012_planilla.sql en Supabase." : error.message };
    return { ok: true, texto: `Listo: se agrega a la pestaña "${hojaNueva}" de Precios Deco en la próxima sincronización (hasta 10 minutos) y aparece en la caja con sus precios y código de barras.` };
  }

  // ---- Producto que viene de la planilla: acá solo se cambia nombre, costo y categoría (los precios son de la planilla)
  if (id) {
    const { data: actual } = await db.from("productos").select("barcode, hoja, nombre, costo, categoria").eq("id", id).maybeSingle();
    if (actual?.hoja) {
      const nuevos = { nombre: texto("nombre"), costo: num("costo"), categoria: texto("categoria") || null };
      if (!nuevos.nombre) return { ok: false, texto: "El nombre es obligatorio." };
      if (Number.isNaN(nuevos.costo)) return { ok: false, texto: "Revisá el costo." };
      const cambios: Record<string, unknown> = {};
      if (nuevos.nombre !== actual.nombre) cambios.nombre = nuevos.nombre;
      if (nuevos.costo !== null && Number(nuevos.costo) !== Number(actual.costo)) cambios.costo = nuevos.costo;
      if ((nuevos.categoria ?? null) !== (actual.categoria ?? null)) cambios.categoria = nuevos.categoria;
      if (!Object.keys(cambios).length) return { ok: true, texto: "No había cambios." };
      const r = await db.from("productos").update({ ...cambios, actualizado_en: new Date().toISOString() }).eq("id", id);
      if (r.error) return { ok: false, texto: r.error.message };
      await db.from("planilla_cambios").insert({ tipo: "editar", barcode: actual.barcode, hoja: actual.hoja, datos: cambios, creado_por: u.id });
      revalidatePath("/productos", "layout");
      return {
        ok: true,
        texto: "Guardado. Se escribe en Precios Deco en la próxima sincronización (hasta 10 minutos)" +
          ("costo" in cambios ? "; ahí la planilla recalcula los precios y vuelven solos al sistema." : "."),
      };
    }
  }

  // ---- Producto cargado solo en el sistema (no está en la planilla)
  const datos = {
    nombre: texto("nombre"),
    sku: texto("sku"),
    barcode: texto("barcode"),
    categoria: texto("categoria") || null,
    proveedor: texto("proveedor") || null,
    precio_lista: num("precio_lista"),
    precio_efectivo: num("precio_efectivo"),
    costo: num("costo"),
    actualizado_en: new Date().toISOString(),
  };
  if (!datos.nombre || !datos.sku || !datos.barcode) return { ok: false, texto: "Nombre, SKU y código de barras son obligatorios." };
  if (!(Number(datos.precio_lista) > 0)) return { ok: false, texto: "El precio de lista tiene que ser mayor a 0." };
  if (datos.precio_efectivo === null) datos.precio_efectivo = Math.round((Number(datos.precio_lista) * 0.85) / 50) * 50;
  if (!(Number(datos.precio_efectivo) >= 0) || Number.isNaN(datos.costo)) return { ok: false, texto: "Revisá los precios." };
  const { data: otro } = await db.from("productos").select("id, nombre").eq("barcode", datos.barcode).maybeSingle();
  if (otro && otro.id !== id) return { ok: false, texto: `Ese código de barras ya lo usa "${otro.nombre}".` };
  const alt = await productoDeCodigoAlternativo(db, datos.barcode);
  if (alt && alt.id !== id) return { ok: false, texto: `Ese código de barras ya es un código original de "${alt.nombre}".` };
  const r = id ? await db.from("productos").update(datos).eq("id", id) : await db.from("productos").insert({ ...datos, activo: true });
  if (r.error) return { ok: false, texto: r.error.message };
  revalidatePath("/productos", "layout");
  if (!id) redirect(`/productos?q=${encodeURIComponent(datos.sku)}`);
  return { ok: true, texto: "Producto guardado. La caja lo toma en la próxima actualización (al abrirla o cada 10 minutos)." };
}

export async function eliminarProducto(id: string): Promise<Mensaje> {
  await usuarioActual();
  if (!(await adminDesbloqueado())) return { ok: false, texto: "Editar productos lo pueden hacer solo Martín y Sofi." };
  // No se borra del todo (tiene ventas asociadas): se oculta de la caja y de las listas
  // baja "sistema": aunque siga en la planilla, la sincronización no lo vuelve a activar
  let r = await clienteServidor().from("productos").update({ activo: false, baja: "sistema", actualizado_en: new Date().toISOString() }).eq("id", id);
  if (r.error && /baja/.test(r.error.message)) r = await clienteServidor().from("productos").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", id);
  const error = r.error;
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/productos", "layout");
  redirect("/productos");
}

// ---------- Usuarios (solo dueños) ----------

const NOMBRE_USUARIO = /^[a-z0-9._-]{3,30}$/;

export async function crearColaborador(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const nombre = String(form.get("nombre") ?? "").trim();
  const usuario = String(form.get("usuario") ?? "").trim().toLowerCase();
  const clave = String(form.get("clave") ?? "");
  if (!nombre) return { ok: false, texto: "Poné el nombre de la persona." };
  if (!usuario.includes("@") && !NOMBRE_USUARIO.test(usuario))
    return { ok: false, texto: "El usuario tiene que tener entre 3 y 30 letras o números, sin espacios (por ejemplo: juli)." };
  if (clave.length < 6) return { ok: false, texto: "La contraseña tiene que tener al menos 6 caracteres." };
  const db = clienteServidor();
  const { data, error } = await db.auth.admin.createUser({ email: mailDeUsuario(usuario), password: clave, email_confirm: true, user_metadata: { nombre } });
  if (error || !data.user) {
    return { ok: false, texto: /already|registered|exists/i.test(error?.message ?? "") ? "Ya existe un usuario con ese nombre." : `No se pudo crear: ${error?.message}` };
  }
  const { error: e2 } = await db.from("perfiles").insert({ usuario_id: data.user.id, nombre, rol: "colaborador" });
  if (e2) {
    await db.auth.admin.deleteUser(data.user.id);
    return { ok: false, texto: `No se pudo crear: ${e2.message}. ¿Corriste la migración 0009_usuarios.sql en Supabase?` };
  }
  revalidatePath("/usuarios");
  return { ok: true, texto: `Listo. ${nombre} entra con el usuario "${usuario}" y la contraseña que pusiste.` };
}

export async function cambiarClaveUsuario(id: string, _prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const clave = String(form.get("clave") ?? "");
  if (clave.length < 6) return { ok: false, texto: "La contraseña tiene que tener al menos 6 caracteres." };
  const { error } = await clienteServidor().auth.admin.updateUserById(id, { password: clave });
  return error ? { ok: false, texto: error.message } : { ok: true, texto: "Contraseña cambiada." };
}

export async function activarUsuario(id: string, activo: boolean): Promise<Mensaje> {
  const yo = await soloDuenio();
  if (id === yo.id) return { ok: false, texto: "No te podés dar de baja a vos mismo." };
  const db = clienteServidor();
  const { data: p } = await db.from("perfiles").select("rol").eq("usuario_id", id).maybeSingle();
  if (p?.rol === "duenio") return { ok: false, texto: "A los dueños no se los puede dar de baja desde acá." };
  // Bloquea el ingreso y corta la sesión que tenga abierta (al renovarse, ya no puede entrar)
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : "876000h" });
  if (error) return { ok: false, texto: error.message };
  await db.from("perfiles").update({ activo }).eq("usuario_id", id);
  revalidatePath("/usuarios");
  return { ok: true, texto: activo ? "Usuario activado de nuevo." : "Usuario dado de baja. Ya no puede entrar." };
}

// ---------- Precios Deco (Google Sheets) ----------

export async function generarTokenPlanilla(): Promise<{ ok: boolean; token?: string; texto?: string }> {
  await soloDuenio();
  const { randomBytes } = await import("node:crypto");
  const { hashToken } = await import("@/lib/planilla");
  const token = "mg_" + randomBytes(24).toString("base64url");
  const { error } = await clienteServidor().from("ajustes").upsert({ clave: "token_planilla", valor: hashToken(token), actualizado_en: new Date().toISOString() });
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/configuracion/planilla");
  return { ok: true, token };
}

export async function reintentarCambioPlanilla(id: number): Promise<Mensaje> {
  await soloDuenio();
  const { error } = await clienteServidor().from("planilla_cambios").update({ error: null }).eq("id", id);
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/configuracion/planilla");
  return { ok: true, texto: "Se vuelve a intentar en la próxima sincronización." };
}

export async function descartarCambioPlanilla(id: number): Promise<Mensaje> {
  await soloDuenio();
  const { error } = await clienteServidor().from("planilla_cambios").update({ aplicado_en: new Date().toISOString(), error: "descartado" }).eq("id", id);
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/configuracion/planilla");
  return { ok: true, texto: "Descartado." };
}

// ---------- Borrar datos de prueba (solo dueños) ----------

export async function borrarPruebas(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  if (String(form.get("confirmar") ?? "").trim().toUpperCase() !== "BORRAR") return { ok: false, texto: "Para confirmar, escribí BORRAR." };
  const dia = String(form.get("dia") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { ok: false, texto: "Elegí hasta qué día borrar." };
  const ventas = form.get("ventas") === "on", stock = form.get("stock") === "on";
  if (!ventas && !stock) return { ok: false, texto: "Marcá qué querés borrar." };
  const sig = new Date(`${dia}T12:00:00Z`);
  sig.setUTCDate(sig.getUTCDate() + 1);
  const hasta = `${sig.toISOString().slice(0, 10)}T00:00:00-03:00`;
  const { data, error } = await clienteServidor().rpc("borrar_pruebas", { hasta, incluir_ventas: ventas, incluir_stock: stock });
  if (error) return { ok: false, texto: /borrar_pruebas/.test(error.message) ? "Falta correr la migración 0015_borrar_pruebas.sql en Supabase." : error.message };
  const r = (data ?? {}) as Record<string, number>;
  revalidatePath("/", "layout");
  const partes = [
    ventas && `${r.ventas ?? 0} ventas, ${r.cajas ?? 0} cajas y ${r.giftcards ?? 0} gift cards`,
    stock && `el stock quedó en 0 (${r.movimientos_stock ?? 0} movimientos borrados)`,
  ].filter(Boolean);
  return { ok: true, texto: `Listo: se borraron ${partes.join("; ")}.` };
}

// ---------- Autorizaciones de descuentos (solo dueños) ----------

export async function resolverAutorizacion(id: string, aprobar: boolean): Promise<Mensaje> {
  const u = await soloDuenio();
  const { data, error } = await clienteServidor().from("autorizaciones")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelta_por: u.id, resuelta_en: new Date().toISOString() })
    .eq("id", id).eq("estado", "pendiente").select("id");
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/", "layout");
  if (!data?.length) return { ok: false, texto: "Ese pedido ya estaba resuelto." };
  return { ok: true, texto: aprobar ? "Aprobado: en la caja se aplica solo." : "Rechazado." };
}

// ---------- Promociones (solo dueños) ----------

export async function crearPromo(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const txt = (k: string) => String(form.get(k) ?? "").trim();
  const tipo = txt("tipo"), alcance = txt("alcance") || "todo";
  const pct = Number(txt("pct").replace(",", ".")) || 0, n = Number(txt("n")) || 2, m = Number(txt("m")) || 1;
  if (!txt("nombre")) return { ok: false, texto: "Poné un nombre (por ejemplo: 2da unidad al 50%)." };
  if (!["segunda", "nxm", "porcentaje"].includes(tipo)) return { ok: false, texto: "Elegí el tipo de promo." };
  if (tipo !== "nxm" && !(pct > 0 && pct <= 100)) return { ok: false, texto: "El porcentaje tiene que estar entre 1 y 100." };
  if (tipo === "nxm" && !(n > m && m >= 1)) return { ok: false, texto: "En NxM, lo que se lleva tiene que ser más que lo que paga (por ejemplo 3x2)." };
  const valores = txt("valores").split(",").map((v) => v.trim()).filter(Boolean);
  if (alcance !== "todo" && !valores.length) return { ok: false, texto: "Escribí a qué categorías, proveedores o SKU se aplica." };
  const { error } = await clienteServidor().from("promos").insert({
    nombre: txt("nombre"), tipo, pct, n, m, alcance, valores: alcance === "todo" ? [] : valores,
    mismo_producto: form.get("mismo_producto") === "on", desde: txt("desde") || null, hasta: txt("hasta") || null,
  });
  if (error) return { ok: false, texto: /promos/.test(error.message) ? "Falta correr la migración 0016_cambios_promos.sql en Supabase." : error.message };
  revalidatePath("/promos");
  return { ok: true, texto: "Promo creada. Las cajas la toman en la próxima actualización (al abrir o cada 10 minutos)." };
}

export async function cambiarPromo(id: string, accion: "activar" | "pausar" | "eliminar"): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const { error } = accion === "eliminar" ? await db.from("promos").delete().eq("id", id) : await db.from("promos").update({ activa: accion === "activar" }).eq("id", id);
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/promos");
  return { ok: true, texto: accion === "eliminar" ? "Promo eliminada." : accion === "activar" ? "Promo activada." : "Promo pausada." };
}

// ---------- Resumen del cierre (WhatsApp y mail) ----------

export async function guardarAvisoCierre(cfg: { whatsapp: { nombre: string; numero: string }[]; mails: string[]; mailAuto: boolean; remitente: string }): Promise<Mensaje> {
  await soloDuenio();
  const whatsapp = (cfg.whatsapp ?? []).filter((w) => w.numero.trim()).slice(0, 6).map((w) => ({ nombre: String(w.nombre ?? "").slice(0, 40), numero: String(w.numero).slice(0, 30) }));
  const malo = whatsapp.find((w) => !numeroWhatsapp(w.numero));
  if (malo) return { ok: false, texto: `El número "${malo.numero}" no parece un celular argentino (código de área + número, ej. 2625 15 123456).` };
  const mails = (cfg.mails ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean).slice(0, 6);
  const mailMalo = mails.find((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
  if (mailMalo) return { ok: false, texto: `"${mailMalo}" no es un mail válido.` };
  const remitente = String(cfg.remitente ?? "").trim().slice(0, 120);
  const valor = JSON.stringify({ whatsapp, mails, mailAuto: !!cfg.mailAuto && mails.length > 0, remitente });
  const { error } = await clienteServidor().from("ajustes").upsert({ clave: "aviso_cierre", valor, actualizado_en: new Date().toISOString() });
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/configuracion/resumen");
  return { ok: true, texto: "Guardado." };
}

export async function guardarClaveResend(clave: string): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const c = clave.trim();
  const { error } = c
    ? await db.from("ajustes").upsert({ clave: "resend_key", valor: cifrar(c), actualizado_en: new Date().toISOString() })
    : await db.from("ajustes").delete().eq("clave", "resend_key");
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/configuracion/resumen");
  return { ok: true, texto: c ? "Clave guardada (cifrada)." : "Clave borrada." };
}

export async function probarMailCierre(): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const cfg = await leerConfigAviso(db);
  if (!cfg.mails.length) return { ok: false, texto: "Primero guardá al menos un mail." };
  const err = await enviarMail(db, cfg.mails, "Prueba · resumen del cierre Magnolia", "*Prueba del sistema Magnolia*\nSi te llegó este mail, el resumen del cierre de caja va a llegar acá.");
  return err ? { ok: false, texto: err } : { ok: true, texto: `Mail de prueba enviado a ${cfg.mails.join(", ")}.` };
}

// ---------- Gift cards ----------

export async function cambiarDestinatarioGc(id: string, destinatario: string): Promise<Mensaje> {
  await usuarioActual();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, texto: "Gift card inválida." };
  const valor = destinatario.trim().slice(0, 80) || null;
  const { error } = await clienteServidor().from("giftcards").update({ destinatario: valor }).eq("id", id);
  if (error) return { ok: false, texto: /destinatario/.test(error.message) ? "Falta correr la migración 0018_giftcard_destinatario.sql en Supabase." : error.message };
  revalidatePath(`/giftcards/${id}`);
  revalidatePath("/giftcards");
  return { ok: true, texto: valor ? "Guardado." : "Nombre borrado." };
}

/** Cruza ya las transferencias "para revisar" con las ventas de la caja de los últimos días. */
export async function cruzarTransferenciasConCaja(): Promise<Mensaje> {
  await soloDuenio();
  const n = await confirmarTransferenciasConCaja(clienteServidor(), new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
  revalidatePath("/cobros");
  return { ok: true, texto: n ? `${n} transferencia${n === 1 ? "" : "s"} coincidieron con ventas de la caja y pasaron a “Por facturar”.` : "Ninguna transferencia para revisar coincide con una venta de la caja." };
}

// ---------- Códigos de barras alternativos ----------

async function productoDeCodigoAlternativo(db: ReturnType<typeof clienteServidor>, codigo: string) {
  const { data, error } = await db.from("producto_codigos").select("producto_id, productos(id, nombre)").eq("clave", claveCodigo(codigo)).maybeSingle();
  if (error || !data) return null;
  const p = (Array.isArray(data.productos) ? data.productos[0] : data.productos) as { id: string; nombre: string } | null;
  return p;
}

/** Agrega un código de barras más a un producto (ej. el que trae de fábrica). Solo Martín y Sofi. */
export async function agregarCodigo(productoId: string, codigo: string): Promise<Mensaje> {
  await soloDuenio();
  const c = codigo.trim().replace(/\s+/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(productoId)) return { ok: false, texto: "Producto inválido." };
  if (c.length < 4 || c.length > 60) return { ok: false, texto: "Escaneá o escribí el código completo." };
  const db = clienteServidor();
  const { data: p } = await db.from("productos").select("id, barcode").eq("id", productoId).maybeSingle();
  if (!p) return { ok: false, texto: "No encontré el producto." };
  if (claveCodigo(p.barcode) === claveCodigo(c)) return { ok: false, texto: "Ese ya es el código interno de este producto." };
  const alt = await productoDeCodigoAlternativo(db, c);
  if (alt) return { ok: false, texto: alt.id === productoId ? "Este producto ya tiene ese código." : `Ese código ya es de "${alt.nombre}". No se cambió nada.` };
  const { error } = await db.from("producto_codigos").insert({ codigo: c, producto_id: productoId, tipo: "original", origen: "sistema" });
  if (error) return { ok: false, texto: /producto_codigos/.test(error.message) && /exist/.test(error.message) ? "Falta correr la migración 0020_codigos_alternativos.sql en Supabase." : error.message };
  await db.from("productos").update({ actualizado_en: new Date().toISOString() }).eq("id", productoId); // que la caja lo baje
  revalidatePath(`/productos/${productoId}`);
  return { ok: true, texto: "Código agregado. La caja lo toma en la próxima actualización." };
}

export async function quitarCodigo(productoId: string, codigo: string): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const { error } = await db.from("producto_codigos").delete().eq("codigo", codigo).eq("producto_id", productoId).eq("origen", "sistema");
  if (error) return { ok: false, texto: error.message };
  await db.from("productos").update({ actualizado_en: new Date().toISOString() }).eq("id", productoId);
  revalidatePath(`/productos/${productoId}`);
  return { ok: true, texto: "Código quitado." };
}

// ---------- Costos por medio de pago (para la ganancia de Reportes) ----------

export async function guardarCargos(cargos: Record<string, string>): Promise<Mensaje> {
  await soloDuenio();
  const valor: Record<string, number> = {};
  for (const [m, v] of Object.entries(cargos)) {
    if (!/^[a-z]+$/.test(m)) continue;
    const n = Number(String(v).replace(",", ".").replace("%", "").trim() || 0);
    if (isNaN(n) || n < 0 || n >= 100) return { ok: false, texto: `El porcentaje de ${m} no es válido.` };
    if (n > 0) valor[m] = Math.round(n * 100) / 100;
  }
  const { error } = await clienteServidor().from("ajustes").upsert({ clave: "cargos_medios", valor: JSON.stringify(valor), actualizado_en: new Date().toISOString() });
  if (error) return { ok: false, texto: error.message };
  revalidatePath("/reportes");
  revalidatePath("/configuracion/cargos");
  return { ok: true, texto: "Guardado. Reportes ya calcula la ganancia con estos porcentajes." };
}

// ---------- Cuentas corrientes (solo Martín y Sofi) ----------

export async function guardarClienteCC(id: string | null, _antes: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const nombre = String(form.get("nombre") ?? "").trim().slice(0, 80);
  if (nombre.length < 2) return { ok: false, texto: "Poné el nombre de la clienta." };
  const limite = Number(String(form.get("limite") ?? "100000").replace(/\./g, "").replace(",", "."));
  if (!(limite > 0)) return { ok: false, texto: "El límite tiene que ser mayor a 0." };
  const datos = {
    nombre, limite,
    telefono: String(form.get("telefono") ?? "").trim().slice(0, 30) || null,
    dni: String(form.get("dni") ?? "").trim().slice(0, 15) || null,
    notas: String(form.get("notas") ?? "").trim().slice(0, 300) || null,
  };
  const db = clienteServidor();
  const r = id ? await db.from("clientes_cc").update(datos).eq("id", id).select("id").single() : await db.from("clientes_cc").insert(datos).select("id").single();
  if (r.error) return { ok: false, texto: /clientes_cc/.test(r.error.message) ? "Falta correr la migración 0026_cuentas_corrientes.sql en Supabase." : r.error.message };
  revalidatePath("/cuentas");
  if (!id) redirect(`/cuentas/${r.data.id}`);
  revalidatePath(`/cuentas/${id}`);
  return { ok: true, texto: "Guardado." };
}

export async function activarClienteCC(id: string, activo: boolean): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  if (!activo) {
    const debe = (await saldosCC(db, [id])).get(id)?.debe ?? 0;
    if (Math.abs(debe) > 0.5) return { ok: false, texto: "No se puede dar de baja: la cuenta tiene saldo." };
  }
  await db.from("clientes_cc").update({ activo }).eq("id", id);
  revalidatePath("/cuentas"); revalidatePath(`/cuentas/${id}`);
  return { ok: true, texto: activo ? "Cuenta activada." : "Cuenta dada de baja." };
}

export async function pagoClienteCC(clienteId: string, _antes: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await soloDuenio();
  try {
    const r = await registrarPagoCC(clienteServidor(), {
      cliente_id: clienteId, monto: Number(String(form.get("monto") ?? "").replace(/\./g, "").replace(",", ".")),
      medio: String(form.get("medio") ?? ""), turno_id: String(form.get("turno_id") ?? "") || null, nota: String(form.get("nota") ?? "") || null, usuario_id: u.id,
    });
    revalidatePath("/cuentas"); revalidatePath(`/cuentas/${clienteId}`);
    return { ok: true, texto: `Pago registrado${r.entroACaja ? " (sumado a la caja)" : ""}. Ahora debe ${r.saldo.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}.` };
  } catch (e) { return { ok: false, texto: (e as Error).message }; }
}

export async function anularPagoClienteCC(clienteId: string, pagoId: string): Promise<Mensaje> {
  await soloDuenio();
  try { await anularPagoCC(clienteServidor(), pagoId); } catch (e) { return { ok: false, texto: (e as Error).message }; }
  revalidatePath("/cuentas"); revalidatePath(`/cuentas/${clienteId}`);
  return { ok: true, texto: "Pago anulado." };
}

// ---------- Tienda online (Tiendanube) ----------

export async function desconectarTiendanube(): Promise<Mensaje> {
  await soloDuenio();
  await borrarCredencialesTN(clienteServidor());
  revalidatePath("/configuracion/tienda");
  return { ok: true, texto: "Tienda desconectada." };
}

/** Marca o desmarca productos para la tienda online. Se mandan en la próxima sincronización. */
export async function publicarEnTienda(ids: string[], publicar: boolean): Promise<Mensaje> {
  await soloDuenio();
  const validos = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 2000);
  if (!validos.length) return { ok: false, texto: "Elegí al menos un producto." };
  const db = clienteServidor();
  for (let i = 0; i < validos.length; i += 200) {
    const { error } = await db.from("productos").update({ publicar_web: publicar }).in("id", validos.slice(i, i + 200));
    if (error) return { ok: false, texto: /publicar_web|tn_/.test(error.message) ? "Falta correr la migración 0027_tiendanube.sql en Supabase." : error.message };
  }
  revalidatePath("/tienda-online");
  return { ok: true, texto: `${validos.length} producto${validos.length === 1 ? "" : "s"} ${publicar ? "marcado(s) para publicar" : "marcado(s) para ocultar"}. Tocá "Sincronizar ahora" o esperá unos minutos.` };
}

export async function sincronizarTiendaAhora(): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const cred = await leerCredencialesTN(db);
  if (!cred) return { ok: false, texto: "La tienda no está conectada (Configuración → Tienda online)." };
  try {
    const r = await sincronizarTienda(db, cred, { hastaMs: 50_000 });
    revalidatePath("/tienda-online");
    const partes = [r.creados && `${r.creados} creados`, r.actualizados && `${r.actualizados} actualizados`, r.ocultos && `${r.ocultos} ocultos`].filter(Boolean);
    return {
      ok: r.errores === 0,
      texto: `${partes.length ? partes.join(", ") : "No había cambios"}.${r.pendientes ? ` Quedan ${r.pendientes} para la próxima vuelta (se siguen solos).` : ""}${r.errores ? ` ${r.errores} con error: ${r.detalleErrores.join(" · ")}` : ""}`,
    };
  } catch (e) { return { ok: false, texto: (e as Error).message }; }
}

export async function guardarCategoriasTienda(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  await soloDuenio();
  const filas: { categoria: string; tn_categoria: string | null; actualizado_en: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("cat:")) continue;
    filas.push({ categoria: k.slice(4), tn_categoria: String(v).trim() || null, actualizado_en: new Date().toISOString() });
  }
  if (!filas.length) return { ok: false, texto: "No hay categorías para guardar." };
  const { error } = await clienteServidor().from("tn_categorias").upsert(filas);
  if (error) return { ok: false, texto: /tn_categorias/.test(error.message) ? "Falta correr la migración 0027_tiendanube.sql en Supabase." : error.message };
  revalidatePath("/tienda-online");
  return { ok: true, texto: "Equivalencias guardadas. Se usan al crear cada producto en la tienda." };
}

/** Trae ya los pedidos de la tienda online (además de los avisos automáticos) y asegura que Tiendanube avise. */
export async function revisarPedidosAhora(): Promise<Mensaje> {
  await soloDuenio();
  const db = clienteServidor();
  const cred = await leerCredencialesTN(db);
  if (!cred) return { ok: false, texto: "La tienda no está conectada (Configuración → Tienda online)." };
  try {
    const base = URL_SISTEMA;
    await registrarAvisosTN(cred, base);
    await db.from("ajustes").upsert({ clave: "tn_avisos", valor: base, actualizado_en: new Date().toISOString() });
    const r = await revisarPedidosTN(db, cred, 40_000);
    revalidatePath("/tienda-online");
    const partes = [r.nuevos && `${r.nuevos} nuevos`, r.actualizados && `${r.actualizados} actualizados`, r.cancelados && `${r.cancelados} cancelados`].filter(Boolean);
    return { ok: !r.errores.length, texto: `${partes.length ? partes.join(", ") : "No había pedidos nuevos"}.${r.errores.length ? ` Con error: ${r.errores.slice(0, 3).join(" · ")}` : ""}` };
  } catch (e) { return { ok: false, texto: (e as Error).message }; }
}

export async function marcarPedidoEntregado(id: number): Promise<Mensaje> {
  const u = await soloDuenio();
  try {
    const ok = await marcarEntregado(clienteServidor(), id, u.id);
    revalidatePath("/tienda-online");
    return ok ? { ok: true, texto: "Pedido marcado como entregado." } : { ok: false, texto: "Ese pedido ya estaba entregado o cancelado." };
  } catch (e) { return { ok: false, texto: (e as Error).message }; }
}

/** Borra todo lo de las cajas de prueba cerradas (ventas, gift cards, pagos de cuentas, retiros). */
export async function borrarCajasPrueba(): Promise<Mensaje> {
  await soloDuenio();
  const { data, error } = await clienteServidor().rpc("borrar_cajas_prueba");
  if (error) return { ok: false, texto: /borrar_cajas_prueba/.test(error.message) ? "Falta correr la migración 0030_caja_prueba.sql en Supabase." : error.message };
  revalidatePath("/configuracion/caja-prueba");
  const r = data as { cajas: number; ventas: number; giftcards: number };
  return { ok: true, texto: r.cajas || r.ventas ? `Listo: se borraron ${r.cajas} caja(s), ${r.ventas} venta(s) y ${r.giftcards} gift card(s) de prueba.` : "No había nada de prueba para borrar (las cajas abiertas no se borran)." };
}

// ---------- Colores desde la planilla ----------

/** Botón "Actualizar colores desde la planilla": la planilla lo ve en menos de un minuto y manda la columna Colores. */
export async function pedirColoresPlanilla(): Promise<Mensaje> {
  await soloDuenio();
  const { error } = await clienteServidor().from("ajustes").upsert({ clave: "planilla_pedido_colores", valor: new Date().toISOString(), actualizado_en: new Date().toISOString() });
  if (error) return { ok: false, texto: error.message };
  return { ok: true, texto: "Pedido enviado: la planilla actualiza los colores en menos de un minuto. Refrescá esta página para ver el resultado. (Si no pasa nada, en la planilla usá Magnolia → Actualizar colores ahora: la primera vez activa este botón.)" };
}
