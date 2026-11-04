// Sesión del usuario que está usando la pantalla (Martín o Sofi).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function clienteUsuario() {
  const almacen = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => almacen.set(name, value, options));
        } catch {
          // en páginas no se pueden escribir cookies; el proxy las renueva
        }
      },
    },
  });
}

/** Devuelve el usuario conectado o manda a la pantalla de ingreso. */
export async function usuarioActual() {
  const sb = await clienteUsuario();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/ingresar");
  return data.user;
}
