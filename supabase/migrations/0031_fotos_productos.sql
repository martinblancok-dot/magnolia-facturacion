-- Fotos de productos: una miniatura liviana (300x300 .webp) por producto.
-- Las fotos de alta calidad están en Tiendanube; acá solo la miniatura para la caja y las listas.

-- 1) Dónde se guarda la dirección de la miniatura (vacía en todos; no cambia nada de lo que ya hay)
alter table public.productos add column if not exists imagen_url text;

-- 2) Carpeta pública para las miniaturas. Se pueden ver con la dirección; subir y borrar solo
--    lo hace el sistema desde el servidor (no hay permisos de escritura para nadie más).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos-miniaturas', 'productos-miniaturas', true, 102400, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 102400, allowed_mime_types = array['image/webp'];
