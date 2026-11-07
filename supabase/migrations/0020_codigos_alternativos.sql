-- Varios códigos de barras por producto.
-- productos.barcode sigue siendo el código INTERNO (el de nuestras etiquetas, columna "Barcode" de la planilla).
-- Acá van los códigos ALTERNATIVOS: el original de fábrica/proveedor (columna "Barcode original" de la planilla)
-- o los que se agreguen a mano desde el sistema. Un producto puede tener varios; un código, un solo producto.

create table if not exists public.producto_codigos (
  codigo      text primary key,
  -- para comparar: sin espacios, en mayúsculas y, si es solo números, sin ceros adelante
  -- (algunos lectores mandan 0 + UPC de 12 dígitos y otros no)
  clave       text generated always as (
                case when btrim(codigo) ~ '^[0-9]+$' then coalesce(nullif(ltrim(btrim(codigo), '0'), ''), '0')
                     else upper(btrim(codigo)) end) stored unique,
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo        text not null default 'original' check (tipo in ('original', 'otro')),
  origen      text not null default 'planilla' check (origen in ('planilla', 'sistema')),
  creado_en   timestamptz not null default now()
);
create index if not exists producto_codigos_producto on public.producto_codigos (producto_id);

alter table public.producto_codigos enable row level security;
-- Todos los usuarios del sistema pueden leerlos (los colaboradores escanean); escribir, solo el servidor.
drop policy if exists "ver codigos" on public.producto_codigos;
create policy "ver codigos" on public.producto_codigos for select to authenticated using (true);

-- Un código alternativo no puede ser el código interno de OTRO producto
create or replace function public.validar_codigo_alternativo() returns trigger language plpgsql as $$
declare otro text;
begin
  select nombre into otro from public.productos
   where id <> new.producto_id
     and (barcode = btrim(new.codigo)
          or (btrim(new.codigo) ~ '^[0-9]+$' and barcode ~ '^[0-9]+$' and ltrim(barcode, '0') = ltrim(btrim(new.codigo), '0')))
   limit 1;
  if otro is not null then
    raise exception 'El código % ya es el código interno de "%"', new.codigo, otro;
  end if;
  return new;
end $$;
drop trigger if exists validar_codigo_alternativo on public.producto_codigos;
create trigger validar_codigo_alternativo before insert or update on public.producto_codigos
  for each row execute function public.validar_codigo_alternativo();

-- Y al revés: el código interno de un producto no puede ser el alternativo de otro
create or replace function public.validar_barcode_producto() returns trigger language plpgsql as $$
declare otro text;
begin
  select p.nombre into otro from public.producto_codigos c join public.productos p on p.id = c.producto_id
   where c.producto_id <> new.id
     and c.clave = case when btrim(new.barcode) ~ '^[0-9]+$' then coalesce(nullif(ltrim(btrim(new.barcode), '0'), ''), '0') else upper(btrim(new.barcode)) end
   limit 1;
  if otro is not null then
    raise exception 'El código % ya es un código alternativo de "%"', new.barcode, otro;
  end if;
  return new;
end $$;
drop trigger if exists validar_barcode_producto on public.productos;
create trigger validar_barcode_producto before insert or update of barcode on public.productos
  for each row execute function public.validar_barcode_producto();
