// La caja avisa que está viva (en qué caja está y cuántas ventas tiene sin subir)
// y se entera si su caja la cerraron desde otra compu.
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function POST(req: Request) {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { terminal?: string; local_id?: number; turno_id?: string | null; pendientes?: number } | null;
  const terminal = String(b?.terminal ?? "").slice(0, 60);
  const turno = /^[0-9a-f-]{36}$/i.test(String(b?.turno_id)) ? String(b!.turno_id) : null;
  if (!terminal) return NextResponse.json({ error: "falta la compu" }, { status: 400 });
  const db = clienteServidor();
  await db.from("terminales").upsert({
    id: terminal, local_id: [1, 2].includes(Number(b?.local_id)) ? Number(b?.local_id) : null, turno_id: turno,
    usuario_id: u.id, pendientes: Math.max(0, Math.round(Number(b?.pendientes) || 0)), visto_en: new Date().toISOString(),
  });
  let estado: "abierto" | "cerrado" | "desconocido" = "desconocido";
  if (turno) {
    const { data } = await db.from("turnos_caja").select("cerrada_en").eq("id", turno).maybeSingle();
    if (data) estado = data.cerrada_en ? "cerrado" : "abierto";
  }
  return NextResponse.json({ turno: estado });
}
