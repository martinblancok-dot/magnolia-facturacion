-- Sistema Magnolia: punto de venta (caja), catálogo, stock y ventas.
-- Los datos son del negocio: cualquier usuario conectado los ve; se escriben solo desde el servidor.

create table public.locales (
  id        int primary key,
  nombre    text not null,
  direccion text
);
insert into public.locales (id, nombre, direccion) values
  (1, 'Magnolia Home', 'San Martín 1031'),
  (2, 'Magnolia Beauty', 'San Martín 784');

create table public.productos (
  id              uuid primary key default gen_random_uuid(),
  barcode         text not null unique,          -- lo que lee el lector
  sku             text not null,                 -- Articulo Interno (ej. Cam1030)
  nombre          text not null,
  categoria       text,
  proveedor       text,
  costo           numeric(14,2),
  precio_lista    numeric(14,2) not null check (precio_lista >= 0),
  precio_efectivo numeric(14,2) not null check (precio_efectivo >= 0),
  activo          boolean not null default true,
  -- para la tienda online (más adelante)
  descripcion     text,
  foto_url        text,
  publicar_web    boolean not null default false,
  actualizado_en  timestamptz not null default now()
);
create index productos_sku on public.productos (lower(sku));

create table public.stock (
  producto_id uuid not null references public.productos(id) on delete cascade,
  local_id    int  not null references public.locales(id),
  cantidad    numeric(12,2) not null default 0,
  primary key (producto_id, local_id)
);

create table public.ventas (
  id            uuid primary key,                -- lo genera la caja (sirve para no duplicar al reenviar)
  numero        bigserial unique,
  local_id      int not null references public.locales(id),
  usuario_id    uuid references auth.users(id),
  terminal      text,
  creada_en     timestamptz not null,            -- hora de la venta en la caja (aunque no hubiera internet)
  recibida_en   timestamptz not null default now(),
  medio_pago    text not null check (medio_pago in ('efectivo','debito','credito','transferencia','qr')),
  total         numeric(14,2) not null,
  total_lista   numeric(14,2) not null,          -- cuánto hubiera sido a precio de lista
  paga_con      numeric(14,2),
  anulada       boolean not null default false,
  anulada_en    timestamptz,
  anulada_por   uuid references auth.users(id)
);
create index ventas_local_fecha on public.ventas (local_id, creada_en);

create table public.venta_items (
  venta_id        uuid not null references public.ventas(id) on delete cascade,
  n               int  not null,
  producto_id     uuid references public.productos(id),
  barcode         text,
  sku             text,
  nombre          text not null,
  cantidad        numeric(12,2) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null,
  total           numeric(14,2) not null,
  primary key (venta_id, n)
);

-- Registra una venta completa una sola vez (si llega repetida, no hace nada) y descuenta stock.
create or replace function public.registrar_venta(v jsonb, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  nueva boolean;
  it jsonb;
  i int := 0;
begin
  insert into ventas (id, local_id, usuario_id, terminal, creada_en, medio_pago, total, total_lista, paga_con)
  values ((v->>'id')::uuid, (v->>'local_id')::int, usuario, v->>'terminal', (v->>'creada_en')::timestamptz,
          v->>'medio_pago', (v->>'total')::numeric, (v->>'total_lista')::numeric, nullif(v->>'paga_con','')::numeric)
  on conflict (id) do nothing;
  get diagnostics i = row_count;
  nueva := i > 0;
  if not nueva then return false; end if;

  i := 0;
  for it in select * from jsonb_array_elements(v->'items') loop
    i := i + 1;
    insert into venta_items (venta_id, n, producto_id, barcode, sku, nombre, cantidad, precio_unitario, total)
    values ((v->>'id')::uuid, i, nullif(it->>'producto_id','')::uuid, it->>'barcode', it->>'sku', it->>'nombre',
            (it->>'cantidad')::numeric, (it->>'precio_unitario')::numeric, (it->>'total')::numeric);
    if nullif(it->>'producto_id','') is not null then
      insert into stock (producto_id, local_id, cantidad)
      values ((it->>'producto_id')::uuid, (v->>'local_id')::int, -(it->>'cantidad')::numeric)
      on conflict (producto_id, local_id) do update set cantidad = stock.cantidad + excluded.cantidad;
    end if;
  end loop;
  return true;
end $$;

-- Anular devuelve el stock
create or replace function public.anular_venta(venta uuid, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  update ventas set anulada = true, anulada_en = now(), anulada_por = usuario
  where id = venta and not anulada returning * into v;
  if not found then return false; end if;
  update stock s set cantidad = s.cantidad + vi.cantidad
  from venta_items vi where vi.venta_id = venta and vi.producto_id = s.producto_id and s.local_id = v.local_id;
  return true;
end $$;

revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.anular_venta(uuid, uuid) from public, anon, authenticated;

alter table public.locales     enable row level security;
alter table public.productos   enable row level security;
alter table public.stock       enable row level security;
alter table public.ventas      enable row level security;
alter table public.venta_items enable row level security;
create policy "ver locales"   on public.locales     for select to authenticated using (true);
create policy "ver productos" on public.productos   for select to authenticated using (true);
create policy "ver stock"     on public.stock       for select to authenticated using (true);
create policy "ver ventas"    on public.ventas      for select to authenticated using (true);
create policy "ver items"     on public.venta_items for select to authenticated using (true);
