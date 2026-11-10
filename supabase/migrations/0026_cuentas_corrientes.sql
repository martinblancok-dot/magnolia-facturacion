-- Cuentas corrientes de clientas (solo Martín y Sofi venden y cobran con ellas).
-- Deuda = ventas a cuenta (incluye cambios: pueden restar) − pagos. Todo se lee desde el servidor.

create table if not exists public.clientes_cc (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  dni        text,
  notas      text,
  limite     numeric(14,2) not null default 100000,  -- pasado esto avisa; al doble no deja vender
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

alter table public.ventas add column if not exists cliente_cc_id uuid references public.clientes_cc(id);
create index if not exists ventas_cliente_cc on public.ventas (cliente_cc_id) where cliente_cc_id is not null;

alter table public.ventas drop constraint if exists ventas_medio_pago_check;
alter table public.ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo','transferencia','debito','credito','cuotas','qr','giftcard','cambio','cuenta'));

create table if not exists public.cc_pagos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes_cc(id),
  monto          numeric(14,2) not null check (monto > 0),
  medio          text not null check (medio in ('efectivo','transferencia','debito','credito','cuotas','qr')),
  turno_id       uuid,               -- si entró a una caja abierta (efectivo)
  movimiento_id  uuid,               -- el "ingreso" que se anotó en esa caja
  local_id       int,
  nota           text,
  usuario_id     uuid references auth.users(id),
  creado_en      timestamptz not null default now(),
  anulado        boolean not null default false
);
create index if not exists cc_pagos_cliente on public.cc_pagos (cliente_id);
create index if not exists cc_pagos_fecha on public.cc_pagos (creado_en);

alter table public.clientes_cc enable row level security;
alter table public.cc_pagos enable row level security;
-- sin políticas: solo el servidor (con la clave de servicio) lee y escribe
