-- Tarea automática: cada 15 minutos llama al sistema para traer cobros y facturar.
-- Se corre UNA vez en Supabase (SQL Editor) cuando el sistema ya está publicado.
-- Antes de correrlo, reemplazar:
--   TU-DIRECCION  → la dirección del sistema publicado (ej: magnolia-facturacion.vercel.app)
--   TU-CRON-SECRET → el mismo valor de CRON_SECRET que se cargó al publicar

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'magnolia-procesar',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://TU-DIRECCION/api/procesar',
    headers := jsonb_build_object('Authorization', 'Bearer TU-CRON-SECRET')
  );
  $$
);

-- Para pausarla: select cron.unschedule('magnolia-procesar');
