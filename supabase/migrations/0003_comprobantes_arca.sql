-- Comprobantes importados desde ARCA → Mis Comprobantes → Emitidos
-- (incluye los que se hacen a mano en Comprobantes en línea, por ejemplo los de efectivo)
create table public.comprobantes_arca (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  tipo         int  not null,
  tipo_texto   text not null,
  punto_venta  int  not null,
  numero_desde int  not null,
  numero_hasta int  not null,
  fecha        date not null,
  importe      numeric(14,2) not null, -- negativo en notas de crédito
  cae          text,
  importado_en timestamptz not null default now(),
  unique (usuario_id, tipo, punto_venta, numero_desde)
);
create index comprobantes_arca_fecha on public.comprobantes_arca (usuario_id, fecha);

alter table public.comprobantes_arca enable row level security;
create policy "ver mis comprobantes de arca" on public.comprobantes_arca for select using (auth.uid() = usuario_id);
