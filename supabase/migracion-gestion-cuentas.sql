-- ============================================================
-- MIGRACIÓN: gestión de cuentas por el admin, reactivación,
-- recuperación de contraseña controlada y cierres de seguridad.
-- Se puede ejecutar más de una vez sin romper nada.
-- No borra datos, salvo las "solicitudes vacías" del punto 7.
-- ============================================================

-- 1. Socios: motivo de rechazo y marca de "ha pedido reactivar"
alter table socios add column if not exists motivo_rechazo text;
alter table socios add column if not exists reactivacion_solicitada_en timestamptz;

-- 2. Alumnos: el curso deja de ser obligatorio (el admin puede dar de
--    alta un alumno solo con nombre, apellidos y etapa)
alter table alumnos alter column curso drop not null;

-- 3. Registro de peticiones de "recuperar contraseña" (para limitar a
--    una petición cada 15 minutos por email). Solo lo usa el servidor
--    con la Service Role Key: RLS activado y sin políticas = nadie más
--    puede leerlo ni escribirlo.
create table if not exists recuperaciones_password (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists recuperaciones_password_email_idx on recuperaciones_password (lower(email), created_at desc);
alter table recuperaciones_password enable row level security;

-- 4. Poder quitar un adulto o un alumno aunque tenga inscripciones o
--    documentos: las referencias pasan a borrarse en cascada (o a null
--    cuando solo indican "quién lo creó").
create or replace function _rehacer_fk(p_tabla text, p_columna text, p_ref text, p_accion text)
returns void language plpgsql as $$
declare v_nombre text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_tabla and column_name = p_columna) then
    return;
  end if;
  for v_nombre in
    select c.conname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.conrelid = ('public.' || p_tabla)::regclass and a.attname = p_columna
  loop
    execute format('alter table %I drop constraint %I', p_tabla, v_nombre);
  end loop;
  execute format('alter table %I add constraint %I foreign key (%I) references %I(id) on delete %s',
                 p_tabla, p_tabla || '_' || p_columna || '_fkey', p_columna, p_ref, p_accion);
end;
$$;

select _rehacer_fk('evento_inscripciones', 'adulto_id', 'adultos', 'cascade');
select _rehacer_fk('evento_inscripciones', 'alumno_id', 'alumnos', 'cascade');
select _rehacer_fk('documentos_evento_respuestas', 'adulto_id', 'adultos', 'cascade');
select _rehacer_fk('documentos_evento_respuestas', 'alumno_id', 'alumnos', 'cascade');
select _rehacer_fk('mandatos_sepa', 'firmado_por', 'adultos', 'set null');
select _rehacer_fk('eventos', 'created_by', 'adultos', 'set null');
select _rehacer_fk('documentos', 'created_by', 'adultos', 'set null');

drop function _rehacer_fk(text, text, text, text);

-- 5. SEGURIDAD: un socio solo puede tocar sus datos "de ficha".
--    Antes, desde la consola del navegador, un socio podía ponerse
--    role = 'admin' a sí mismo, o pasar su cuenta de 'baja' a 'activa'.
--    Las funciones de Netlify (Service Role, auth.uid() = null) y los
--    admins no se ven afectados.
create or replace function proteger_campos_socio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.estado is distinct from old.estado and new.estado <> 'baja' then
    raise exception 'Solo el AMPA puede cambiar el estado de la cuenta.';
  end if;
  if new.numero_secuencial is distinct from old.numero_secuencial
     or new.anio_ultima_cuota is distinct from old.anio_ultima_cuota
     or new.codigo_asociacion is distinct from old.codigo_asociacion
     or new.motivo_rechazo is distinct from old.motivo_rechazo
     or new.reactivacion_solicitada_en is distinct from old.reactivacion_solicitada_en then
    raise exception 'Solo el AMPA puede cambiar el número de socio o la cuota.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_campos_socio on socios;
create trigger trg_proteger_campos_socio before update on socios
for each row execute function proteger_campos_socio();

create or replace function proteger_campos_adulto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.role is distinct from old.role or new.socio_id is distinct from old.socio_id then
    raise exception 'No puedes cambiar el rol ni la familia de un adulto.';
  end if;
  -- El email es también el usuario de acceso: si se cambiara solo aquí,
  -- dejaría de coincidir con el login. Lo cambia el AMPA desde Socios.
  if new.email is distinct from old.email then
    raise exception 'Para cambiar el email de acceso, pídeselo al AMPA.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_campos_adulto on adultos;
create trigger trg_proteger_campos_adulto before update on adultos
for each row execute function proteger_campos_adulto();

-- 6. Admins pueden borrar alumnos (ya podían por la política "for all")
--    y también ver/borrar adultos desde el navegador si hiciera falta.
drop policy if exists "admins borran adultos" on adultos;
create policy "admins borran adultos" on adultos for delete using (is_admin());


-- 6b. Los adultos de una misma familia pueden editar la ficha del otro
--     (antes "Mis datos" mostraba "Guardado ✓" al editar al segundo
--     adulto, pero la base de datos no guardaba nada: solo dejaba editar
--     la fila propia). El trigger del punto 5 sigue impidiendo tocar el
--     rol, la familia o el email de acceso.
drop policy if exists "adultos actualizan a su familia" on adultos;
create policy "adultos actualizan a su familia" on adultos for update
  using (socio_id = mi_socio_id()) with check (socio_id = mi_socio_id());


-- 8. Mandatos SEPA: en una base creada desde schema.sql, la tabla
--    mandatos_sepa se quedaba con su versión ANTIGUA (sin adulto_id,
--    archivo_final_url...), porque la definición nueva usa "if not exists"
--    y se saltaba. Entonces firmar la domiciliación fallaba. Aquí se
--    añaden las columnas que falten, sin tocar los datos.
alter table mandatos_sepa add column if not exists adulto_id uuid references adultos(id) on delete set null;
alter table mandatos_sepa add column if not exists archivo_final_url text;
alter table mandatos_sepa add column if not exists datos_finales jsonb;
alter table mandatos_sepa add column if not exists aviso_diferencias boolean not null default false;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'mandatos_sepa' and column_name = 'archivo_url') then
    alter table mandatos_sepa alter column archivo_url drop not null;
  end if;
end $$;
drop policy if exists "socios ven sus propios mandatos" on mandatos_sepa;
create policy "socios ven sus propios mandatos" on mandatos_sepa for select
  using (socio_id = mi_socio_id());


-- 9. Un solo mandato SEPA vigente por socio (la domiciliación es de la
--    familia, no de cada adulto). Si hubiera más de uno vigente, se deja
--    el más reciente y los demás pasan a "sustituido".
update mandatos_sepa m set vigente = false
where vigente and exists (select 1 from mandatos_sepa n
  where n.socio_id = m.socio_id and n.vigente and n.created_at > m.created_at);
create unique index if not exists mandatos_sepa_un_vigente_por_socio
  on mandatos_sepa (socio_id) where vigente;

-- 7. Limpieza: solicitudes de alta vacías creadas por el bug antiguo del
--    email repetido (cuenta "recién creada" sin ningún adulto). No sirven
--    para nada: no tienen datos ni nadie puede entrar con ellas.
delete from socios s
where s.estado = 'recien_creada'
  and not exists (select 1 from adultos a where a.socio_id = s.id);
