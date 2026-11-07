-- Ventas viejas importadas de Aronium (historial para reportes).
-- No tocan stock, cierres, facturación ni cambios: solo se ven en Ventas y Reportes.
alter table public.ventas add column if not exists origen text;          -- null = vendida en este sistema; 'aronium' = importada
alter table public.venta_items add column if not exists costo numeric(14,2); -- costo unitario al momento de la venta (si se sabe)
create index if not exists ventas_origen on public.ventas (origen) where origen is not null;
