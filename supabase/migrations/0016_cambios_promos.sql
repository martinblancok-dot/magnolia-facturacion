-- Cambios y devoluciones, promociones y descuentos autorizados.

-- Devoluciones: en un cambio, lo devuelto va con cantidad negativa (vuelve al stock).
alter table public.venta_items drop constraint if exists venta_items_cantidad_check;
alter table public.venta_items add constraint venta_items_cantidad_check check (cantidad <> 0);

alter table public.ventas add column if not exists cambio_de uuid references public.ventas(id);
alter table public.ventas add column if not exists credito_cambio numeric(14,2) not null default 0;
alter table public.ventas add column if not exists descuento jsonb;
create index if not exists ventas_cambio_de on public.ventas (cambio_de) where cambio_de is not null;
alter table public.ventas drop constraint if exists ventas_medio_pago_check;
alter table public.ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo','transferencia','debito','credito','cuotas','qr','giftcard','cambio'));

-- Promociones (las crean los dueños; la caja las baja con el catálogo)
create table if not exists public.promos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  tipo           text not null check (tipo in ('segunda','nxm','porcentaje')),
  pct            numeric(5,2) not null default 0,
  n              int not null default 2,
  m              int not null default 1,
  alcance        text not null default 'todo' check (alcance in ('todo','categoria','proveedor','sku')),
  valores        text[] not null default '{}',
  mismo_producto boolean not null default true,
  activa         boolean not null default true,
  desde          date,
  hasta          date,
  orden          int not null default 0,
  creada_en      timestamptz not null default now()
);
alter table public.promos enable row level security;

-- Pedidos de autorización (descuentos manuales que pide un colaborador)
create table if not exists public.autorizaciones (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null default 'descuento',
  local_id     int references public.locales(id),
  pedido_por   uuid references auth.users(id),
  datos        jsonb not null,            -- {tipo:'pct'|'monto', valor, motivo, subtotal, productos}
  estado       text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','usada')),
  resuelta_por uuid references auth.users(id),
  creada_en    timestamptz not null default now(),
  resuelta_en  timestamptz
);
create index if not exists autorizaciones_pendientes on public.autorizaciones (creada_en) where estado = 'pendiente';
alter table public.autorizaciones enable row level security;

create or replace function public.registrar_venta(v jsonb, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  i int := 0;
  gc_monto numeric := coalesce(nullif(v->>'giftcard_monto','')::numeric, 0);
  gc_id uuid := nullif(v->>'giftcard_id','')::uuid;
  g jsonb := v->'giftcard_nueva';
  orig uuid := nullif(v->>'cambio_de','')::uuid;
  vendido numeric; devuelto numeric; nombre_base text;
begin
  -- Cambio: la venta original tiene que existir y no se puede devolver más de lo vendido
  if orig is not null and not exists (select 1 from ventas where id = (v->>'id')::uuid) then
    if not exists (select 1 from ventas where id = orig and not anulada) then raise exception 'La venta original no existe o está anulada'; end if;
    perform 1 from ventas where id = orig for update;
    for it in select * from jsonb_array_elements(v->'items') loop
      if (it->>'cantidad')::numeric < 0 then
        nombre_base := regexp_replace(it->>'nombre', '^Devolución: ', '');
        select coalesce(sum(cantidad), 0) into vendido from venta_items
          where venta_id = orig and cantidad > 0
            and ((it->>'producto_id') is not null and producto_id = (it->>'producto_id')::uuid
              or (it->>'producto_id') is null and producto_id is null and nombre = nombre_base);
        select coalesce(sum(-vi.cantidad), 0) into devuelto from venta_items vi join ventas x on x.id = vi.venta_id
          where x.cambio_de = orig and not x.anulada and vi.cantidad < 0
            and ((it->>'producto_id') is not null and vi.producto_id = (it->>'producto_id')::uuid
              or (it->>'producto_id') is null and vi.producto_id is null and vi.nombre = it->>'nombre');
        if devuelto - (it->>'cantidad')::numeric > vendido then
          raise exception 'De "%" ya se devolvió todo lo que se había vendido', nombre_base;
        end if;
      end if;
    end loop;
  end if;

  insert into ventas (id, local_id, usuario_id, terminal, creada_en, medio_pago, total, total_lista, paga_con, turno_id,
                      giftcard_id, giftcard_monto, cambio_de, credito_cambio, descuento)
  values ((v->>'id')::uuid, (v->>'local_id')::int, usuario, v->>'terminal', (v->>'creada_en')::timestamptz,
          v->>'medio_pago', (v->>'total')::numeric, (v->>'total_lista')::numeric, nullif(v->>'paga_con','')::numeric,
          nullif(v->>'turno_id','')::uuid, gc_id, gc_monto, orig, coalesce(nullif(v->>'credito_cambio','')::numeric, 0),
          case when jsonb_typeof(v->'descuento') = 'object' then v->'descuento' end)
  on conflict (id) do nothing;
  get diagnostics i = row_count;
  if i = 0 then return false; end if; -- ya estaba registrada

  if gc_monto > 0 then
    update giftcards set saldo = saldo - gc_monto where id = gc_id and not anulada and saldo >= gc_monto;
    if not found then raise exception 'La gift card no tiene saldo suficiente o no existe'; end if;
    insert into giftcard_movimientos (giftcard_id, venta_id, monto) values (gc_id, (v->>'id')::uuid, -gc_monto);
  end if;

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
      -- vender resta stock; devolver (cantidad negativa) lo suma
      insert into stock (producto_id, local_id, cantidad)
      values ((it->>'producto_id')::uuid, (v->>'local_id')::int, -(it->>'cantidad')::numeric)
      on conflict (producto_id, local_id) do update set cantidad = stock.cantidad + excluded.cantidad;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;
