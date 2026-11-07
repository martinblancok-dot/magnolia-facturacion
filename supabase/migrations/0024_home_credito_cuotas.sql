-- En Aronium de Magnolia Home la "Tarjeta de Crédito" era en cuotas: las ventas viejas importadas pasan a "cuotas"
-- (para que Reportes descuente el costo de cobro en cuotas). Solo toca ventas importadas de Aronium de Home.
update public.ventas set medio_pago = 'cuotas'
 where origen = 'aronium' and local_id = 1 and medio_pago = 'credito';
