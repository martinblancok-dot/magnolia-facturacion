import type { SupabaseClient } from "@supabase/supabase-js";
import { CARGOS_INICIALES, type Cargos } from "@/lib/reportes";

/** % que se pierde por cada medio de pago (configurado por ustedes; si nunca se guardó, cuotas 20,3%). */
export async function leerCargos(db: SupabaseClient): Promise<Cargos> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "cargos_medios").maybeSingle();
  if (!data?.valor) return CARGOS_INICIALES;
  try { return JSON.parse(data.valor) as Cargos; } catch { return CARGOS_INICIALES; }
}
