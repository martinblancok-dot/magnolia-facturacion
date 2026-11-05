-- Usuarios con permisos: dueños (Martín y Sofi) y colaboradores (solo caja, productos y stock).
create table if not exists public.perfiles (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null default '',
  rol        text not null default 'colaborador' check (rol in ('duenio', 'colaborador')),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
alter table public.perfiles enable row level security; -- sin políticas: solo el servidor

-- Los usuarios que ya existen (Martín y Sofi) quedan como dueños.
insert into public.perfiles (usuario_id, nombre, rol)
select u.id, coalesce(e.nombre, split_part(u.email, '@', 1)), 'duenio'
from auth.users u left join public.emisores e on e.usuario_id = u.id
on conflict (usuario_id) do nothing;

create or replace function public.es_duenio() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where usuario_id = auth.uid() and rol = 'duenio' and activo);
$$;

-- El costo de los productos y los datos de ARCA solo los pueden leer los dueños.
drop policy if exists "ver productos" on public.productos;
create policy "ver productos" on public.productos for select to authenticated using (public.es_duenio());
drop policy if exists "crear mi emisor" on public.emisores;
create policy "crear mi emisor" on public.emisores for insert with check (auth.uid() = usuario_id and public.es_duenio());
