-- Índices para que las pantallas carguen más rápido.
create index if not exists productos_actualizado on public.productos (actualizado_en desc);
create index if not exists productos_activos_id on public.productos (id) where activo;
create index if not exists ventas_fecha on public.ventas (creada_en desc);
create index if not exists ventas_giftcard on public.ventas (giftcard_id) where giftcard_id is not null;
create index if not exists giftcards_venta on public.giftcards (venta_id);
create index if not exists terminales_usuario on public.terminales (usuario_id, visto_en desc);
analyze public.productos;
analyze public.ventas;
