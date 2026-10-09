-- ==================================================================
-- STOCK DONADO. Lo que llega en la caja de donaciones no entra directo
-- en los bancos: primero queda como «donado» hasta que la Junta lo revisa
-- (la ropa puede estar rota, un libro muy estropeado...). Desde ahí, con
-- un clic, pasa al stock real del Banco de Uniformes o del Banco de Libros
-- (los libros, con el código que se les pega), o se descarta.
-- Requiere migracion-donaciones.sql. Se puede ejecutar varias veces.
-- ==================================================================
alter table donaciones add column if not exists recibida_en timestamptz;
-- Las que ya estaban marcadas como recibidas (antes de existir esta columna)
update donaciones set recibida_en = created_at where estado = 'recibida' and recibida_en is null;

create table if not exists donado_stock (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,            -- libros:<id> · uniformes:<tipo>:<talla> · instrumentos:<art> · extraescolares:<art>:<talla>
  categoria text not null check (categoria in ('libros','uniformes','instrumentos','extraescolares')),
  libro_id uuid references libros_catalogo(id) on delete cascade,
  articulo text,                          -- título del libro, tipo de prenda o artículo
  detalle text,                           -- curso del libro o talla
  cantidad integer not null default 0 check (cantidad >= 0),
  updated_at timestamptz not null default now()
);
alter table donado_stock enable row level security;
drop policy if exists "junta ve el stock donado" on donado_stock;
create policy "junta ve el stock donado" on donado_stock for select using (is_admin());

create table if not exists donado_movimientos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  clave text not null,
  texto text not null,
  cantidad integer not null,
  accion text not null check (accion in ('entra','al_banco','descartado')),
  nota text,
  donacion_id uuid references donaciones(id) on delete set null,
  creado_por_nombre text
);
alter table donado_movimientos enable row level security;
drop policy if exists "junta ve los movimientos del donado" on donado_movimientos;
create policy "junta ve los movimientos del donado" on donado_movimientos for select using (is_admin());

create or replace function _donado_texto(d donado_stock) returns text language sql immutable as $$
  select case d.categoria
    when 'libros' then 'Libro: ' || d.articulo || coalesce(' (' || d.detalle || ')', '')
    when 'uniformes' then 'Uniforme: ' || d.articulo || ', talla ' || d.detalle
    when 'instrumentos' then 'Instrumento: ' || d.articulo
    else 'Extraescolares: ' || d.articulo || coalesce(', talla ' || d.detalle, '') end
$$;

-- La Junta confirma lo que ha llegado en la caja de una donación (puede
-- corregir las cantidades: lo que de verdad había). Entra en el stock donado.
create or replace function donaciones_recibir(p_donacion uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_don donaciones; v_it jsonb; v_cant integer; v_clave text; v_fila donado_stock; v_nombre text;
  v_libro libros_catalogo;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  select * into v_don from donaciones where id = p_donacion for update;
  if not found then raise exception 'No existe esa donación.'; end if;
  if v_don.recibida_en is not null then raise exception 'Esta donación ya se recibió.'; end if;
  select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_cant := coalesce((v_it->>'cantidad')::integer, 0);
    continue when v_cant <= 0;
    if v_it->>'categoria' = 'libros' then
      select * into v_libro from libros_catalogo where id = (v_it->>'libro_id')::uuid;
      if not found then raise exception 'Un libro de la donación ya no está en el catálogo.'; end if;
      v_clave := 'libros:' || v_libro.id;
      insert into donado_stock (clave, categoria, libro_id, articulo, detalle, cantidad)
      values (v_clave, 'libros', v_libro.id, v_libro.titulo, v_libro.curso || ' de ' || v_libro.etapa, 0) on conflict (clave) do nothing;
    elsif v_it->>'categoria' = 'uniformes' then
      v_clave := 'uniformes:' || (v_it->>'tipo') || ':' || (v_it->>'talla');
      insert into donado_stock (clave, categoria, articulo, detalle, cantidad)
      values (v_clave, 'uniformes', v_it->>'tipo', v_it->>'talla', 0) on conflict (clave) do nothing;
    elsif v_it->>'categoria' in ('instrumentos', 'extraescolares') then
      v_clave := (v_it->>'categoria') || ':' || (v_it->>'articulo') || coalesce(':' || nullif(trim(v_it->>'talla'), ''), '');
      insert into donado_stock (clave, categoria, articulo, detalle, cantidad)
      values (v_clave, v_it->>'categoria', v_it->>'articulo', nullif(trim(v_it->>'talla'), ''), 0) on conflict (clave) do nothing;
    else
      continue;
    end if;
    update donado_stock set cantidad = cantidad + v_cant, updated_at = now() where clave = v_clave returning * into v_fila;
    insert into donado_movimientos (clave, texto, cantidad, accion, donacion_id, creado_por_nombre)
    values (v_clave, _donado_texto(v_fila), v_cant, 'entra', p_donacion, v_nombre);
  end loop;
  update donaciones set estado = 'recibida', recibida_en = now() where id = p_donacion;
end;
$$;
grant execute on function donaciones_recibir(uuid, jsonb) to authenticated;

-- Pasar al banco: uniformes al stock del Banco de Uniformes; libros como
-- ejemplares nuevos del Banco de Libros con sus códigos (uno por libro).
create or replace function donado_al_banco(p_id uuid, p_cantidad integer, p_codigos text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_fila donado_stock; v_nombre text; v_cod text;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  select * into v_fila from donado_stock where id = p_id for update;
  if not found then raise exception 'No existe en el stock donado.'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor que 0.'; end if;
  if p_cantidad > v_fila.cantidad then raise exception 'Solo hay % en el stock donado.', v_fila.cantidad; end if;
  if v_fila.categoria = 'uniformes' then
    perform uniformes_mover_stock(v_fila.articulo, v_fila.detalle, p_cantidad, 'sumar', 'Donación');
  elsif v_fila.categoria = 'libros' then
    if coalesce(array_length(p_codigos, 1), 0) <> p_cantidad then
      raise exception 'Escribe un código por cada libro (% códigos).', p_cantidad;
    end if;
    foreach v_cod in array p_codigos loop
      if exists (select 1 from libros_ejemplares where codigo = trim(v_cod)) then
        raise exception 'El código % ya existe en el Banco de Libros.', trim(v_cod);
      end if;
      insert into libros_ejemplares (libro_id, codigo) values (v_fila.libro_id, trim(v_cod));
    end loop;
  else
    raise exception 'Esto no tiene banco: se queda en el stock donado.';
  end if;
  update donado_stock set cantidad = cantidad - p_cantidad, updated_at = now() where id = p_id;
  select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
  insert into donado_movimientos (clave, texto, cantidad, accion, nota, creado_por_nombre)
  values (v_fila.clave, _donado_texto(v_fila), p_cantidad, 'al_banco',
          case when v_fila.categoria = 'libros' then 'Códigos: ' || array_to_string(p_codigos, ', ') end, v_nombre);
end;
$$;
grant execute on function donado_al_banco(uuid, integer, text[]) to authenticated;

-- Descartar (roto, muy estropeado...)
create or replace function donado_descartar(p_id uuid, p_cantidad integer, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_fila donado_stock; v_nombre text;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  select * into v_fila from donado_stock where id = p_id for update;
  if not found then raise exception 'No existe en el stock donado.'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor que 0.'; end if;
  if p_cantidad > v_fila.cantidad then raise exception 'Solo hay % en el stock donado.', v_fila.cantidad; end if;
  update donado_stock set cantidad = cantidad - p_cantidad, updated_at = now() where id = p_id;
  select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
  insert into donado_movimientos (clave, texto, cantidad, accion, nota, creado_por_nombre)
  values (v_fila.clave, _donado_texto(v_fila), p_cantidad, 'descartado', nullif(trim(coalesce(p_motivo, '')), ''), v_nombre);
end;
$$;
grant execute on function donado_descartar(uuid, integer, text) to authenticated;
