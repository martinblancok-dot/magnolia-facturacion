// Vuelta desde Tiendanube: canjea el código por el permiso de la tienda y lo guarda cifrado.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canjearCodigoTN, guardarCredencialesTN } from "@/lib/tiendanube";
import { clienteServidor } from "@/lib/supabase/almacen";
import { perfilDe, usuarioDeLaSesion } from "@/lib/supabase/sesion";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const volver = (tn: string) => {
    const r = NextResponse.redirect(new URL(`/configuracion/tienda?tn=${tn}`, url));
    r.cookies.delete("tn_estado");
    return r;
  };
  const u = await usuarioDeLaSesion();
  if (!u || (await perfilDe(u.id)).rol !== "duenio") return NextResponse.redirect(new URL("/ingresar", url));
  const codigo = url.searchParams.get("code");
  const estado = url.searchParams.get("state");
  const esperado = (await cookies()).get("tn_estado")?.value;
  // Si se instaló desde el panel de Tiendanube no hay "state": se acepta igual porque quien vuelve es un dueño con sesión.
  if (estado && esperado && estado !== esperado) return volver("estado");
  if (!codigo) return volver("sin-codigo");
  try {
    const c = await canjearCodigoTN(codigo);
    await guardarCredencialesTN(clienteServidor(), { ...c, conectada: new Date().toISOString() });
    return volver("ok");
  } catch (e) {
    console.error("Tiendanube:", (e as Error).message);
    return volver("error");
  }
}
