-- Transferencias de mercadería entre Magnolia Home y Magnolia Beauty.
alter table public.stock_movimientos drop constraint if exists stock_movimientos_tipo_check;
alter table public.stock_movimientos add constraint stock_movimientos_tipo_check
  check (tipo in ('ingreso','conteo','transferencia'));

-- Pasa mercadería de un local al otro: resta en el origen y suma en el destino, todo junto.
-- items: [{ "producto_id": "...", "cantidad": 3 }, ...]
create or replace function public.transferir_stock(p_desde int, p_hasta int, p_items jsonb, p_usuario uuid, p_nota text)
returns int language plpgsql security definer set search_path = public as $$
declare
  it jsonb; prod uuid; cant numeric; ant numeric; n int := 0;
  nota text := coalesce(nullif(p_nota, ''), 'Transferencia');
begin
  if p_desde = p_hasta or p_desde not in (1, 2) or p_hasta not in (1, 2) then raise exception 'locales inválidos'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    prod := (it->>'producto_id')::uuid;
    cant := (it->>'cantidad')::numeric;
    if cant is null or cant <= 0 then continue; end if;
    -- origen
    select cantidad into ant from stock where producto_id = prod and local_id = p_desde for update;
    ant := coalesce(ant, 0);
    insert into stock (producto_id, local_id, cantidad) values (prod, p_desde, ant - cant)
      on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
    values (prod, p_desde, 'transferencia', -cant, ant, ant - cant, nota || ' → ' || (select nombre from locales where id = p_hasta), p_usuario);
    -- destino
    select cantidad into ant from stock where producto_id = prod and local_id = p_hasta for update;
    ant := coalesce(ant, 0);
    insert into stock (producto_id, local_id, cantidad) values (prod, p_hasta, ant + cant)
      on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
    values (prod, p_hasta, 'transferencia', cant, ant, ant + cant, nota || ' ← ' || (select nombre from locales where id = p_desde), p_usuario);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.transferir_stock(int, int, jsonb, uuid, text) from public, anon, authenticated;
