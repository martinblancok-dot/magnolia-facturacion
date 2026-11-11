// Copia de seguridad: qué tablas se copian y en qué orden se leen.
// La hace el script de Precios Deco (Google) una vez por semana y la guarda en el Drive de ustedes.
// No se copian claves ni certificados (secretos, ajustes, emisores, terminales).
export const TABLAS_RESPALDO: Record<string, string[]> = {
  locales: ["id"],
  productos: ["id"],
  producto_codigos: ["codigo"],
  promos: ["id"],
  stock: ["producto_id", "local_id"],
  stock_movimientos: ["id"],
  turnos_caja: ["id"],
  caja_movimientos: ["id"],
  ventas: ["id"],
  venta_items: ["venta_id", "n"],
  giftcards: ["id"],
  giftcard_movimientos: ["id"],
  clientes_cc: ["id"],
  cc_pagos: ["id"],
  pedidos_web: ["id"],
  pedidos_web_items: ["pedido_id", "n"],
  cobros: ["id"],
  facturas: ["id"],
  comprobantes_arca: ["id"],
  perfiles: ["usuario_id"],
};
export const FILAS_POR_PAGINA = 1000; // Supabase no devuelve más de 1000 filas por pedido
