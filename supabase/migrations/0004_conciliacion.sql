-- Cobros que ya tenían factura hecha a mano en ARCA
alter type estado_cobro add value if not exists 'ya_facturado';

alter table public.cobros
  add column comprobante_id uuid references public.comprobantes_arca(id) on delete set null,
  add column no_conciliar   boolean not null default false; -- el usuario dijo "no era esta"

create unique index cobros_comprobante_unico on public.cobros (comprobante_id) where comprobante_id is not null;
