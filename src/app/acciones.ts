"use server";
// Todo lo que se hace con un botón: ingresar, guardar la configuración, marcar cobros, facturar.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UMBRAL_IDENTIFICACION } from "@/lib/arca/config";
import { claveCorresponde, infoCertificado, normalizarCertificado, normalizarClave } from "@/lib/arca/certificados";
import { pedirTicket } from "@/lib/arca/wsaa";
import { solicitarCAE, ultimoNumero } from "@/lib/arca/wsfe";
import { facturarPendientes } from "@/lib/facturador";
import { traerCobros } from "@/lib/mercadopago";
import { cifrar, descifrar } from "@/lib/secretos";
import { almacenSupabase, clienteServidor, guardarCobros, traerEmisor } from "@/lib/supabase/almacen";
import { clienteUsuario, usuarioActual } from "@/lib/supabase/sesion";

export interface Mensaje {
  ok: boolean;
  texto: string;
}

const arca = { pedirTicket, ultimoNumero, solicitarCAE };

// ---------- Sesión ----------

export async function ingresar(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const sb = await clienteUsuario();
  const { error } = await sb.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("clave") ?? ""),
  });
  if (error) return { ok: false, texto: "Mail o contraseña incorrectos." };
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
  const u = await usuarioActual();
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
  const u = await usuarioActual();
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

export async function marcarCobro(id: string, nuevo: "a_facturar" | "no_es_venta" | "revisar") {
  const u = await usuarioActual();
  const db = clienteServidor();
  const { data: c } = await db.from("cobros").select("estado, usuario_id").eq("id", id).maybeSingle();
  if (!c || c.usuario_id !== u.id) return;
  const permitido: Record<string, string[]> = {
    a_facturar: ["revisar", "error", "no_es_venta"],
    no_es_venta: ["revisar", "error", "a_facturar"],
    revisar: ["a_facturar", "no_es_venta"],
  };
  if (!permitido[nuevo].includes(c.estado)) return;
  await db.from("cobros").update({ estado: nuevo, mensaje: null }).eq("id", id);
  revalidatePath("/");
}

export async function traerCobrosDesde(_prev: Mensaje | null, form: FormData): Promise<Mensaje> {
  const u = await usuarioActual();
  const db = clienteServidor();
  const e = await traerEmisor(db, u.id);
  if (!e?.mpToken) return { ok: false, texto: "Primero cargá la credencial de Mercado Pago en Configuración." };
  const desde = String(form.get("desde") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { ok: false, texto: "Elegí una fecha." };
  try {
    const cobros = await traerCobros(e.mpToken, `${desde}T00:00:00.000-03:00`, new Date().toISOString());
    const nuevos = await guardarCobros(db, u.id, cobros);
    revalidatePath("/");
    return { ok: true, texto: `Se revisaron ${cobros.length} cobros; ${nuevos} eran nuevos.` };
  } catch (err) {
    return { ok: false, texto: (err as Error).message };
  }
}

export async function facturarAhora(): Promise<Mensaje> {
  const u = await usuarioActual();
  const db = clienteServidor();
  const e = await traerEmisor(db, u.id);
  if (!e) return { ok: false, texto: "Falta terminar la configuración." };
  try {
    const r = await facturarPendientes(e, almacenSupabase(db), arca);
    revalidatePath("/");
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
