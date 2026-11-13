// Antes de cada página: renueva la sesión y, si no hay nadie conectado, manda a /ingresar.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        respuesta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options));
      },
    },
  });
  // getClaims verifica la sesión sin ir a Supabase (y la renueva si venció)
  const { data } = await sb.auth.getClaims();
  const conectado = !!data?.claims?.sub;
  if (!conectado && request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  }
  if (!conectado && !request.nextUrl.pathname.startsWith("/ingresar")) {
    return NextResponse.redirect(new URL("/ingresar", request.url));
  }
  return respuesta;
}

export const config = {
  // Todo menos la tarea automática y los archivos estáticos (tienda-img: fotos públicas para la tienda online)
  matcher: ["/((?!api/procesar|api/planilla|api/respaldo|api/tiendanube/webhooks|_next/static|_next/image|manifest.webmanifest|sw.js|icon|apple-icon|icono-|tienda-img/).*)"],
};
