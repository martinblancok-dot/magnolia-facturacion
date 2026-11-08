-- Desde ahora lo que se cuenta en el arqueo es lo que queda en la caja.
-- Corrige los cierres ya hechos con la pantalla anterior (donde se escribía a mano cuánto quedaba),
-- para que la apertura de mañana compare contra lo contado.
update public.turnos_caja
   set deja_en_caja = efectivo_contado
 where cerrada_en is not null
   and efectivo_contado is not null
   and deja_en_caja is distinct from efectivo_contado
   and cerrada_en >= '2026-11-07T00:00:00-03:00';
