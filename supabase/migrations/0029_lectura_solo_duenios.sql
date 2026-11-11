-- Las pantallas del sistema leen todo desde el servidor (con la llave privada), así que estas
-- reglas no cambian nada en la caja ni en las pantallas. Cierran la puerta de atrás: con la sesión
-- de un colaborador ya no se pueden consultar directamente ventas, cierres ni movimientos.
do $$
declare t text; pol text;
begin
  for t, pol in values
    ('ventas', 'ver ventas'), ('venta_items', 'ver items'),
    ('turnos_caja', 'ver turnos'), ('caja_movimientos', 'ver movimientos'),
    ('stock', 'ver stock'), ('stock_movimientos', 'ver movimientos de stock'),
    ('producto_codigos', 'ver codigos')
  loop
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.es_duenio())', pol, t);
  end loop;
end $$;
