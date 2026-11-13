// Botón "Traer fotos de Tienda Nube" (solo dueños).
import { NextResponse } from "next/server";
import { adminDesbloqueado } from "@/lib/admin";
import { leerCredencialesTN } from "@/lib/tiendanube";
import { traerFotosTN } from "@/lib/tiendanube-fotos";
import { clienteServidor } from "@/lib/supabase/almacen";

export const maxDuration = 60;

export async function POST() {
  if (!(await adminDesbloqueado())) return NextResponse.json({ error: "Solo Martín y Sofi." }, { status: 403 });
  const db = clienteServidor();
  const cred = await leerCredencialesTN(db);
  if (!cred) return NextResponse.json({ error: "La tienda no está conectada (Configuración → Tienda online)." }, { status: 400 });
  try {
    return NextResponse.json(await traerFotosTN(db, cred, { hastaMs: 50_000 }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
