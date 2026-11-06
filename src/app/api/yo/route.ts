// Quién está usando la caja (para saber si puede aplicar descuentos sin pedir autorización).
import { NextResponse } from "next/server";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET() {
  const u = await usuarioDeLaSesion();
  if (!u) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  const p = await perfilDe(u.id);
  return NextResponse.json({ id: u.id, rol: p.rol, nombre: p.nombre });
}
