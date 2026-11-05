-- Los colaboradores no anulan: piden la anulación y un dueño la confirma o la rechaza.
alter table public.ventas
  add column if not exists anulacion_pedida_por   uuid references auth.users(id),
  add column if not exists anulacion_pedida_en    timestamptz,
  add column if not exists anulacion_motivo       text,
  add column if not exists anulacion_rechazada_por uuid references auth.users(id),
  add column if not exists anulacion_rechazada_en timestamptz;
create index if not exists ventas_anulacion_pedida on public.ventas (anulacion_pedida_en) where anulacion_pedida_en is not null and not anulada;
