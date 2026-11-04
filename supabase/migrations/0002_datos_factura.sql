-- Datos que tienen que figurar impresos en la factura, y el tope de la categoría de monotributo.
alter table public.emisores
  add column domicilio          text,
  add column ingresos_brutos    text,
  add column inicio_actividades date,
  add column tope_anual         numeric(14,2);  -- tope de facturación de la categoría (opcional)

-- Para que cada uno pueda crear su propio emisor la primera vez
create policy "crear mi emisor" on public.emisores for insert with check (auth.uid() = usuario_id);
