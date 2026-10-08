-- ============================================================
-- MIGRACIÓN: lo que aportaban las webs separadas de Libros y
-- Uniformes (ampa-libros-web / ampa-uniformes-web), integrado en el
-- portal. Se puede ejecutar más de una vez sin romper nada.
-- Requiere haber ejecutado antes migracion-gestion-cuentas.sql.
-- ============================================================

-- Pequeña ayuda: cambia la lista de valores permitidos de una columna
-- "estado" sin depender del nombre exacto de su restricción.
create or replace function _cambiar_check_estado(p_tabla text, p_valores text)
returns void language plpgsql as $$
declare v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
    where c.conrelid = ('public.' || p_tabla)::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table %I drop constraint %I', p_tabla, v_nombre);
  end loop;
  execute format('alter table %I add constraint %I check (estado in (%s))', p_tabla, p_tabla || '_estado_check', p_valores);
end;
$$;

-- ************************************************************
-- LIBROS
-- ************************************************************

-- 1. Un mismo título puede servir para VARIOS cursos (ej. Coraline en
--    1º y 2º ESO). Cada curso se guarda como 'Etapa|Curso' ('ESO|1º').
--    etapa/curso se mantienen como el curso "principal" (compatibilidad).
alter table libros_catalogo add column if not exists cursos text[];
update libros_catalogo set cursos = array[etapa || '|' || curso] where cursos is null or cardinality(cursos) = 0;

-- 2. Catálogo real (el de ampa-libros-web). Solo inserta los títulos que
--    todavía no existan (por título, sin distinguir mayúsculas).
insert into libros_catalogo (etapa, curso, cursos, titulo, editorial, isbn, asignatura)
select v.etapa, v.curso, v.cursos, v.titulo, v.editorial, v.isbn, v.asignatura
from (values
  ('Primaria','3º', array['Primaria|3º'], 'Un intruso en mi cuaderno', 'Edelvives', '9788414041079', 'Lengua'),
  ('Primaria','3º', array['Primaria|3º'], 'Lucas se tragó un dragón', 'Edelvives', '9788414060537', 'Lengua'),
  ('Primaria','3º', array['Primaria|3º'], 'Nasreddin - Ten stories', 'Black Cat', '9788853006998', 'Inglés'),
  ('Primaria','4º', array['Primaria|4º'], 'El Colegio de los animales mágicos', 'Edelvives', '9788426398482', 'Lengua'),
  ('Primaria','4º', array['Primaria|4º'], 'El monstruo y la bibliotecaria', 'Edelvives', '9788414052457', 'Lengua'),
  ('Primaria','4º', array['Primaria|4º'], 'The Lighthouse Ghost', 'Black Cat', '9788853018373 / 9788468270623', 'Inglés'),
  ('Primaria','5º', array['Primaria|5º'], 'El ojo que todo lo ve', 'Edelvives', '9788414060629', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], 'Aurora y en la hora', 'Edelvives', '9788414033357', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], '¿Dónde está Morrison?', 'Edelvives', '9788414010877', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], 'The Adventures of Tom Sawyer - versión Life Skills', 'Black Cat', '9788853016294 / 9788468250199', 'Inglés'),
  ('Primaria','6º', array['Primaria|6º'], 'El cartero de Bagdad', 'Edelvives', '9788426372864 / 9788426366252', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'El secreto de Enola', 'Edelvives', '9788414005576 / 9788414041178', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'Padres Padrísimos', 'Edelvives', '9788414017883 / 9786077460404', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'Tales from Camelot', 'Black Cat', '9788853016317', 'Inglés'),
  ('ESO','1º', array['ESO|1º','ESO|2º'], 'Coraline, Neil Gaiman', 'Bloomsbury', '9781408841754', 'Inglés'),
  ('ESO','1º', array['ESO|1º'], 'Unheimliches im Wald', 'Klett', '9783125570061', 'Alemán'),
  ('ESO','2º', array['ESO|2º'], 'Diebstahl im Museum', 'ELI', '9788853628794', 'Alemán'),
  ('ESO','3º', array['ESO|3º','ESO|4º'], 'The curious incident of the dog in the night-time, Mark Haddon', 'Vintage Books', '9780099450252', 'Inglés'),
  ('Bachillerato','1º', array['Bachillerato|1º'], 'The Outsiders, S.E. Hinton', 'Viking Books', '9780142407332', 'Inglés'),
  ('Bachillerato','2º', array['Bachillerato|2º'], 'Persépolis, de Marjane Satrapi', 'Pantheon Books', '9780375714573 / 9788417910143', 'Inglés')
) as v(etapa, curso, cursos, titulo, editorial, isbn, asignatura)
where not exists (select 1 from libros_catalogo l where lower(l.titulo) = lower(v.titulo));

-- 3. Registro de compras (reservado → comprado → obtenido), compartido
--    entre los admins, con quién y cuándo lo registró.
create table if not exists libros_compras (
  id uuid primary key default gen_random_uuid(),
  libro_id uuid not null references libros_catalogo(id) on delete cascade,
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'comprado' check (estado in ('reservado', 'comprado', 'recibido')),
  tienda text,
  coste numeric(10,2) check (coste is null or coste >= 0),
  creado_por uuid references adultos(id) on delete set null,
  creado_por_nombre text,           -- foto del nombre (también para compras importadas)
  actualizado_por_nombre text,
  actualizado_en timestamptz,
  created_at timestamptz not null default now()
);
alter table libros_compras enable row level security;
drop policy if exists "admins gestionan las compras de libros" on libros_compras;
create policy "admins gestionan las compras de libros" on libros_compras for all
  using (is_admin()) with check (is_admin());

-- 4. Entrega física y devolución de cada libro prestado
alter table prestamo_items add column if not exists entregado_en date;
alter table prestamo_items add column if not exists perdido boolean not null default false;
-- (fecha_devolucion ya existía: se rellena al marcarlo devuelto o perdido)

create or replace function prestamo_admin_entrega(p_item_id uuid, p_accion text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item prestamo_items;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.estado <> 'asignado' or v_item.ejemplar_id is null then
    raise exception 'Este libro no tiene ningún ejemplar asignado.';
  end if;

  if p_accion = 'entregar' then
    update prestamo_items set entregado_en = current_date where id = p_item_id;
  elsif p_accion = 'deshacer_entrega' then
    if v_item.fecha_devolucion is not null then raise exception 'Primero deshaz la devolución.'; end if;
    update prestamo_items set entregado_en = null where id = p_item_id;
  elsif p_accion in ('devuelto', 'perdido') then
    if v_item.entregado_en is null then raise exception 'Este libro todavía no se ha entregado.'; end if;
    update prestamo_items set fecha_devolucion = current_date, perdido = (p_accion = 'perdido') where id = p_item_id;
    update libros_ejemplares set estado = case when p_accion = 'perdido' then 'perdido' else 'disponible' end
      where id = v_item.ejemplar_id;
  elsif p_accion = 'deshacer_devolucion' then
    if v_item.fecha_devolucion is null then raise exception 'Este libro no estaba devuelto.'; end if;
    if exists (select 1 from prestamo_items o where o.ejemplar_id = v_item.ejemplar_id and o.id <> p_item_id
               and o.estado = 'asignado' and o.fecha_devolucion is null) then
      raise exception 'Ese ejemplar ya se ha vuelto a prestar a otra familia.';
    end if;
    update prestamo_items set fecha_devolucion = null, perdido = false where id = p_item_id;
    update libros_ejemplares set estado = 'prestado' where id = v_item.ejemplar_id;
  else
    raise exception 'Acción no reconocida.';
  end if;
end;
$$;
grant execute on function prestamo_admin_entrega(uuid, text) to authenticated;

-- Un libro ya entregado a la familia no se puede quitar ni cambiar desde
-- el reparto (hay que registrar antes su devolución).
create or replace function prestamo_admin_asignar(p_item_id uuid, p_ejemplar_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
  v_ejemplar libros_ejemplares;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.entregado_en is not null then raise exception 'Ese libro ya se entregó a la familia: no se puede cambiar.'; end if;

  select * into v_ejemplar from libros_ejemplares where id = p_ejemplar_id;
  if not found then raise exception 'El ejemplar no existe.'; end if;
  if v_ejemplar.libro_id <> v_item.libro_id then raise exception 'Ese ejemplar no es del mismo título que la solicitud.'; end if;
  if v_ejemplar.estado <> 'disponible' and v_item.ejemplar_id is distinct from p_ejemplar_id then
    raise exception 'Ese ejemplar no está disponible.';
  end if;

  if v_item.ejemplar_id is not null and v_item.ejemplar_id <> p_ejemplar_id then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;
  update libros_ejemplares set estado = 'prestado' where id = p_ejemplar_id;
  update prestamo_items
    set ejemplar_id = p_ejemplar_id, estado = 'asignado', fecha_asignacion = coalesce(fecha_asignacion, current_date)
    where id = p_item_id;
end;
$$;

create or replace function prestamo_admin_quitar(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item prestamo_items;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.entregado_en is not null then raise exception 'Ese libro ya se entregó a la familia: registra antes su devolución.'; end if;
  if v_item.ejemplar_id is not null then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;
  update prestamo_items set ejemplar_id = null, estado = 'no_asignado', fecha_asignacion = null where id = p_item_id;
end;
$$;

create or replace function prestamo_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if exists (select 1 from prestamo_items where convocatoria_id = p_convocatoria_id and entregado_en is not null) then
    raise exception 'Ya hay libros de esta convocatoria entregados a las familias: el reparto no se puede anular entero.';
  end if;
  update libros_ejemplares set estado = 'disponible'
    where id in (select ejemplar_id from prestamo_items where convocatoria_id = p_convocatoria_id and ejemplar_id is not null);
  update prestamo_items set ejemplar_id = null, estado = 'pendiente', fecha_asignacion = null
    where convocatoria_id = p_convocatoria_id and tipo = 'solicitud';
  update prestamo_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;

-- ************************************************************
-- CONVOCATORIAS (libros y uniformes): cerrar ya, cancelar, finalizar
-- ************************************************************
select _cambiar_check_estado('prestamo_convocatorias', '''abierta'',''repartida'',''cancelada''');
select _cambiar_check_estado('uniformes_convocatorias', '''abierta'',''repartida'',''finalizada'',''cancelada''');

alter table uniformes_convocatorias add column if not exists resumen_reparto jsonb;
alter table uniformes_convocatorias add column if not exists finalizada_en timestamptz;
alter table uniformes_convocatorias add column if not exists finalizada_por text;
alter table prestamo_convocatorias add column if not exists resumen_reparto jsonb;

-- Acciones sobre la convocatoria en marcha (la más reciente):
--   'cerrar'    -> adelanta el cierre del plazo a ahora mismo
--   'cancelar'  -> la archiva sin repartir (los pedidos se conservan)
--   'finalizar' -> (solo uniformes) cierra y guarda en firme un reparto:
--                  ya no se puede tocar y la familia ve su resultado
create or replace function convocatoria_admin_accion(p_tipo text, p_convocatoria_id uuid, p_accion text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tabla text;
  v_estado text;
  v_nombre text;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if p_tipo = 'prestamo' then v_tabla := 'prestamo_convocatorias';
  elsif p_tipo = 'uniformes' then v_tabla := 'uniformes_convocatorias';
  else raise exception 'Tipo de convocatoria no válido.'; end if;

  execute format('select estado from %I where id = $1', v_tabla) into v_estado using p_convocatoria_id;
  if v_estado is null then raise exception 'La convocatoria no existe.'; end if;

  if p_accion = 'cerrar' then
    if v_estado <> 'abierta' then raise exception 'Solo se puede cerrar el plazo de una convocatoria abierta.'; end if;
    execute format('update %I set fecha_cierre = now() where id = $1', v_tabla) using p_convocatoria_id;
  elsif p_accion = 'cancelar' then
    if v_estado <> 'abierta' then raise exception 'Solo se puede cancelar una convocatoria que todavía no se ha repartido.'; end if;
    execute format('update %I set estado = ''cancelada'' where id = $1', v_tabla) using p_convocatoria_id;
  elsif p_accion = 'finalizar' and p_tipo = 'uniformes' then
    if v_estado <> 'repartida' then raise exception 'Solo se puede cerrar y guardar una convocatoria ya repartida.'; end if;
    select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
    update uniformes_convocatorias set estado = 'finalizada', finalizada_en = now(), finalizada_por = v_nombre
      where id = p_convocatoria_id;
  else
    raise exception 'Acción no reconocida.';
  end if;
end;
$$;
grant execute on function convocatoria_admin_accion(text, uuid, text) to authenticated;

-- ************************************************************
-- UNIFORMES
-- ************************************************************

-- 5. Stock inicial (el de ampa-uniformes-web). Solo crea las
--    combinaciones que todavía no existan; nunca pisa un stock ya puesto.
insert into prendas_catalogo (tipo, talla, stock)
select v.tipo, v.talla, v.stock from (values
  ('Camiseta','1',1),('Camiseta','2',22),('Camiseta','4',12),('Camiseta','6',3),('Camiseta','8',10),
  ('Camiseta','14',4),('Camiseta','16',2),('Camiseta','20',3),
  ('Sudadera','1',6),('Sudadera','2',26),('Sudadera','3',9),('Sudadera','4',26),('Sudadera','6',12),
  ('Sudadera','8',11),('Sudadera','10',1),('Sudadera','12',1),('Sudadera','14',4),('Sudadera','16',3),('Sudadera','20',1),
  ('Pantalón Corto','1',1),('Pantalón Corto','2',13),('Pantalón Corto','4',6),('Pantalón Corto','6',10),
  ('Pantalón Corto','8',10),('Pantalón Corto','10',1),('Pantalón Corto','14',4),('Pantalón Corto','16',1),
  ('Pantalón Corto','18',1),('Pantalón Corto','20',1),
  ('Pantalón Largo','1',4),('Pantalón Largo','2',23),('Pantalón Largo','3',5),('Pantalón Largo','4',7),
  ('Pantalón Largo','8',9),('Pantalón Largo','10',4),('Pantalón Largo','14',2),('Pantalón Largo','16',2),('Pantalón Largo','18',2),
  ('Baby','1',7),('Baby','2',9),('Baby','4',3),('Baby','6',4)
) as v(tipo, talla, stock)
on conflict (tipo, talla) do nothing;

-- 6. Movimientos de stock: el catálogo ya no se edita número a número,
--    se registra lo que entra o sale (con historial).
create table if not exists prendas_movimientos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  talla text not null,
  cantidad integer not null,            -- positiva = entra, negativa = sale
  stock_resultante integer not null,
  motivo text,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
alter table prendas_movimientos enable row level security;
drop policy if exists "admins ven los movimientos de prendas" on prendas_movimientos;
create policy "admins ven los movimientos de prendas" on prendas_movimientos for select using (is_admin());

create or replace function uniformes_mover_stock(p_tipo text, p_talla text, p_cantidad integer, p_operacion text, p_motivo text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_prenda prendas_catalogo;
  v_delta integer;
  v_nombre text;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor que 0.'; end if;
  if p_operacion not in ('sumar', 'restar') then raise exception 'Operación no válida.'; end if;
  v_delta := case when p_operacion = 'sumar' then p_cantidad else -p_cantidad end;

  select * into v_prenda from prendas_catalogo where tipo = p_tipo and talla = p_talla for update;
  if not found then
    if p_operacion = 'restar' then raise exception 'No hay ninguna % talla % en el catálogo todavía.', p_tipo, p_talla; end if;
    insert into prendas_catalogo (tipo, talla, stock) values (p_tipo, p_talla, p_cantidad) returning * into v_prenda;
  else
    if v_prenda.stock + v_delta < 0 then
      raise exception 'Solo quedan % — no se pueden quitar %.', v_prenda.stock, p_cantidad;
    end if;
    update prendas_catalogo set stock = stock + v_delta where id = v_prenda.id returning * into v_prenda;
  end if;

  select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
  insert into prendas_movimientos (tipo, talla, cantidad, stock_resultante, motivo, creado_por_nombre)
  values (p_tipo, p_talla, v_delta, v_prenda.stock, nullif(trim(coalesce(p_motivo, '')), ''), v_nombre);
  return v_prenda.stock;
end;
$$;
grant execute on function uniformes_mover_stock(text, text, integer, text, text) to authenticated;

-- 7. Una convocatoria finalizada (cerrada y guardada) ya no se toca
create or replace function _uniformes_comprobar_editable(p_convocatoria_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from uniformes_convocatorias where id = p_convocatoria_id;
  if v_estado = 'finalizada' then
    raise exception 'Esta convocatoria está cerrada y guardada: ya no se puede modificar.';
  end if;
end;
$$;

create or replace function uniformes_admin_asignar(p_alumno_id uuid, p_convocatoria_id uuid, p_prenda_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid;
  v_actual uniformes_pedidos;
  v_stock integer;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);

  select socio_id into v_socio_id from alumnos where id = p_alumno_id;
  if v_socio_id is null then raise exception 'El alumno no existe.'; end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if found and v_actual.prenda_id = p_prenda_id then return; end if;

  select stock into v_stock from prendas_catalogo where id = p_prenda_id for update;
  if v_stock is null or v_stock < 1 then raise exception 'Esa prenda no tiene stock disponible.'; end if;

  if v_actual.id is not null then
    update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
    if v_actual.prioridad = 0 then
      delete from uniformes_pedidos where id = v_actual.id;
    else
      update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
    end if;
  end if;

  update prendas_catalogo set stock = stock - 1 where id = p_prenda_id;
  insert into uniformes_pedidos (convocatoria_id, socio_id, alumno_id, prioridad, prenda_id, estado)
  values (p_convocatoria_id, v_socio_id, p_alumno_id, 0, p_prenda_id, 'asignado')
  on conflict (alumno_id, convocatoria_id, prioridad)
  do update set prenda_id = excluded.prenda_id, estado = 'asignado';
end;
$$;

create or replace function uniformes_admin_quitar(p_alumno_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_actual uniformes_pedidos;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if not found then raise exception 'Este alumno no tiene ninguna prenda asignada.'; end if;
  update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
  if v_actual.prioridad = 0 then
    delete from uniformes_pedidos where id = v_actual.id;
  else
    update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
  end if;
end;
$$;

create or replace function uniformes_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  if (select estado from uniformes_convocatorias where id = p_convocatoria_id) <> 'repartida' then
    raise exception 'Esta convocatoria no está repartida.';
  end if;
  update prendas_catalogo p set stock = stock + x.n
    from (select prenda_id, count(*)::int n from uniformes_pedidos
          where convocatoria_id = p_convocatoria_id and estado = 'asignado' group by prenda_id) x
    where p.id = x.prenda_id;
  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and prioridad = 0;
  update uniformes_pedidos set estado = 'pendiente' where convocatoria_id = p_convocatoria_id and prioridad in (1, 2, 3);
  update uniformes_convocatorias set estado = 'abierta', resumen_reparto = null where id = p_convocatoria_id;
end;
$$;

-- 8. Borrar el pedido completo de una familia (spam, duplicado, o porque
--    lo pide). Si algún hijo/a tenía prenda asignada, se devuelve al stock.
create or replace function uniformes_admin_borrar_pedido(p_socio_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  update prendas_catalogo p set stock = stock + x.n
    from (select prenda_id, count(*)::int n from uniformes_pedidos
          where convocatoria_id = p_convocatoria_id and socio_id = p_socio_id and estado = 'asignado' group by prenda_id) x
    where p.id = x.prenda_id;
  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and socio_id = p_socio_id;
end;
$$;
grant execute on function uniformes_admin_borrar_pedido(uuid, uuid) to authenticated;

drop function _cambiar_check_estado(text, text);
