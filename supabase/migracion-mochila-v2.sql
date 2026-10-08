-- ==================================================================
-- MOCHILA JUGONA v2 (ejecutar después de migracion-mochila.sql)
--
-- Lista de espera con puestos 1, 2, 3... El puesto 1 es el siguiente.
-- Estado de cada familia:
--   espera    -> en la lista de espera
--   asignada  -> la Junta le ha dado su turno («Entregar mochila»):
--                tiene 24 h para pulsar «La queremos» o «Esperar una
--                semana más»; si no, el cron la quita de la lista
--   la_tiene  -> la tiene en casa (hasta que la Junta pulsa
--                «Mochila devuelta», que la quita y la lista sube)
-- Solo puede haber una familia «asignada» o «la_tiene», y siempre en el
-- puesto 1. Los emails los mandan las funciones de Netlify.
-- Se puede ejecutar varias veces.
-- ==================================================================

-- 1. Estado y puestos ------------------------------------------------------
alter table mochila_cola add column if not exists estado text not null default 'espera';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mochila_cola_estado_check') then
    alter table mochila_cola add constraint mochila_cola_estado_check check (estado in ('espera', 'asignada', 'la_tiene'));
  end if;
end $$;

-- Puesto único, pero comprobado al final de cada operación (así se
-- pueden mover varias familias a la vez sin choques intermedios)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mochila_cola_posicion_unica') then
    drop index if exists mochila_cola_posicion_unica;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mochila_cola_posicion_unica') then
    alter table mochila_cola add constraint mochila_cola_posicion_unica unique (posicion) deferrable initially deferred;
  end if;
end $$;

-- Como mucho una familia con turno o con la mochila
create unique index if not exists mochila_cola_un_turno on mochila_cola ((true)) where estado <> 'espera';

-- Datos del modelo anterior: quien tenía la mochila (puesto 0) pasa a
-- «la_tiene» en el puesto 1; el resto queda en espera y sin aviso.
do $$
begin
  if exists (select 1 from mochila_cola where posicion = 0) then
    update mochila_cola set estado = 'la_tiene' where posicion = 0;
    update mochila_cola set estado = 'espera', notificado_en = null where posicion > 0;
  end if;
end $$;

-- Deja los puestos seguidos: 1, 2, 3...
create or replace function mochila_compactar()
returns void language plpgsql security definer set search_path = public as $$
begin
  set constraints mochila_cola_posicion_unica deferred;
  update mochila_cola c set posicion = r.n
  from (select id, row_number() over (order by posicion, created_at) as n from mochila_cola) r
  where c.id = r.id and c.posicion <> r.n;
end;
$$;
revoke all on function mochila_compactar() from public, anon, authenticated;
select mochila_compactar();

-- Cualquier borrado (también desde Supabase a mano) deja la lista sin huecos
create or replace function mochila_compactar_tras_borrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform mochila_compactar();
  return null;
end;
$$;
drop trigger if exists mochila_cola_compactar on mochila_cola;
create trigger mochila_cola_compactar after delete on mochila_cola
  for each statement execute function mochila_compactar_tras_borrar();

-- 2. Juegos de la mochila ---------------------------------------------------
create table if not exists mochila_juegos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  edad text,
  foto_url text,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
alter table mochila_juegos enable row level security;
drop policy if exists "todos ven los juegos de la mochila" on mochila_juegos;
create policy "todos ven los juegos de la mochila" on mochila_juegos for select using (true);
drop policy if exists "admins gestionan los juegos de la mochila" on mochila_juegos;
create policy "admins gestionan los juegos de la mochila" on mochila_juegos for all
  using (is_admin()) with check (is_admin());

insert into storage.buckets (id, name, public) values ('mochila-juegos', 'mochila-juegos', true)
  on conflict (id) do nothing;
drop policy if exists "lectura publica fotos juegos mochila" on storage.objects;
create policy "lectura publica fotos juegos mochila" on storage.objects for select
  using (bucket_id = 'mochila-juegos');
drop policy if exists "admins suben fotos juegos mochila" on storage.objects;
create policy "admins suben fotos juegos mochila" on storage.objects for insert
  with check (bucket_id = 'mochila-juegos' and is_admin());
drop policy if exists "admins borran fotos juegos mochila" on storage.objects;
create policy "admins borran fotos juegos mochila" on storage.objects for delete
  using (bucket_id = 'mochila-juegos' and is_admin());

-- 3. Lo que ve cualquiera: cuántas familias esperan y si está prestada ----
create or replace function mochila_cola_length()
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::integer from mochila_cola where estado <> 'la_tiene';
$$;
grant execute on function mochila_cola_length() to authenticated, anon;

-- 4. Lo que ve una familia de su propia situación --------------------------
create or replace function mochila_mi_estado()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  e mochila_cola;
  v_esperan integer;
  v_prestada boolean;
begin
  select count(*) filter (where estado <> 'la_tiene'), bool_or(estado = 'la_tiene')
    into v_esperan, v_prestada from mochila_cola;
  select * into e from mochila_cola where socio_id = mi_socio_id();
  if not found then
    return jsonb_build_object('apuntada', false, 'esperan', v_esperan, 'prestada', coalesce(v_prestada, false));
  end if;
  return jsonb_build_object(
    'apuntada', true,
    'estado', e.estado,
    -- puesto en la lista de espera (sin contar a quien tiene la mochila)
    'puesto', e.posicion - case when coalesce(v_prestada, false) and e.estado <> 'la_tiene' then 1 else 0 end,
    'esperan', v_esperan,
    'prestada', coalesce(v_prestada, false),
    'hay_detras', exists (select 1 from mochila_cola where posicion > e.posicion),
    'notificado_en', e.notificado_en,
    'fecha_entrega', e.fecha_entrega,
    'fecha_devolucion_prevista', e.fecha_devolucion_prevista
  );
end;
$$;
grant execute on function mochila_mi_estado() to authenticated;

-- 5. Familia: «La queremos» ------------------------------------------------
create or replace function mochila_confirmar()
returns void language plpgsql security definer set search_path = public as $$
declare e mochila_cola;
begin
  lock table mochila_cola in share row exclusive mode;
  select * into e from mochila_cola where socio_id = mi_socio_id();
  if not found or e.estado <> 'asignada' then
    raise exception 'Ahora mismo no tenéis turno para la mochila.';
  end if;
  update mochila_cola set estado = 'la_tiene', fecha_entrega = current_date,
    fecha_devolucion_prevista = current_date + 7
  where id = e.id;
end;
$$;
grant execute on function mochila_confirmar() to authenticated;

-- 6. Familia: «Esperar una semana más» ---------------------------------------
--    Cambia el puesto con la familia de detrás, que recibe el turno.
--    Devuelve el id de la familia a la que hay que mandar el email.
create or replace function mochila_esperar_semana()
returns uuid language plpgsql security definer set search_path = public as $$
declare e mochila_cola; s mochila_cola;
begin
  lock table mochila_cola in share row exclusive mode;
  select * into e from mochila_cola where socio_id = mi_socio_id();
  if not found or e.estado <> 'asignada' then
    raise exception 'Ahora mismo no tenéis turno para la mochila.';
  end if;
  select * into s from mochila_cola where posicion > e.posicion order by posicion limit 1;
  if not found then
    raise exception 'No hay más familias en la lista: no se puede pasar el turno.';
  end if;
  update mochila_cola set posicion = s.posicion, estado = 'espera', notificado_en = null where id = e.id;
  update mochila_cola set posicion = e.posicion, estado = 'asignada', notificado_en = now() where id = s.id;
  return s.id;
end;
$$;
grant execute on function mochila_esperar_semana() to authenticated;

-- 7. Familia: desapuntarse -----------------------------------------------------
--    La lista sube un puesto. Si tenía el turno, pasa a la siguiente
--    familia (devuelve su id para mandarle el email).
create or replace function mochila_desapuntarse()
returns uuid language plpgsql security definer set search_path = public as $$
declare e mochila_cola; v_sig uuid;
begin
  lock table mochila_cola in share row exclusive mode;
  select * into e from mochila_cola where socio_id = mi_socio_id();
  if not found then raise exception 'No estáis en la lista de la mochila.'; end if;
  if e.estado = 'la_tiene' then
    raise exception 'Tenéis la mochila en casa: devolvedla a la Junta antes de desapuntaros.';
  end if;
  delete from mochila_cola where id = e.id;
  perform mochila_compactar();
  if e.estado = 'asignada' then
    select id into v_sig from mochila_cola where posicion = 1;
    if v_sig is not null then
      update mochila_cola set estado = 'asignada', notificado_en = now() where id = v_sig;
    end if;
  end if;
  return v_sig;
end;
$$;
grant execute on function mochila_desapuntarse() to authenticated;

-- 8. Junta: «Entregar mochila» = dar el turno al puesto 1 ----------------------
create or replace function mochila_admin_entregar()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  lock table mochila_cola in share row exclusive mode;
  if exists (select 1 from mochila_cola where estado = 'la_tiene') then
    raise exception 'La mochila no ha vuelto todavía: marca antes «Mochila devuelta».';
  end if;
  if exists (select 1 from mochila_cola where estado = 'asignada') then
    raise exception 'Ya hay una familia con el turno, esperando su respuesta.';
  end if;
  select id into v_id from mochila_cola where posicion = 1;
  if v_id is null then raise exception 'No hay ninguna familia en la lista.'; end if;
  update mochila_cola set estado = 'asignada', notificado_en = now() where id = v_id;
  return v_id;
end;
$$;
grant execute on function mochila_admin_entregar() to authenticated;

-- 9. Junta: «Mochila devuelta» -------------------------------------------------
--    Se guarda en el historial, se quita de la lista y todos suben un puesto.
create or replace function mochila_admin_devuelto(p_fecha_devolucion date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e mochila_cola; v_nombre text; v_numero text; v_hist uuid;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  lock table mochila_cola in share row exclusive mode;
  select * into e from mochila_cola where estado = 'la_tiene';
  if not found then raise exception 'Ninguna familia tiene la mochila ahora mismo.'; end if;
  if e.tipo = 'socio' then
    select s.numero_socio_completo, a.nombre || ' ' || a.apellidos into v_numero, v_nombre
    from socios s join adultos a on a.socio_id = s.id where s.id = e.socio_id order by a.created_at limit 1;
  else
    v_nombre := e.nombre_contacto;
  end if;
  insert into mochila_historial (tipo, socio_id, numero_socio_completo, nombre_familia, fecha_entrega, fecha_devolucion)
  values (e.tipo, e.socio_id, v_numero, coalesce(v_nombre, '(sin nombre)'), coalesce(e.fecha_entrega, p_fecha_devolucion), p_fecha_devolucion)
  returning id into v_hist;
  delete from mochila_cola where id = e.id;
  perform mochila_compactar();
  return v_hist;
end;
$$;
grant execute on function mochila_admin_devuelto(date) to authenticated;

-- 10. Junta: «Editar lista» (nuevo orden; las familias que no vengan en
--     la lista se eliminan). Quien tiene la mochila sigue siempre primera.
--     Si la familia con turno deja de estar la primera, pierde el turno
--     (la Junta vuelve a pulsar «Entregar mochila»).
create or replace function mochila_admin_guardar_lista(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_tiene uuid;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  lock table mochila_cola in share row exclusive mode;
  p_ids := coalesce(p_ids, '{}');
  select id into v_tiene from mochila_cola where estado = 'la_tiene';
  if v_tiene is not null and (array_length(p_ids, 1) is null or p_ids[1] <> v_tiene) then
    raise exception 'La familia que tiene la mochila no se puede mover ni quitar: márcala antes como devuelta.';
  end if;
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from mochila_cola c where c.id = x)) then
    raise exception 'La lista ha cambiado mientras la editabas. Recarga la página.';
  end if;
  delete from mochila_cola where not (id = any(p_ids));
  set constraints mochila_cola_posicion_unica deferred;
  update mochila_cola c set posicion = o.n
  from unnest(p_ids) with ordinality as o(id, n) where c.id = o.id;
  update mochila_cola set estado = 'espera', notificado_en = null where estado = 'asignada' and posicion <> 1;
end;
$$;
grant execute on function mochila_admin_guardar_lista(uuid[]) to authenticated;

-- 11. Cron: a las 24 h sin respuesta, la familia sale de la lista y el
--     turno pasa a la siguiente (devuelve su id para el email).
--     Solo lo llama la función programada de Netlify (service role).
create or replace function mochila_caducar_turno()
returns uuid language plpgsql security definer set search_path = public as $$
declare e mochila_cola; v_sig uuid;
begin
  lock table mochila_cola in share row exclusive mode;
  select * into e from mochila_cola where estado = 'asignada' and notificado_en < now() - interval '24 hours';
  if not found then return null; end if;
  delete from mochila_cola where id = e.id;
  perform mochila_compactar();
  select id into v_sig from mochila_cola where posicion = 1;
  if v_sig is not null then
    update mochila_cola set estado = 'asignada', notificado_en = now() where id = v_sig;
  end if;
  return v_sig;
end;
$$;
revoke all on function mochila_caducar_turno() from public, anon, authenticated;

-- 12. Funciones del modelo anterior que ya no se usan
drop function if exists mochila_posponer(uuid);
drop function if exists mochila_admin_pasar_semana();
drop function if exists mochila_salir(uuid);
drop function if exists mochila_admin_entregar(date);
