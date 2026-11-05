-- Cada compu que usa la caja avisa cada tanto en qué caja está y cuántas ventas le faltan subir.
-- Sirve para trabajar con varias compus en la misma caja y para cerrarla sin perder ventas.
create table if not exists public.terminales (
  id         text primary key,            -- identificador de la compu (lo genera la caja)
  local_id   int references public.locales(id),
  turno_id   uuid,
  usuario_id uuid references auth.users(id),
  pendientes int not null default 0,
  visto_en   timestamptz not null default now()
);
create index if not exists terminales_turno on public.terminales (turno_id);
alter table public.terminales enable row level security; -- sin políticas: solo el servidor
