// Stock inteligente: qué se está por terminar, qué pedir a cada proveedor y qué conviene pasar de un local al otro.
export interface ProdRepo { id: string; sku: string | null; nombre: string; proveedor: string | null; costo: number | null }
export interface FilaRepo {
  id: string; sku: string | null; nombre: string; proveedor: string; costo: number | null;
  stock: [number, number];        // [Home, Beauty]
  vendidas: [number, number];     // en el período
  porDia: number;                 // ventas por día (los dos locales)
  dias: number | null;            // días que alcanza el stock total (null = no se vendió)
  pedir: number;                  // unidades sugeridas para pedir al proveedor
  pasar: { desde: 1 | 2; hasta: 1 | 2; cantidad: number } | null; // transferencia sugerida
  estado: "agotado" | "bajo" | "ok" | "quieto";
}

/**
 * vendidas: Map producto → [unidades Home, unidades Beauty] en los últimos `periodo` días.
 * cubrir: para cuántos días tiene que alcanzar el stock (lo que se sugiere pedir).
 * alerta: menos de estos días de stock = "bajo".
 */
export function calcularReposicion(
  productos: ProdRepo[], stock: Map<string, [number, number]>, vendidas: Map<string, [number, number]>,
  { periodo = 30, cubrir = 30, alerta = 10 } = {},
): FilaRepo[] {
  const filas: FilaRepo[] = [];
  for (const p of productos) {
    const st = stock.get(p.id) ?? [0, 0];
    const vd = vendidas.get(p.id) ?? [0, 0];
    const total = Math.max(0, st[0]) + Math.max(0, st[1]);
    const vendTot = vd[0] + vd[1];
    if (vendTot <= 0 && total <= 0) continue; // ni stock ni ventas: no interesa
    const porDia = vendTot / periodo;
    const dias = porDia > 0 ? total / porDia : null;
    const pedir = porDia > 0 ? Math.max(0, Math.ceil(porDia * cubrir - total)) : 0;

    // Transferencia: si a un local le faltan y al otro le sobran (más de lo que necesita para `alerta` días)
    let pasar: FilaRepo["pasar"] = null;
    const necesita = (i: 0 | 1) => Math.ceil((vd[i] / periodo) * alerta);
    for (const [a, b] of [[0, 1], [1, 0]] as const) {
      const falta = necesita(a) - st[a];
      const sobra = st[b] - Math.max(necesita(b), vd[b] > 0 ? 1 : 0);
      if (vd[a] > 0 && st[a] <= 0 || falta > 0) {
        const cant = Math.min(Math.max(falta, 1), sobra);
        if (cant > 0) { pasar = { desde: (b + 1) as 1 | 2, hasta: (a + 1) as 1 | 2, cantidad: cant }; break; }
      }
    }
    const estado: FilaRepo["estado"] = vendTot <= 0 ? "quieto" : total <= 0 ? "agotado" : (dias ?? 0) < alerta ? "bajo" : "ok";
    filas.push({ id: p.id, sku: p.sku, nombre: p.nombre, proveedor: p.proveedor || "Sin proveedor", costo: p.costo, stock: st, vendidas: vd, porDia, dias, pedir, pasar, estado });
  }
  const orden = { agotado: 0, bajo: 1, ok: 2, quieto: 3 };
  return filas.sort((a, b) => orden[a.estado] - orden[b.estado] || (a.dias ?? 1e9) - (b.dias ?? 1e9) || b.porDia - a.porDia);
}

/** Texto del pedido para mandar al proveedor por WhatsApp o mail. */
export function textoPedido(proveedor: string, filas: { sku: string | null; nombre: string; cantidad: number }[]) {
  return [`Hola! Pedido de Magnolia (${proveedor}):`, ...filas.map((f) => `• ${f.cantidad} × ${f.nombre}${f.sku ? ` (${f.sku})` : ""}`), "Gracias!"].join("\n");
}
