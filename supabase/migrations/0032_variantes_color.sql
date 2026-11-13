-- Variantes de color.
-- Un producto puede tener colores (columna "Colores" de Precios Deco). Cada color tiene su propio stock por local
-- y su código interno (SKU + "-" + 3 letras, ej. 1954/3-NEG). El código de barras y el SKU del producto no cambian.
-- El stock del producto (tabla stock) pasa a ser la suma de sus colores activos: lo mantiene un trigger.

create table if not exists public.producto_variantes (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid not null references public.productos(id) on delete cascade,
  color          text not null,
  sku_variante   text not null,
  activo         boolean not null default true,
  orden          int not null default 0,
  tn_variante_id bigint,                 -- id de la variante en Tiendanube
  tn_precio      numeric(14,2),
  tn_stock       numeric(12,2),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists producto_variantes_color on public.producto_variantes (producto_id, lower(color));
create unique index if not exists producto_variantes_sku on public.producto_variantes (producto_id, sku_variante);
create index if not exists producto_variantes_tn on public.producto_variantes (tn_variante_id) where tn_variante_id is not null;

create table if not exists public.stock_variantes (
  variante_id uuid not null references public.producto_variantes(id) on delete cascade,
  local_id    int  not null references public.locales(id),
  cantidad    numeric(12,2) not null default 0,
  primary key (variante_id, local_id)
);

alter table public.venta_items add column if not exists variante_id uuid references public.producto_variantes(id);
alter table public.venta_items add column if not exists color text;
alter table public.stock_movimientos add column if not exists variante_id uuid references public.producto_variantes(id) on delete set null;
alter table public.pedidos_web_items add column if not exists variante_id uuid references public.producto_variantes(id);
alter table public.pedidos_web_items add column if not exists color text;

-- Lectura: igual que el resto del stock (solo dueños desde afuera; el sistema lee con la llave del servidor)
alter table public.producto_variantes enable row level security;
alter table public.stock_variantes enable row level security;
drop policy if exists "ver variantes" on public.producto_variantes;
create policy "ver variantes" on public.producto_variantes for select to authenticated using (public.es_duenio());
drop policy if exists "ver stock variantes" on public.stock_variantes;
create policy "ver stock variantes" on public.stock_variantes for select to authenticated using (public.es_duenio());

-- Stock del producto = suma de sus colores activos
create or replace function public.recalcular_stock_producto(p_producto uuid, p_local int)
returns void language plpgsql security definer set search_path = public as $$
declare total numeric;
begin
  if not exists (select 1 from producto_variantes where producto_id = p_producto) then return; end if;
  select coalesce(sum(sv.cantidad), 0) into total
    from stock_variantes sv join producto_variantes pv on pv.id = sv.variante_id
    where pv.producto_id = p_producto and pv.activo and sv.local_id = p_local;
  insert into stock (producto_id, local_id, cantidad) values (p_producto, p_local, total)
    on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
end $$;
revoke execute on function public.recalcular_stock_producto(uuid, int) from public, anon, authenticated;

create or replace function public.tg_stock_variantes()
returns trigger language plpgsql security definer set search_path = public as $$
declare prod uuid;
begin
  if tg_op = 'DELETE' then
    select producto_id into prod from producto_variantes where id = old.variante_id;
    if prod is not null then perform recalcular_stock_producto(prod, old.local_id); end if;
    return old;
  end if;
  select producto_id into prod from producto_variantes where id = new.variante_id;
  perform recalcular_stock_producto(prod, new.local_id);
  return new;
end $$;
drop trigger if exists stock_variantes_suma on public.stock_variantes;
create trigger stock_variantes_suma after insert or update or delete on public.stock_variantes
  for each row execute function public.tg_stock_variantes();

-- Activar o desactivar un color cambia la suma en los dos locales
create or replace function public.tg_producto_variantes()
returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if tg_op = 'UPDATE' and new.activo is not distinct from old.activo then return new; end if;
  for l in select id from locales loop
    perform recalcular_stock_producto(coalesce(new.producto_id, old.producto_id), l.id);
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists producto_variantes_activo on public.producto_variantes;
create trigger producto_variantes_activo after insert or update on public.producto_variantes
  for each row execute function public.tg_producto_variantes();

-- Suma o resta unidades de un color (y deja el movimiento si se pide). Devuelve la cantidad anterior.
create or replace function public.mover_stock_variante(p_variante uuid, p_local int, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare ant numeric;
begin
  select cantidad into ant from stock_variantes where variante_id = p_variante and local_id = p_local for update;
  ant := coalesce(ant, 0);
  insert into stock_variantes (variante_id, local_id, cantidad) values (p_variante, p_local, ant + p_delta)
    on conflict (variante_id, local_id) do update set cantidad = excluded.cantidad;
  return ant;
end $$;
revoke execute on function public.mover_stock_variante(uuid, int, numeric) from public, anon, authenticated;

-- ---------- Ventas ----------
-- Igual que 0030, más: cada producto puede traer variante_id y color; si trae color, se mueve el stock de ese color.
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
  var uuid; col text;
  es_prueba boolean := coalesce((v->>'prueba')::boolean, false)
    or exists (select 1 from turnos_caja where id = nullif(v->>'turno_id','')::uuid and prueba);
begin
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
                 and variante_id is not distinct from nullif(it->>'variante_id','')::uuid
              or (it->>'producto_id') is null and producto_id is null and nombre = nombre_base);
        select coalesce(sum(-vi.cantidad), 0) into devuelto from venta_items vi join ventas x on x.id = vi.venta_id
          where x.cambio_de = orig and not x.anulada and vi.cantidad < 0
            and ((it->>'producto_id') is not null and vi.producto_id = (it->>'producto_id')::uuid
                 and vi.variante_id is not distinct from nullif(it->>'variante_id','')::uuid
              or (it->>'producto_id') is null and vi.producto_id is null and vi.nombre = it->>'nombre');
        if devuelto - (it->>'cantidad')::numeric > vendido then
          raise exception 'De "%" ya se devolvió todo lo que se había vendido', nombre_base;
        end if;
      end if;
    end loop;
  end if;

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
  if i = 0 then return false; end if;

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
    -- El color tiene que ser de ese producto (si no, se guarda sin color)
    select pv.id, pv.color into var, col from producto_variantes pv
      where pv.id = nullif(it->>'variante_id','')::uuid and pv.producto_id = nullif(it->>'producto_id','')::uuid;
    insert into venta_items (venta_id, n, producto_id, barcode, sku, nombre, cantidad, precio_unitario, total, variante_id, color)
    values ((v->>'id')::uuid, i, nullif(it->>'producto_id','')::uuid, it->>'barcode', it->>'sku', it->>'nombre',
            (it->>'cantidad')::numeric, (it->>'precio_unitario')::numeric, (it->>'total')::numeric, var, col);
    if nullif(it->>'producto_id','') is not null and not es_prueba then
      if var is not null then
        perform mover_stock_variante(var, (v->>'local_id')::int, -(it->>'cantidad')::numeric);
      else
        insert into stock (producto_id, local_id, cantidad)
        values ((it->>'producto_id')::uuid, (v->>'local_id')::int, -(it->>'cantidad')::numeric)
        on conflict (producto_id, local_id) do update set cantidad = stock.cantidad + excluded.cantidad;
      end if;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;

create or replace function public.anular_venta(venta uuid, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; g record; vi record;
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
    update stock s set cantidad = s.cantidad + x.cantidad
    from venta_items x where x.venta_id = venta and x.variante_id is null and x.producto_id = s.producto_id and s.local_id = v.local_id;
    for vi in select variante_id, cantidad from venta_items where venta_id = venta and variante_id is not null loop
      perform mover_stock_variante(vi.variante_id, v.local_id, vi.cantidad);
    end loop;
  end if;
  return true;
end $$;
revoke execute on function public.anular_venta(uuid, uuid) from public, anon, authenticated;

-- ---------- Carga de mercadería y control ----------
-- Cada producto puede traer variante_id. Un producto con colores tiene que venir con color.
create or replace function public.aplicar_stock(p_local int, p_tipo text, p_items jsonb, p_completo boolean, p_usuario uuid, p_nota text)
returns int language plpgsql security definer set search_path = public as $$
declare
  it jsonb; prod uuid; var uuid; cant numeric; ant numeric; nuevo numeric; cambiados int := 0; r record;
begin
  if p_tipo not in ('ingreso','conteo') then raise exception 'tipo inválido'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    prod := (it->>'producto_id')::uuid;
    var := nullif(it->>'variante_id','')::uuid;
    cant := (it->>'cantidad')::numeric;
    if var is not null then
      if not exists (select 1 from producto_variantes where id = var and producto_id = prod) then raise exception 'color inválido'; end if;
      select cantidad into ant from stock_variantes where variante_id = var and local_id = p_local for update;
      ant := coalesce(ant, 0);
      nuevo := case when p_tipo = 'ingreso' then ant + cant else cant end;
      insert into stock_variantes (variante_id, local_id, cantidad) values (var, p_local, nuevo)
        on conflict (variante_id, local_id) do update set cantidad = excluded.cantidad;
    else
      if exists (select 1 from producto_variantes where producto_id = prod and activo) then
        raise exception 'Falta elegir el color de "%"', (select nombre from productos where id = prod);
      end if;
      select cantidad into ant from stock where producto_id = prod and local_id = p_local for update;
      ant := coalesce(ant, 0);
      nuevo := case when p_tipo = 'ingreso' then ant + cant else cant end;
      insert into stock (producto_id, local_id, cantidad) values (prod, p_local, nuevo)
        on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    end if;
    if nuevo <> ant then
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id, variante_id)
      values (prod, p_local, p_tipo, nuevo - ant, ant, nuevo, p_nota, p_usuario, var);
      cambiados := cambiados + 1;
    end if;
  end loop;

  if p_tipo = 'conteo' and p_completo then
    -- Colores que no se contaron: quedan en 0
    for r in select sv.variante_id, sv.cantidad, pv.producto_id from stock_variantes sv join producto_variantes pv on pv.id = sv.variante_id
             where sv.local_id = p_local and sv.cantidad <> 0
               and sv.variante_id not in (select (x->>'variante_id')::uuid from jsonb_array_elements(p_items) x where nullif(x->>'variante_id','') is not null) loop
      update stock_variantes set cantidad = 0 where variante_id = r.variante_id and local_id = p_local;
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id, variante_id)
      values (r.producto_id, p_local, 'conteo', -r.cantidad, r.cantidad, 0, coalesce(p_nota, '') || ' (no se contó: queda en 0)', p_usuario, r.variante_id);
      cambiados := cambiados + 1;
    end loop;
    -- Productos sin colores que no se contaron
    for r in select s.producto_id, s.cantidad from stock s
             where s.local_id = p_local and s.cantidad <> 0
               and not exists (select 1 from producto_variantes pv where pv.producto_id = s.producto_id)
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

create or replace function public.transferir_stock(p_desde int, p_hasta int, p_items jsonb, p_usuario uuid, p_nota text)
returns int language plpgsql security definer set search_path = public as $$
declare
  it jsonb; prod uuid; var uuid; cant numeric; ant numeric; n int := 0;
  nota text := coalesce(nullif(p_nota, ''), 'Transferencia');
begin
  if p_desde = p_hasta or p_desde not in (1, 2) or p_hasta not in (1, 2) then raise exception 'locales inválidos'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    prod := (it->>'producto_id')::uuid;
    var := nullif(it->>'variante_id','')::uuid;
    cant := (it->>'cantidad')::numeric;
    if cant is null or cant <= 0 then continue; end if;
    if var is not null then
      if not exists (select 1 from producto_variantes where id = var and producto_id = prod) then raise exception 'color inválido'; end if;
      ant := mover_stock_variante(var, p_desde, -cant);
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id, variante_id)
      values (prod, p_desde, 'transferencia', -cant, ant, ant - cant, nota || ' → ' || (select nombre from locales where id = p_hasta), p_usuario, var);
      ant := mover_stock_variante(var, p_hasta, cant);
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id, variante_id)
      values (prod, p_hasta, 'transferencia', cant, ant, ant + cant, nota || ' ← ' || (select nombre from locales where id = p_desde), p_usuario, var);
    else
      if exists (select 1 from producto_variantes where producto_id = prod and activo) then
        raise exception 'Falta elegir el color de "%"', (select nombre from productos where id = prod);
      end if;
      select cantidad into ant from stock where producto_id = prod and local_id = p_desde for update;
      ant := coalesce(ant, 0);
      insert into stock (producto_id, local_id, cantidad) values (prod, p_desde, ant - cant)
        on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
      values (prod, p_desde, 'transferencia', -cant, ant, ant - cant, nota || ' → ' || (select nombre from locales where id = p_hasta), p_usuario);
      select cantidad into ant from stock where producto_id = prod and local_id = p_hasta for update;
      ant := coalesce(ant, 0);
      insert into stock (producto_id, local_id, cantidad) values (prod, p_hasta, ant + cant)
        on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
      insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, usuario_id)
      values (prod, p_hasta, 'transferencia', cant, ant, ant + cant, nota || ' ← ' || (select nombre from locales where id = p_desde), p_usuario);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.transferir_stock(int, int, jsonb, uuid, text) from public, anon, authenticated;

-- ---------- Pedidos online ----------
create or replace function public.stock_pedido_web(p_pedido bigint, p_signo int)
returns int language plpgsql security definer set search_path = public as $$
declare
  ped record; it record; ant numeric; n int := 0;
  nota text;
begin
  if p_signo not in (-1, 1) then raise exception 'signo inválido'; end if;
  select * into ped from pedidos_web where id = p_pedido for update;
  if not found then raise exception 'pedido inexistente'; end if;
  if (p_signo = -1 and ped.stock_descontado) or (p_signo = 1 and not ped.stock_descontado) then return 0; end if;
  nota := case when p_signo = -1 then 'Pedido online #' else 'Cancelado pedido online #' end || ped.numero;
  for it in select * from pedidos_web_items where pedido_id = p_pedido and producto_id is not null and local_id is not null loop
    if it.variante_id is not null then
      ant := mover_stock_variante(it.variante_id, it.local_id, p_signo * it.cantidad);
    else
      select cantidad into ant from stock where producto_id = it.producto_id and local_id = it.local_id for update;
      ant := coalesce(ant, 0);
      insert into stock (producto_id, local_id, cantidad) values (it.producto_id, it.local_id, ant + p_signo * it.cantidad)
        on conflict (producto_id, local_id) do update set cantidad = excluded.cantidad;
    end if;
    insert into stock_movimientos (producto_id, local_id, tipo, cantidad, antes, despues, nota, variante_id)
    values (it.producto_id, it.local_id, 'web', p_signo * it.cantidad, ant, ant + p_signo * it.cantidad, nota, it.variante_id);
    n := n + 1;
  end loop;
  update pedidos_web set stock_descontado = (p_signo = -1) where id = p_pedido;
  return n;
end $$;
revoke execute on function public.stock_pedido_web(bigint, int) from public, anon, authenticated;

-- Borrar pruebas: también el stock por color
create or replace function public.borrar_pruebas(hasta timestamptz, incluir_ventas boolean, incluir_stock boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb := '{}'::jsonb;
  n int;
begin
  if incluir_ventas then
    delete from giftcard_movimientos
      where venta_id in (select id from ventas where creada_en < hasta and origen is null)
         or giftcard_id in (select id from giftcards where creada_en < hasta);
    delete from giftcards where creada_en < hasta or venta_id in (select id from ventas where creada_en < hasta and origen is null);
    get diagnostics n = row_count; r := r || jsonb_build_object('giftcards', n);
    delete from ventas where creada_en < hasta and origen is null;
    get diagnostics n = row_count; r := r || jsonb_build_object('ventas', n);
    delete from caja_movimientos where turno_id in (select id from turnos_caja where abierta_en < hasta);
    delete from turnos_caja where abierta_en < hasta;
    get diagnostics n = row_count; r := r || jsonb_build_object('cajas', n);
    delete from terminales where turno_id is null or turno_id not in (select id from turnos_caja);
  end if;
  if incluir_stock then
    delete from stock_movimientos where creado_en < hasta;
    get diagnostics n = row_count; r := r || jsonb_build_object('movimientos_stock', n);
    delete from stock_variantes where true;
    delete from stock where true;
    get diagnostics n = row_count; r := r || jsonb_build_object('stock', n);
  end if;
  return r;
end $$;
revoke execute on function public.borrar_pruebas(timestamptz, boolean, boolean) from public, anon, authenticated;
