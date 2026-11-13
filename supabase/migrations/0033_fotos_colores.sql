-- Foto (miniatura) de cada color. Si un color no tiene, se usa la del producto.
alter table public.producto_variantes add column if not exists imagen_url text;
