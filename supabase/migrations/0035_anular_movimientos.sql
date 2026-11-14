-- Anular retiros, gastos e ingresos de caja (solo dueños). No se borran: quedan tachados con quién, cuándo y por qué.
alter table public.caja_movimientos add column if not exists anulado boolean not null default false;
alter table public.caja_movimientos add column if not exists anulado_en timestamptz;
alter table public.caja_movimientos add column if not exists anulado_por uuid references auth.users(id);
alter table public.caja_movimientos add column if not exists motivo_anulacion text;
-- Un cierre que se recalculó por una anulación
alter table public.turnos_caja add column if not exists corregido_en timestamptz;
