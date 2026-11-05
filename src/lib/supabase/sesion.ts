// Sesión del usuario que está usando la pantalla y sus permisos.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clienteServidor } from "./almacen";

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

export interface Usuario { id: string; email: string | null }

/**
 * Usuario conectado (o null). Verifica la firma de la sesión sin ir a Supabase cuando se puede
 * (getClaims) y se calcula una sola vez por pedido, aunque lo pidan el menú y la página.
 */
export const usuarioDeLaSesion = cache(async (): Promise<Usuario | null> => {
  const sb = await clienteUsuario();
  const { data } = await sb.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return { id: c.sub, email: (c.email as string | undefined) ?? null };
});

/** Devuelve el usuario conectado o manda a la pantalla de ingreso. */
export async function usuarioActual(): Promise<Usuario> {
  const u = await usuarioDeLaSesion();
  if (!u) redirect("/ingresar");
  return u;
}

// ---------- Permisos ----------
// Dueños (Martín y Sofi): todo. Colaboradores: caja, ventas, productos y stock.

export type Rol = "duenio" | "colaborador";

/** Dominio que se agrega a los usuarios sin mail (por ejemplo "juli" → juli@equipo.casamagnolia.com.ar). */
export const DOMINIO_EQUIPO = "equipo.casamagnolia.com.ar";
export const mailDeUsuario = (texto: string) => {
  const t = texto.trim().toLowerCase();
  return t.includes("@") ? t : `${t}@${DOMINIO_EQUIPO}`;
};

export const perfilDe = cache(async (id: string): Promise<{ rol: Rol; nombre: string; activo: boolean }> => {
  const { data, error } = await clienteServidor().from("perfiles").select("rol, nombre, activo").eq("usuario_id", id).maybeSingle();
  // Si todavía no se corrió la migración de usuarios, todos siguen siendo dueños como hasta ahora.
  if (error && /perfiles/.test(error.message)) return { rol: "duenio", nombre: "", activo: true };
  if (!data) return { rol: "colaborador", nombre: "", activo: true };
  return { rol: data.rol as Rol, nombre: data.nombre, activo: data.activo };
});

/** Usuario conectado y su rol. Si está dado de baja, lo saca. */
export async function usuarioConRol() {
  const u = await usuarioActual();
  const p = await perfilDe(u.id);
  if (!p.activo) redirect("/ingresar?baja=1");
  return { u, ...p };
}

/** Para las pantallas y acciones de cobros, facturación, monotributo y configuración. */
export async function soloDuenio() {
  const r = await usuarioConRol();
  if (r.rol !== "duenio") redirect("/caja");
  return r.u;
}
