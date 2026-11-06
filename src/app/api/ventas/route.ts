// Recibe las ventas que la caja tenía guardadas. Si una ya estaba, no se duplica.
import { NextResponse } from "next/server";
import { validarVenta, type VentaParaSubir } from "@/lib/caja";
import { clienteServidor } from "@/lib/supabase/almacen";
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
    const r = await db.rpc("registrar_venta", { v, usuario: u.id });
    if (r.error) rechazadas.push({ id, motivo: r.error.message });
    else recibidas.push(id); // nueva o ya registrada: en ambos casos la caja la puede borrar
  }
  return NextResponse.json({ recibidas, rechazadas });
}
