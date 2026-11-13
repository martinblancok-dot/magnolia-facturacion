// Recibe las ventas que la caja tenía guardadas. Si una ya estaba, no se duplica.
import { NextResponse } from "next/server";
import { validarVenta, type VentaParaSubir } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
import { DIAS_CAMBIO, venceCambio } from "@/lib/impresion";
import { saldosCC } from "@/lib/supabase/cuentas";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ventas?: unknown[] } | null;
  const ventas = Array.isArray(body?.ventas) ? body!.ventas.slice(0, 200) : [];
  const db = clienteServidor();
  let duenio: boolean | null = null;
  const recibidas: string[] = [];
  const rechazadas: { id: string; motivo: string }[] = [];
  for (const v of ventas) {
    const id = String((v as { id?: string })?.id ?? "");
    const error = validarVenta(v);
    if (error) { rechazadas.push({ id, motivo: error }); continue; }
    // Descuento manual de un colaborador: tiene que estar autorizado por un dueño (y por ese mismo descuento)
    const x = v as VentaParaSubir;
    // Caja de prueba: solo los dueños (una venta "de prueba" no descuenta stock ni aparece en reportes)
    let deCajaPrueba = x.prueba === true;
    if (!deCajaPrueba && x.turno_id) {
      const { data: t } = await db.from("turnos_caja").select("prueba").eq("id", x.turno_id).maybeSingle();
      deCajaPrueba = !!t?.prueba;
    }
    if (deCajaPrueba) {
      if (duenio === null) duenio = (await perfilDe(u.id)).rol === "duenio";
      if (!duenio) { rechazadas.push({ id, motivo: "la caja de prueba es solo para Martín y Sofi" }); continue; }
    }
    if (x.items.some((i) => i.descuento_manual)) {
      if (duenio === null) duenio = (await perfilDe(u.id)).rol === "duenio";
      if (!duenio) {
        const aut = x.descuento?.autorizacion_id;
        const { data: a } = aut ? await db.from("autorizaciones").select("estado, datos").eq("id", aut).maybeSingle() : { data: null };
        const mismo = a && a.datos?.tipo === x.descuento?.tipo && Number(a.datos?.valor) === Number(x.descuento?.valor);
        const usable = a?.estado === "aprobada" || (a?.estado === "usada" && a.datos?.venta_id === id);
        if (!mismo || !usable) { rechazadas.push({ id, motivo: "el descuento no está autorizado" }); continue; }
        if (a.estado === "aprobada") await db.from("autorizaciones").update({ estado: "usada", datos: { ...a.datos, venta_id: id } }).eq("id", aut!);
      }
    }
    // Cambio de una venta a cuenta corriente: se hace solo contra la cuenta (no se devuelve plata que no se pagó)
    if (x.cambio_de) {
      const { data: orig } = await db.from("ventas").select("*").eq("id", x.cambio_de).maybeSingle();
      const ccOrig = (orig as { cliente_cc_id?: string | null } | null)?.cliente_cc_id ?? null;
      if (ccOrig && (x.medio_pago !== "cuenta" || x.cliente_cc_id !== ccOrig)) { rechazadas.push({ id, motivo: "esa venta fue a cuenta corriente: el cambio lo hace Martín o Sofi contra la cuenta" }); continue; }
      if (!ccOrig && x.medio_pago === "cuenta") { rechazadas.push({ id, motivo: "esa venta no fue a cuenta corriente" }); continue; }
      if (ccOrig && Number(x.total) < 0 && orig && Date.now() > venceCambio(orig.creada_en).getTime()) {
        const { data: ya } = await db.from("ventas").select("id").eq("id", id).maybeSingle();
        if (!ya) { rechazadas.push({ id, motivo: `pasaron más de ${DIAS_CAMBIO} días: lo devuelto ya no se descuenta de la cuenta` }); continue; }
      }
    }
    // Cuenta corriente: solo Martín y Sofi, y no más del doble del límite de la clienta
    if (x.medio_pago === "cuenta") {
      if (duenio === null) duenio = (await perfilDe(u.id)).rol === "duenio";
      if (!duenio) { rechazadas.push({ id, motivo: "solo Martín y Sofi pueden vender a cuenta corriente" }); continue; }
      const { data: ya } = await db.from("ventas").select("id").eq("id", id).maybeSingle();
      if (!ya && Number(x.total) > 0) {
        const { data: cl } = await db.from("clientes_cc").select("limite, activo").eq("id", x.cliente_cc_id!).maybeSingle();
        if (!cl || !cl.activo) { rechazadas.push({ id, motivo: "la clienta de la cuenta corriente no existe" }); continue; }
        const debe = (await saldosCC(db, [x.cliente_cc_id!])).get(x.cliente_cc_id!)?.debe ?? 0;
        if (debe + Number(x.total) > 2 * Number(cl.limite)) { rechazadas.push({ id, motivo: `la cuenta pasaría el máximo de ${2 * Number(cl.limite)}` }); continue; }
      }
    }
    const r = await db.rpc("registrar_venta", { v, usuario: u.id });
    if (r.error) { rechazadas.push({ id, motivo: r.error.message }); continue; }
    if (x.medio_pago === "cuenta") {
      const r3 = await db.from("ventas").update({ cliente_cc_id: x.cliente_cc_id }).eq("id", id);
      if (r3.error) { await db.rpc("anular_venta", { venta: id, usuario: u.id }); rechazadas.push({ id, motivo: r3.error.message }); continue; }
    }
    if (Array.isArray(x.pagos) && x.pagos.length === 2) {
      const r2 = await db.from("ventas").update({ pagos: x.pagos.map((p) => ({ medio: p.medio, monto: Number(p.monto) })) }).eq("id", id);
      if (r2.error) console.error("pago dividido sin guardar (¿falta la migración 0019?)", r2.error.message);
    }
    const para = x.giftcard_nueva?.destinatario?.trim();
    if (para) await db.from("giftcards").update({ destinatario: para.slice(0, 80) }).eq("id", x.giftcard_nueva!.id).is("destinatario", null); // sin la migración 0018 no hace nada
    recibidas.push(id); // nueva o ya registrada: en ambos casos la caja la puede borrar
  }
  return NextResponse.json({ recibidas, rechazadas });
}
