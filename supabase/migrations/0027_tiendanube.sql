-- Tienda online (Tiendanube): qué se publica, con qué id quedó allá y qué se mandó por última vez.
alter table public.productos
  add column if not exists tn_producto_id bigint,
  add column if not exists tn_variante_id bigint,
  add column if not exists tn_precio numeric(14,2),
  add column if not exists tn_stock int,
  add column if not exists tn_publicado boolean,
  add column if not exists tn_sincronizado_en timestamptz,
  add column if not exists tn_error text;
create index if not exists productos_publicar_web on public.productos (publicar_web) where publicar_web;

-- Equivalencia entre las categorías del sistema (las de la planilla) y las de la tienda online.
create table if not exists public.tn_categorias (
  categoria    text primary key,          -- como está en productos.categoria
  tn_categoria text,                      -- nombre en la tienda (null = sin categoría)
  actualizado_en timestamptz not null default now()
);
alter table public.tn_categorias enable row level security;
