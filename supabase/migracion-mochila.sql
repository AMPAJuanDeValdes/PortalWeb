-- ==================================================================
-- MOCHILA JUGONA EXPLORADORA
-- Migración incremental — ejecutar en el SQL Editor de un proyecto
-- que ya tenga desplegado el resto del esquema v2.
-- ==================================================================

-- 1. Cola activa -------------------------------------------------------
create table if not exists mochila_cola (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('socio', 'no_socio')),
  socio_id uuid references socios(id) on delete cascade,
  nombre_contacto text,
  email_contacto text,
  telefono_contacto text,
  posicion integer not null,
  fecha_entrega date,
  fecha_devolucion_prevista date,
  notificado_en timestamptz,
  created_at timestamptz not null default now(),
  check (
    (tipo = 'socio' and socio_id is not null) or
    (tipo = 'no_socio' and socio_id is null and nombre_contacto is not null and email_contacto is not null)
  )
);

create unique index if not exists mochila_cola_socio_unico
  on mochila_cola (socio_id) where socio_id is not null;

create unique index if not exists mochila_cola_posicion_unica
  on mochila_cola (posicion);

alter table mochila_cola enable row level security;

-- La posición siempre la calcula el servidor (nunca el cliente).
create or replace function mochila_asignar_posicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  lock table mochila_cola in share row exclusive mode;
  new.posicion := coalesce((select max(posicion) from mochila_cola), 0) + 1;
  return new;
end;
$$;

drop trigger if exists mochila_cola_asignar_posicion on mochila_cola;
create trigger mochila_cola_asignar_posicion
before insert on mochila_cola
for each row execute function mochila_asignar_posicion();

create policy "socios ven su propia entrada en la mochila" on mochila_cola for select
  using (socio_id = mi_socio_id());

create policy "socios se apuntan a la mochila" on mochila_cola for insert
  with check (tipo = 'socio' and socio_id = mi_socio_id());

create policy "admins gestionan toda la mochila" on mochila_cola for all
  using (is_admin())
  with check (is_admin());

-- Nota: aún no se habilita el alta pública para tipo = 'no_socio';
-- se añadirá cuando se construya esa pantalla.

-- 2. Historial (para estadísticas de fin de año) ------------------------
create table if not exists mochila_historial (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('socio', 'no_socio')),
  socio_id uuid references socios(id) on delete set null,
  numero_socio_completo text,
  nombre_familia text not null,
  fecha_entrega date not null,
  fecha_devolucion date not null,
  created_at timestamptz not null default now()
);

alter table mochila_historial enable row level security;

create policy "admins ven y gestionan el historial de la mochila" on mochila_historial for all
  using (is_admin())
  with check (is_admin());

-- 3. Configuración (importes para no socios, editable por admin) --------
create table if not exists mochila_config (
  id smallint primary key default 1 check (id = 1),
  importe_deposito numeric(8,2) not null default 20,
  importe_alquiler numeric(8,2) not null default 5,
  updated_at timestamptz not null default now()
);
insert into mochila_config (id) values (1) on conflict (id) do nothing;

alter table mochila_config enable row level security;

create policy "todos ven la configuracion de la mochila" on mochila_config for select
  using (true);

create policy "admins editan la configuracion de la mochila" on mochila_config for all
  using (is_admin())
  with check (is_admin());

-- 4. Ampliación de comprobantes_pago para el depósito de no socios -------
-- (se eliminan y recrean los checks porque no sabemos el nombre exacto
-- que Postgres les asignó automáticamente al crearlos sin nombre)
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'comprobantes_pago'::regclass and contype = 'c'
  loop
    execute format('alter table comprobantes_pago drop constraint %I', r.conname);
  end loop;
end $$;

alter table comprobantes_pago add column if not exists mochila_cola_id uuid references mochila_cola(id) on delete set null;
alter table comprobantes_pago add column if not exists reembolsado boolean not null default false;

alter table comprobantes_pago add constraint comprobantes_pago_tipo_check
  check (tipo in ('cuota_socio', 'invitado_evento', 'mochila_no_socio'));

alter table comprobantes_pago add constraint comprobantes_pago_referencia_check
  check (
    (tipo = 'cuota_socio' and socio_id is not null) or
    (tipo = 'invitado_evento' and evento_inscripcion_id is not null) or
    (tipo = 'mochila_no_socio' and mochila_cola_id is not null)
  );

-- Nota: la política de insert para tipo = 'mochila_no_socio' se añadirá
-- cuando se construya la pantalla de no socios.

-- 5. Función pública: cuántas familias hay apuntadas en total -----------
create or replace function mochila_cola_length()
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::integer from mochila_cola;
$$;
grant execute on function mochila_cola_length() to authenticated, anon;

-- 6. Posponerse una posición ("Prefiero esperar una semana más" / admin
--    "Pasar una semana"). Devuelve el id de quien pasa a ser la nueva
--    posición 1 (o null si no cambia nadie de posición 1).
create or replace function mochila_posponer(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entrada mochila_cola;
  v_siguiente mochila_cola;
  v_nuevo_p1 uuid;
begin
  lock table mochila_cola in share row exclusive mode;

  select * into v_entrada from mochila_cola where id = p_id;
  if not found then
    raise exception 'La entrada no existe.';
  end if;
  if not (is_admin() or v_entrada.socio_id = mi_socio_id()) then
    raise exception 'No tienes permiso sobre esta entrada.';
  end if;
  if v_entrada.posicion = 0 then
    raise exception 'No puedes posponer una mochila que ya tienes en tu poder.';
  end if;

  select * into v_siguiente from mochila_cola where posicion = v_entrada.posicion + 1;
  if not found then
    return null; -- ya es la última posición, no hay nadie con quien intercambiar
  end if;

  update mochila_cola set posicion = v_entrada.posicion where id = v_siguiente.id;
  update mochila_cola set posicion = v_siguiente.posicion where id = v_entrada.id;

  if v_entrada.posicion = 1 then
    v_nuevo_p1 := v_siguiente.id;
    update mochila_cola set notificado_en = now() where id = v_nuevo_p1;
  end if;

  return v_nuevo_p1;
end;
$$;
grant execute on function mochila_posponer(uuid) to authenticated;

-- Atajo para el botón de admin "Pasar una semana": opera siempre sobre
-- quien esté ahora mismo en la posición 1.
create or replace function mochila_admin_pasar_semana()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;
  select id into v_id from mochila_cola where posicion = 1;
  if v_id is null then
    raise exception 'No hay nadie en la posición 1.';
  end if;
  return mochila_posponer(v_id);
end;
$$;
grant execute on function mochila_admin_pasar_semana() to authenticated;

-- 7. Salir de la cola ("Desapuntarme" del propio socio, o "Eliminar" del
--    admin sobre cualquier entrada). Devuelve el id de quien pasa a ser
--    la nueva posición 1 (o null).
create or replace function mochila_salir(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entrada mochila_cola;
  v_nuevo_p1 uuid;
begin
  lock table mochila_cola in share row exclusive mode;

  select * into v_entrada from mochila_cola where id = p_id;
  if not found then
    raise exception 'La entrada no existe.';
  end if;
  if not (is_admin() or v_entrada.socio_id = mi_socio_id()) then
    raise exception 'No tienes permiso sobre esta entrada.';
  end if;
  if v_entrada.posicion = 0 then
    raise exception 'Esta familia tiene la mochila actualmente; hay que marcarla como devuelta, no eliminarla.';
  end if;

  delete from mochila_cola where id = p_id;
  update mochila_cola set posicion = posicion - 1 where posicion > v_entrada.posicion;

  if v_entrada.posicion = 1 then
    select id into v_nuevo_p1 from mochila_cola where posicion = 1;
    if v_nuevo_p1 is not null then
      update mochila_cola set notificado_en = now() where id = v_nuevo_p1;
    end if;
  end if;

  return v_nuevo_p1;
end;
$$;
grant execute on function mochila_salir(uuid) to authenticated;

-- 8. Admin: entregar la mochila a quien está en posición 1 ---------------
--    Devuelve el id de quien pasa a ser la nueva posición 1 (o null).
create or replace function mochila_admin_entregar(p_fecha date default current_date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actual_id uuid;
  v_entrada mochila_cola;
  v_nuevo_p1 uuid;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  lock table mochila_cola in share row exclusive mode;

  select id into v_actual_id from mochila_cola where posicion = 0;
  if v_actual_id is not null then
    raise exception 'Ya hay una familia con la mochila; márcala como devuelta antes de entregarla de nuevo.';
  end if;

  select * into v_entrada from mochila_cola where posicion = 1;
  if not found then
    raise exception 'No hay nadie en la cola.';
  end if;

  update mochila_cola
    set posicion = 0, fecha_entrega = p_fecha, fecha_devolucion_prevista = p_fecha + 7
    where id = v_entrada.id;

  update mochila_cola set posicion = posicion - 1 where posicion > 1;

  select id into v_nuevo_p1 from mochila_cola where posicion = 1;
  if v_nuevo_p1 is not null then
    update mochila_cola set notificado_en = now() where id = v_nuevo_p1;
  end if;

  return v_nuevo_p1;
end;
$$;
grant execute on function mochila_admin_entregar(date) to authenticated;

-- 9. Admin: registrar la devolución y archivar en el historial -----------
--    Devuelve el id del registro creado en mochila_historial.
create or replace function mochila_admin_devuelto(p_fecha_devolucion date default current_date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entrada mochila_cola;
  v_nombre_familia text;
  v_numero_socio text;
  v_historial_id uuid;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_entrada from mochila_cola where posicion = 0;
  if not found then
    raise exception 'Nadie tiene la mochila actualmente.';
  end if;

  if v_entrada.tipo = 'socio' then
    select s.numero_socio_completo, a.nombre || ' ' || a.apellidos
      into v_numero_socio, v_nombre_familia
      from socios s
      join adultos a on a.socio_id = s.id
      where s.id = v_entrada.socio_id
      order by a.created_at
      limit 1;
  else
    v_numero_socio := null;
    v_nombre_familia := v_entrada.nombre_contacto;
  end if;

  insert into mochila_historial (tipo, socio_id, numero_socio_completo, nombre_familia, fecha_entrega, fecha_devolucion)
  values (v_entrada.tipo, v_entrada.socio_id, v_numero_socio, coalesce(v_nombre_familia, '(sin nombre)'), v_entrada.fecha_entrega, p_fecha_devolucion)
  returning id into v_historial_id;

  delete from mochila_cola where id = v_entrada.id;

  return v_historial_id;
end;
$$;
grant execute on function mochila_admin_devuelto(date) to authenticated;
