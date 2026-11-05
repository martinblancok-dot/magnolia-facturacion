-- Ajustes del sistema que solo lee el servidor (por ejemplo, la clave de administrador cifrada)
create table if not exists public.ajustes (
  clave text primary key,
  valor text not null,
  actualizado_en timestamptz not null default now()
);
alter table public.ajustes enable row level security; -- sin políticas: nadie lo lee desde el navegador

create index if not exists productos_proveedor on public.productos (proveedor);
