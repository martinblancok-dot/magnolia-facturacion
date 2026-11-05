-- Crédito en cuotas como medio de pago aparte (el crédito en 1 pago tiene 10%)
alter table public.ventas drop constraint if exists ventas_medio_pago_check;
alter table public.ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo','transferencia','debito','credito','cuotas','qr'));

-- Historial de cargas y controles de stock
create table public.stock_movimientos (
  id          bigserial primary key,
  producto_id uuid not null references public.productos(id) on delete cascade,
  local_id    int  not null references public.locales(id),
  tipo        text not null check (tipo in ('ingreso','conteo')),
  cantidad    numeric(12,2) not null,      -- lo que cambió (+ entra, − sale)
  antes       numeric(12,2) not null,
  despues     numeric(12,2) not null,
  nota        text,
  usuario_id  uuid references auth.users(id),
  creado_en   timestamptz not null default now()
);
create index stock_mov_producto on public.stock_movimientos (producto_id, creado_en desc);
alter table public.stock_movimientos enable row level security;
create policy "ver movimientos de stock" on public.stock_movimientos for select to authenticated using (true);

-- Aplica una carga de mercadería (suma) o un control/conteo (deja lo contado).
-- items: [{ "producto_id": "...", "cantidad": 3 }, ...]
-- completo = true en un conteo: lo que no se escaneó queda en 0 en ese local.
create or replace function public.aplicar_stock(p_local int, p_tipo text, p_items jsonb, p_completo boolean, p_usuario uuid, p_nota text)
returns int language plpgsql security definer set search_path = public as $$
declare
  it jsonb; prod uuid; cant numeric; ant numeric; nuevo numeric; cambiados int := 0; r record;
begin
  if p_tipo not in ('ingreso','conteo') then raise exception 'tipo inválido'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    prod := (it->>'producto_id')::uuid;
    cant := (it->>'cantidad')::numeric;
    select cantidad into ant from stock where producto_id = prod and local_id = p_local for update;
    ant := coalesce(ant, 0);
    nuevo := case when p_tipo = 'ingreso' then ant + cant else cant end;
    insert into stock (producto_id, local_id, cantidad) values (prod, p_local, nuevo)
      on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    if nuevo <> ant then
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
      values (prod, p_local, p_tipo, nuevo - ant, ant, nuevo, p_nota, p_usuario);
      cambiados := cambiados + 1;
    end if;
  end loop;

  if p_tipo = 'conteo' and p_completo then
    for r in select s.producto_id, s.cantidad from stock s
             where s.local_id = p_local and s.cantidad <> 0
               and s.producto_id not in (select (x->>'producto_id')::uuid from jsonb_array_elements(p_items) x) loop
      update stock set cantidad = 0 where producto_id = r.producto_id and local_id = p_local;
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
      values (r.producto_id, p_local, 'conteo', -r.cantidad, r.cantidad, 0, coalesce(p_nota, '') || ' (no se contó: queda en 0)', p_usuario);
      cambiados := cambiados + 1;
    end loop;
  end if;
  return cambiados;
end $$;
revoke execute on function public.aplicar_stock(int, text, jsonb, boolean, uuid, text) from public, anon, authenticated;
