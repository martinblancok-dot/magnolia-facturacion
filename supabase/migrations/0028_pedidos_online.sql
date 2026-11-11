-- Pedidos de la tienda online (Tiendanube).
-- Cada producto del pedido sale del local que más unidades tiene; ese local lo ve en su caja.
-- El stock se descuenta al entrar el pedido (Tiendanube también lo reserva en ese momento)
-- y se devuelve si el pedido se cancela.

alter table public.stock_movimientos drop constraint if exists stock_movimientos_tipo_check;
alter table public.stock_movimientos add constraint stock_movimientos_tipo_check
  check (tipo in ('ingreso','conteo','transferencia','web'));

create table if not exists public.pedidos_web (
  id               bigint primary key,            -- id del pedido en Tiendanube
  numero           int not null,                  -- número que ve el cliente (#123)
  estado           text not null default 'pendiente_pago'
                   check (estado in ('pendiente_pago','a_preparar','preparado','entregado','cancelado')),
  pago             text,                          -- estado del pago en Tiendanube (pending, paid…)
  medio            text,                          -- medio de pago elegido
  entrega          text not null default 'envio' check (entrega in ('envio','retiro')),
  entrega_detalle  text,                          -- nombre del envío o del punto de retiro
  retira_local     int references public.locales(id),
  cliente          text,
  telefono         text,
  email            text,
  direccion        text,
  nota             text,
  total            numeric(14,2) not null default 0,
  creado_en        timestamptz not null,          -- cuándo lo hizo el cliente
  actualizado_tn   timestamptz,                   -- última modificación en Tiendanube
  stock_descontado boolean not null default false,
  pagado_en        timestamptz,
  preparado_en     timestamptz,
  entregado_en     timestamptz,
  entregado_por    uuid references auth.users(id),
  cancelado_en     timestamptz,
  recibido_en      timestamptz not null default now()
);
create index if not exists pedidos_web_estado on public.pedidos_web (estado, creado_en desc);

create table if not exists public.pedidos_web_items (
  pedido_id     bigint not null references public.pedidos_web(id) on delete cascade,
  n             int not null,
  producto_id   uuid references public.productos(id),  -- null = no se encontró en el sistema
  nombre        text not null,
  sku           text,
  cantidad      numeric(12,2) not null check (cantidad > 0),
  precio        numeric(14,2) not null default 0,
  local_id      int references public.locales(id),     -- de qué local sale
  preparado_en  timestamptz,
  preparado_por uuid references auth.users(id),
  primary key (pedido_id, n)
);
create index if not exists pedidos_web_items_local on public.pedidos_web_items (local_id) where preparado_en is null;

alter table public.pedidos_web enable row level security;
alter table public.pedidos_web_items enable row level security;
drop policy if exists "ver pedidos web" on public.pedidos_web;
create policy "ver pedidos web" on public.pedidos_web for select to authenticated using (true);
drop policy if exists "ver items pedidos web" on public.pedidos_web_items;
create policy "ver items pedidos web" on public.pedidos_web_items for select to authenticated using (true);

-- Descuenta (p_signo = -1) o devuelve (p_signo = 1) el stock de un pedido, una sola vez.
create or replace function public.stock_pedido_web(p_pedido bigint, p_signo int)
returns int language plpgsql security definer set search_path = public as $$
declare
  ped record; it record; ant numeric; n int := 0;
begin
  if p_signo not in (-1, 1) then raise exception 'signo inválido'; end if;
  select * into ped from pedidos_web where id = p_pedido for update;
  if not found then raise exception 'pedido inexistente'; end if;
  -- Descontar solo si no se descontó; devolver solo si se había descontado
  if (p_signo = -1 and ped.stock_descontado) or (p_signo = 1 and not ped.stock_descontado) then return 0; end if;
  for it in select * from pedidos_web_items where pedido_id = p_pedido and producto_id is not null and local_id is not null loop
    select cantidad into ant from stock where producto_id = it.producto_id and local_id = it.local_id for update;
    ant := coalesce(ant, 0);
    insert into stock (producto_id, local_id, cantidad) values (it.producto_id, it.local_id, ant + p_signo * it.cantidad)
      on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota)
    values (it.producto_id, it.local_id, 'web', p_signo * it.cantidad, ant, ant + p_signo * it.cantidad,
            case when p_signo = -1 then 'Pedido online #' else 'Cancelado pedido online #' end || ped.numero);
    n := n + 1;
  end loop;
  update pedidos_web set stock_descontado = (p_signo = -1) where id = p_pedido;
  return n;
end $$;
revoke execute on function public.stock_pedido_web(bigint, int) from public, anon, authenticated;
