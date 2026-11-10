// Manda a Tiendanube para autorizar la conexión. Solo Martín y Sofi.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { TN_AUTH, configTN } from "@/lib/tiendanube";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const u = await usuarioDeLaSesion();
  const base = new URL(req.url);
  if (!u || (await perfilDe(u.id)).rol !== "duenio") return NextResponse.redirect(new URL("/caja", base));
  const { appId, lista } = configTN();
  if (!lista) return NextResponse.redirect(new URL("/configuracion/tienda?tn=falta-config", base));
  const estado = randomBytes(16).toString("hex");
  const r = NextResponse.redirect(`${TN_AUTH}/${encodeURIComponent(appId)}/authorize?state=${estado}`);
  r.cookies.set("tn_estado", estado, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return r;
}
