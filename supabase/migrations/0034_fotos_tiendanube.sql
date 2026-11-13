-- Fotos traídas de Tiendanube: de qué foto de la tienda salió cada miniatura (para actualizarla solo si cambia).
-- Si una foto se carga a mano en el sistema, esto queda vacío y la de Tiendanube no la pisa.
alter table public.productos add column if not exists tn_imagen text;
alter table public.producto_variantes add column if not exists tn_imagen text;
