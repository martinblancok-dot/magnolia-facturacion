-- Conteo de billetes al abrir la caja: { billetes: {"20000": 2, ...}, monedas, esperado, diferencia, nota }
-- "esperado" es lo que se dejó en el último cierre de ese local; "diferencia" = contado - esperado.
alter table public.turnos_caja add column if not exists apertura jsonb;
