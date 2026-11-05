-- Borrar los datos de prueba de la caja (ventas, cajas, gift cards y, si se pide, el stock).
-- No toca productos, cobros de Mercado Pago, facturas de ARCA ni usuarios.
create or replace function public.borrar_pruebas(hasta timestamptz, incluir_ventas boolean, incluir_stock boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb := '{}'::jsonb;
  n int;
begin
  if incluir_ventas then
    delete from giftcard_movimientos
      where venta_id in (select id from ventas where creada_en < hasta)
         or giftcard_id in (select id from giftcards where creada_en < hasta);
    delete from giftcards where creada_en < hasta or venta_id in (select id from ventas where creada_en < hasta);
    get diagnostics n = row_count; r := r || jsonb_build_object('giftcards', n);
    delete from ventas where creada_en < hasta;               -- los productos de cada venta se borran solos
    get diagnostics n = row_count; r := r || jsonb_build_object('ventas', n);
    delete from caja_movimientos where turno_id in (select id from turnos_caja where abierta_en < hasta);
    delete from turnos_caja where abierta_en < hasta;
    get diagnostics n = row_count; r := r || jsonb_build_object('cajas', n);
    delete from terminales where turno_id is null or turno_id not in (select id from turnos_caja);
  end if;
  if incluir_stock then
    delete from stock_movimientos where creado_en < hasta;
    get diagnostics n = row_count; r := r || jsonb_build_object('movimientos_stock', n);
    delete from stock;                                         -- todo el stock vuelve a 0
    get diagnostics n = row_count; r := r || jsonb_build_object('stock', n);
  end if;
  return r;
end $$;
revoke execute on function public.borrar_pruebas(timestamptz, boolean, boolean) from public, anon, authenticated;
