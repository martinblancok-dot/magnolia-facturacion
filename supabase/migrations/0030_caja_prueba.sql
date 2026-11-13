-- Caja de prueba (solo dueños): funciona como una caja real pero lo que se hace ahí queda marcado
-- como prueba. No descuenta stock, no aparece en ventas, reportes, cierres ni en el cruce con
-- Mercado Pago, y se borra todo junto desde Configuración → Caja de prueba.

alter table public.turnos_caja add column if not exists prueba boolean not null default false;
alter table public.ventas      add column if not exists prueba boolean not null default false;
alter table public.giftcards   add column if not exists prueba boolean not null default false;
alter table public.cc_pagos    add column if not exists prueba boolean not null default false;
create index if not exists ventas_prueba on public.ventas (prueba) where prueba;
create index if not exists turnos_prueba on public.turnos_caja (prueba) where prueba;

-- Igual que la versión de 0016, más: la venta es de prueba si lo dice ella o su caja.
-- Las de prueba no tocan el stock.
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
  es_prueba boolean := coalesce((v->>'prueba')::boolean, false)
    or exists (select 1 from turnos_caja where id = nullif(v->>'turno_id','')::uuid and prueba);
begin
  -- Cambio: la venta original tiene que existir y no se puede devolver más de lo vendido
  if orig is not null and not exists (select 1 from ventas where id = (v->>'id')::uuid) then
    if not exists (select 1 from ventas where id = orig and not anulada) then raise exception 'La venta original no existe o está anulada'; end if;
    if exists (select 1 from ventas where id = orig and prueba <> es_prueba) then
      raise exception 'Las ventas de prueba solo se cambian en la caja de prueba (y las reales, en las cajas reales)';
    end if;
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

  -- Una gift card de prueba no se usa en una caja real ni al revés
  if gc_monto > 0 and exists (select 1 from giftcards where id = gc_id and prueba <> es_prueba) then
    raise exception 'Esa gift card es de %', case when es_prueba then 'verdad: no se usa en la caja de prueba' else 'prueba: no se usa en una caja real' end;
  end if;

  insert into ventas (id, local_id, usuario_id, terminal, creada_en, medio_pago, total, total_lista, paga_con, turno_id,
                      giftcard_id, giftcard_monto, cambio_de, credito_cambio, descuento, prueba)
  values ((v->>'id')::uuid, (v->>'local_id')::int, usuario, v->>'terminal', (v->>'creada_en')::timestamptz,
          v->>'medio_pago', (v->>'total')::numeric, (v->>'total_lista')::numeric, nullif(v->>'paga_con','')::numeric,
          nullif(v->>'turno_id','')::uuid, gc_id, gc_monto, orig, coalesce(nullif(v->>'credito_cambio','')::numeric, 0),
          case when jsonb_typeof(v->'descuento') = 'object' then v->'descuento' end, es_prueba)
  on conflict (id) do nothing;
  get diagnostics i = row_count;
  if i = 0 then return false; end if; -- ya estaba registrada

  if gc_monto > 0 then
    update giftcards set saldo = saldo - gc_monto where id = gc_id and not anulada and saldo >= gc_monto;
    if not found then raise exception 'La gift card no tiene saldo suficiente o no existe'; end if;
    insert into giftcard_movimientos (giftcard_id, venta_id, monto) values (gc_id, (v->>'id')::uuid, -gc_monto);
  end if;

  if g is not null and jsonb_typeof(g) = 'object' then
    insert into giftcards (id, codigo, monto, saldo, medio_origen, local_id, venta_id, creada_en, prueba)
    values ((g->>'id')::uuid, upper(left(replace(g->>'id', '-', ''), 8)), (g->>'monto')::numeric, (g->>'monto')::numeric,
            g->>'medio', (v->>'local_id')::int, (v->>'id')::uuid, (v->>'creada_en')::timestamptz, es_prueba);
  end if;

  i := 0;
  for it in select * from jsonb_array_elements(v->'items') loop
    i := i + 1;
    insert into venta_items (venta_id, n, producto_id, barcode, sku, nombre, cantidad, precio_unitario, total)
    values ((v->>'id')::uuid, i, nullif(it->>'producto_id','')::uuid, it->>'barcode', it->>'sku', it->>'nombre',
            (it->>'cantidad')::numeric, (it->>'precio_unitario')::numeric, (it->>'total')::numeric);
    if nullif(it->>'producto_id','') is not null and not es_prueba then
      -- vender resta stock; devolver (cantidad negativa) lo suma
      insert into stock (producto_id, local_id, cantidad)
      values ((it->>'producto_id')::uuid, (v->>'local_id')::int, -(it->>'cantidad')::numeric)
      on conflict (producto_id, local_id) do update set cantidad = stock.cantidad + excluded.cantidad;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;

-- Igual que la versión de 0011; anular una venta de prueba no devuelve stock (nunca lo descontó).
create or replace function public.anular_venta(venta uuid, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; g record;
begin
  select * into v from ventas where id = venta and not anulada for update;
  if not found then return false; end if;
  select * into g from giftcards where venta_id = venta for update;
  if found then
    if g.saldo < g.monto then raise exception 'La gift card % ya se usó: no se puede anular esta venta', g.codigo; end if;
    update giftcards set anulada = true, saldo = 0 where id = g.id;
  end if;
  if v.giftcard_monto > 0 then
    update giftcards set saldo = saldo + v.giftcard_monto where id = v.giftcard_id;
    insert into giftcard_movimientos (giftcard_id, venta_id, monto) values (v.giftcard_id, venta, v.giftcard_monto);
  end if;
  update ventas set anulada = true, anulada_en = now(), anulada_por = usuario where id = venta;
  if not v.prueba then
    update stock s set cantidad = s.cantidad + vi.cantidad
    from venta_items vi where vi.venta_id = venta and vi.producto_id = s.producto_id and s.local_id = v.local_id;
  end if;
  return true;
end $$;
revoke execute on function public.anular_venta(uuid, uuid) from public, anon, authenticated;

-- Borra todo lo de las cajas de prueba ya cerradas: ventas, gift cards de prueba, pagos de cuentas
-- corrientes, retiros y la caja. No toca nada real (el stock nunca se descontó).
create or replace function public.borrar_cajas_prueba()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  turnos uuid[]; ventas_p uuid[]; n_ventas int; n_turnos int; n_gc int;
begin
  select coalesce(array_agg(id), '{}') into turnos from turnos_caja where prueba and cerrada_en is not null;
  -- Las de una caja de prueba que sigue abierta no se tocan
  select coalesce(array_agg(id), '{}') into ventas_p from ventas
    where turno_id = any(turnos)
       or (prueba and (turno_id is null or turno_id not in (select id from turnos_caja where cerrada_en is null)));
  delete from giftcard_movimientos where venta_id = any(ventas_p)
     or giftcard_id in (select id from giftcards where venta_id = any(ventas_p));
  delete from giftcards where venta_id = any(ventas_p);
  get diagnostics n_gc = row_count;
  -- primero los cambios (apuntan a la venta original)
  delete from ventas where id = any(ventas_p) and cambio_de is not null;
  delete from ventas where id = any(ventas_p);
  get diagnostics n_ventas = row_count;
  delete from cc_pagos where turno_id = any(turnos);
  delete from caja_movimientos where turno_id = any(turnos);
  delete from terminales where turno_id = any(turnos);
  delete from turnos_caja where id = any(turnos) and prueba;
  get diagnostics n_turnos = row_count;
  return jsonb_build_object('cajas', n_turnos, 'ventas', n_ventas, 'giftcards', n_gc);
end $$;
revoke execute on function public.borrar_cajas_prueba() from public, anon, authenticated;
