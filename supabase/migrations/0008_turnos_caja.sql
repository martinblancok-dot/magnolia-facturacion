-- Apertura y cierre de caja (turnos), retiros/gastos y arqueo.
-- Los ids los genera la caja, así se puede abrir y vender aunque no haya internet.

create table public.turnos_caja (
  id               uuid primary key,
  local_id         int not null references public.locales(id),
  terminal         text,
  abierta_en       timestamptz not null,
  abierta_por      uuid references auth.users(id),
  fondo_inicial    numeric(14,2) not null default 0,
  cerrada_en       timestamptz,
  cerrada_por      uuid references auth.users(id),
  efectivo_esperado numeric(14,2),
  efectivo_contado numeric(14,2),
  diferencia       numeric(14,2),
  deja_en_caja     numeric(14,2),               -- fondo para el día siguiente
  billetes         jsonb,                       -- detalle del conteo
  resumen          jsonb,                       -- foto del reporte al cerrar (ventas por medio, alertas)
  notas            text
);
create index turnos_local_fecha on public.turnos_caja (local_id, abierta_en desc);

create table public.caja_movimientos (
  id         uuid primary key,
  turno_id   uuid not null,                     -- sin FK: puede llegar antes que el turno si no hubo internet
  tipo       text not null check (tipo in ('retiro','gasto','ingreso')),
  monto      numeric(14,2) not null check (monto > 0),
  motivo     text,
  creado_en  timestamptz not null,
  usuario_id uuid references auth.users(id)
);
create index caja_mov_turno on public.caja_movimientos (turno_id);

alter table public.ventas add column if not exists turno_id uuid;
create index if not exists ventas_turno on public.ventas (turno_id);

-- registrar_venta ahora guarda también el turno
create or replace function public.registrar_venta(v jsonb, usuario uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  nueva boolean;
  it jsonb;
  i int := 0;
begin
  insert into ventas (id, local_id, usuario_id, terminal, creada_en, medio_pago, total, total_lista, paga_con, turno_id)
  values ((v->>'id')::uuid, (v->>'local_id')::int, usuario, v->>'terminal', (v->>'creada_en')::timestamptz,
          v->>'medio_pago', (v->>'total')::numeric, (v->>'total_lista')::numeric, nullif(v->>'paga_con','')::numeric,
          nullif(v->>'turno_id','')::uuid)
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
revoke execute on function public.registrar_venta(jsonb, uuid) from public, anon, authenticated;

alter table public.turnos_caja      enable row level security;
alter table public.caja_movimientos enable row level security;
create policy "ver turnos"      on public.turnos_caja      for select to authenticated using (true);
create policy "ver movimientos" on public.caja_movimientos for select to authenticated using (true);
