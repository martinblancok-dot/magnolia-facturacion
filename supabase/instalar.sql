-- TODO JUNTO: copiar y pegar entero en Supabase → SQL Editor → Run

-- Base de datos del sistema de facturación automática Magnolia.
-- Cada persona (Martín, Sofi) es un usuario de Supabase y solo ve lo suyo.

-- Datos de cada emisor (lo que no es secreto)
create table public.emisores (
  usuario_id    uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  cuit          text not null check (cuit ~ '^\d{11}$'),
  punto_venta   int,                        -- punto de venta "Web Services"
  ambiente      text not null default 'homologacion' check (ambiente in ('homologacion','produccion')),
  facturar_automatico boolean not null default false, -- se prende recién cuando todo esté probado
  creado_en     timestamptz not null default now()
);

-- Secretos cifrados. Nadie los lee desde el navegador: solo el servidor.
create table public.secretos (
  usuario_id        uuid primary key references auth.users(id) on delete cascade,
  clave_privada     text,   -- cifrada
  certificado_prueba text,  -- cifrado
  certificado_real  text,   -- cifrado
  mp_token          text,   -- cifrado (Mercado Pago)
  actualizado_en    timestamptz not null default now()
);

-- Ticket de acceso a ARCA (dura ~12 h; ARCA no deja pedir otro mientras siga vigente)
create table public.tickets_arca (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ambiente   text not null,
  token      text not null,
  sign       text not null,
  vence      timestamptz not null,
  primary key (usuario_id, ambiente)
);

-- Cada cobro que entra por Mercado Pago
create type estado_cobro as enum (
  'revisar',      -- transferencia u otro: alguien tiene que decir si es venta
  'a_facturar',   -- listo para facturar
  'enviando',     -- se está pidiendo el CAE
  'facturado',
  'no_es_venta',
  'error'         -- ARCA lo rechazó o no respondió: ver mensaje
);

create table public.cobros (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  mp_id       text not null,
  dia         date not null,
  fecha_hora  timestamptz not null,
  importe     numeric(14,2) not null check (importe > 0),
  origen      text not null check (origen in ('posnet','qr','transferencia','otro')),
  detalle     text,
  estado      estado_cobro not null,
  mensaje     text,
  creado_en   timestamptz not null default now(),
  unique (usuario_id, mp_id)
);
create index cobros_pendientes on public.cobros (usuario_id, estado, dia);

-- Facturas emitidas
create table public.facturas (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  cobro_id     uuid unique references public.cobros(id),
  ambiente     text not null,
  punto_venta  int not null,
  numero       int not null,
  fecha        date not null,
  importe      numeric(14,2) not null,
  cae          text not null,
  cae_vence    date not null,
  fuera_de_termino boolean not null default false,
  creado_en    timestamptz not null default now(),
  unique (usuario_id, ambiente, punto_venta, numero)
);

-- Seguridad: cada uno ve solo lo suyo
alter table public.emisores     enable row level security;
alter table public.secretos     enable row level security; -- sin políticas: solo el servidor
alter table public.tickets_arca enable row level security; -- sin políticas: solo el servidor
alter table public.cobros       enable row level security;
alter table public.facturas     enable row level security;

create policy "ver mi emisor"      on public.emisores for select using (auth.uid() = usuario_id);
create policy "editar mi emisor"   on public.emisores for update using (auth.uid() = usuario_id);
create policy "ver mis cobros"     on public.cobros   for select using (auth.uid() = usuario_id);
create policy "ver mis facturas"   on public.facturas for select using (auth.uid() = usuario_id);
-- Marcar un cobro como venta o no-venta se hace por el servidor, que valida el cambio.

-- Total facturado en el año (para comparar con el tope del monotributo)
create view public.facturado_por_mes with (security_invoker = true) as
  select usuario_id, ambiente, date_trunc('month', fecha)::date as mes, sum(importe) as total, count(*) as cantidad
  from public.facturas group by 1,2,3;

-- Datos que tienen que figurar impresos en la factura, y el tope de la categoría de monotributo.
alter table public.emisores
  add column domicilio          text,
  add column ingresos_brutos    text,
  add column inicio_actividades date,
  add column tope_anual         numeric(14,2);  -- tope de facturación de la categoría (opcional)

-- Para que cada uno pueda crear su propio emisor la primera vez
create policy "crear mi emisor" on public.emisores for insert with check (auth.uid() = usuario_id);
