-- Sincronización con la planilla Precios Deco (Google Sheets).
-- hoja: pestaña de la planilla de donde viene el producto (null = cargado solo en el sistema).
-- baja: por qué está inactivo ('planilla' = se borró de la planilla; 'sistema' = se eliminó en el sistema).
alter table public.productos add column if not exists hoja text;
alter table public.productos add column if not exists baja text check (baja in ('planilla', 'sistema'));

-- Cambios hechos en el sistema que el script de la planilla tiene que escribir.
create table if not exists public.planilla_cambios (
  id         bigserial primary key,
  tipo       text not null check (tipo in ('editar', 'nuevo')),
  barcode    text,                 -- para 'editar'
  hoja       text not null,
  datos      jsonb not null,       -- editar: {nombre?, costo?, categoria?}; nuevo: {articulo_prov, nombre, costo, categoria?}
  creado_en  timestamptz not null default now(),
  creado_por uuid references auth.users(id),
  aplicado_en timestamptz,
  error      text
);
create index if not exists planilla_cambios_pendientes on public.planilla_cambios (id) where aplicado_en is null and error is null;
alter table public.planilla_cambios enable row level security; -- sin políticas: solo el servidor
