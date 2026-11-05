// Suma al stock de un local las cantidades de "Lista Etiquetas" (la mercadería que llegó).
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/almacen";
import { planillaAutorizada } from "@/lib/supabase/planilla";

export async function POST(req: Request) {
  const db = clienteServidor();
  if (!(await planillaAutorizada(db, req))) return NextResponse.json({ error: "Clave de la planilla incorrecta." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { local?: number; items?: { sku: string; cantidad: number }[]; nota?: string } | null;
  const local = Number(body?.local);
  if (![1, 2].includes(local)) return NextResponse.json({ error: "Local inválido." }, { status: 400 });
  // Junta cantidades del mismo SKU (sin importar mayúsculas)
  const pedidos = new Map<string, { sku: string; cantidad: number }>();
  for (const it of body?.items ?? []) {
    const sku = String(it.sku ?? "").trim();
    const cantidad = Number(it.cantidad) > 0 ? Math.round(Number(it.cantidad)) : 1;
    if (!sku) continue;
    const k = sku.toLowerCase();
    pedidos.set(k, { sku, cantidad: (pedidos.get(k)?.cantidad ?? 0) + cantidad });
  }
  if (pedidos.size === 0) return NextResponse.json({ error: "La lista está vacía." }, { status: 400 });

  const encontrados = new Map<string, string>(); // sku en minúscula → producto_id
  const lista = [...pedidos.values()];
  for (let i = 0; i < lista.length; i += 100) {
    const { data, error } = await db.from("productos").select("id, sku").eq("activo", true)
      .or(lista.slice(i, i + 100).map((p) => `sku.ilike."${p.sku.replace(/["\\%*]/g, "")}"`).join(","));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) encontrados.set(String(p.sku).toLowerCase(), p.id);
  }
  const items = [...pedidos.entries()].filter(([k]) => encontrados.has(k)).map(([k, p]) => ({ producto_id: encontrados.get(k)!, cantidad: p.cantidad }));
  const noEncontrados = [...pedidos.entries()].filter(([k]) => !encontrados.has(k)).map(([, p]) => p.sku);
  if (items.length) {
    const { error } = await db.rpc("aplicar_stock", { p_local: local, p_tipo: "ingreso", p_items: items, p_completo: false, p_usuario: null, p_nota: body?.nota || "Compra cargada desde Precios Deco" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sumados: items.length, unidades: items.reduce((s, x) => s + x.cantidad, 0), noEncontrados });
}
