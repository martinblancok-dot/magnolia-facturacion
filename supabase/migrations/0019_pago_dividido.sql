-- Pago dividido en dos medios: [{ "medio": "efectivo", "monto": 50000 }, { "medio": "transferencia", "monto": 21250 }]
alter table public.ventas add column if not exists pagos jsonb;
