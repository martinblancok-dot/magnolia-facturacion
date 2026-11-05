-- Gift cards: se venden con cualquier medio (entra a la caja ese día) y se usan en cualquiera
-- de los dos locales (no entra a la caja). El saldo que sobra queda para otra compra.
create table if not exists public.giftcards (
  id           uuid primary key,              -- lo genera la caja (se puede vender sin internet)
  codigo       text not null unique,
  monto        numeric(14,2) not null check (monto > 0),
  saldo        numeric(14,2) not null check (saldo >= 0),
  medio_origen text not null,                 -- cómo se pagó: define el descuento al usarla
  local_id     int references public.locales(id),
  venta_id     uuid references public.ventas(id),
  creada_en    timestamptz not null default now(),
  anulada      boolean not null default false
);
create table if not exists public.giftcard_movimientos (
  id          bigserial primary key,
  giftcard_id uuid not null references public.giftcards(id),
  venta_id    uuid references public.ventas(id),
  monto       numeric(14,2) not null,         -- negativo: se usó; positivo: se devolvió al anular
  creado_en   timestamptz not null default now()
);
create index if not exists giftcard_mov_tarjeta on public.giftcard_movimientos (giftcard_id);
alter table public.giftcards enable row level security;            -- sin políticas: solo el servidor
alter table public.giftcard_movimientos enable row level security;

alter table public.ventas add column if not exists giftcard_id uuid;
alter table public.ventas add column if not exists giftcard_monto numeric(14,2) not null default 0;
alter table public.ventas drop constraint if exists ventas_medio_pago_check;
alter table public.ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo','transferencia','debito','credito','cuotas','qr','giftcard'));

create or replace function public.registrar_venta(v jsonb, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  i int := 0;
  gc_monto numeric := coalesce(nullif(v->>'giftcard_monto','')::numeric, 0);
  gc_id uuid := nullif(v->>'giftcard_id','')::uuid;
  g jsonb := v->'giftcard_nueva';
begin
  insert into ventas (id, local_id, usuario_id, terminal, creada_en, medio_pago, total, total_lista, paga_con, turno_id, giftcard_id, giftcard_monto)
  values ((v->>'id')::uuid, (v->>'local_id')::int, usuario, v->>'terminal', (v->>'creada_en')::timestamptz,
          v->>'medio_pago', (v->>'total')::numeric, (v->>'total_lista')::numeric, nullif(v->>'paga_con','')::numeric,
          nullif(v->>'turno_id','')::uuid, gc_id, gc_monto)
  on conflict (id) do nothing;
  get diagnostics i = row_count;
  if i = 0 then return false; end if; -- ya estaba registrada

  -- Pago con gift card: descuenta el saldo (si no alcanza, no se registra nada)
  if gc_monto > 0 then
    update giftcards set saldo = saldo - gc_monto where id = gc_id and not anulada and saldo >= gc_monto;
    if not found then raise exception 'La gift card no tiene saldo suficiente o no existe'; end if;
    insert into giftcard_movimientos (giftcard_id, venta_id, monto) values (gc_id, (v->>'id')::uuid, -gc_monto);
  end if;

  -- Venta de una gift card nueva
  if g is not null and jsonb_typeof(g) = 'object' then
    insert into giftcards (id, codigo, monto, saldo, medio_origen, local_id, venta_id, creada_en)
    values ((g->>'id')::uuid, upper(left(replace(g->>'id', '-', ''), 8)), (g->>'monto')::numeric, (g->>'monto')::numeric,
            g->>'medio', (v->>'local_id')::int, (v->>'id')::uuid, (v->>'creada_en')::timestamptz);
  end if;

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
revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;

create or replace function public.anular_venta(venta uuid, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; g record;
begin
  select * into v from ventas where id = venta and not anulada for update;
  if not found then return false; end if;
  -- Si en esta venta se vendió una gift card, solo se puede anular si no se usó
  select * into g from giftcards where venta_id = venta for update;
  if found then
    if g.saldo < g.monto then raise exception 'La gift card % ya se usó: no se puede anular esta venta', g.codigo; end if;
    update giftcards set anulada = true, saldo = 0 where id = g.id;
  end if;
  -- Si se pagó con gift card, vuelve el saldo
  if v.giftcard_monto > 0 then
    update giftcards set saldo = saldo + v.giftcard_monto where id = v.giftcard_id;
    insert into giftcard_movimientos (giftcard_id, venta_id, monto) values (v.giftcard_id, venta, v.giftcard_monto);
  end if;
  update ventas set anulada = true, anulada_en = now(), anulada_por = usuario where id = venta;
  update stock s set cantidad = s.cantidad + vi.cantidad
  from venta_items vi where vi.venta_id = venta and vi.producto_id = s.producto_id and s.local_id = v.local_id;
  return true;
end $$;
revoke execute on function public.anular_venta(uuid, uuid) from public, anon, authenticated;
