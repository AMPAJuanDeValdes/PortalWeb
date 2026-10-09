-- ==================================================================
-- REVISIÓN DE SEGURIDAD (octubre 2026). Cierra huecos por los que una
-- familia, desde la consola del navegador, podía saltarse las reglas:
--  1. Cambiar su inscripción a un evento (marcarse «ganador» de un sorteo,
--     pasar de voluntario a apuntado, cambiar de evento o de alumno).
--  2. Apuntar a eventos a adultos o alumnos de OTRA familia.
--  3. Colarse en la Mochila Jugona Exploradora ya «asignada».
--  4. Pasar el turno de la Mochila sin que a la siguiente familia le llegue
--     el email (ahora la revisión de cada 15 minutos manda los que falten).
--  5. Marcar «datos de la familia revisados» sin completar etapa, curso y aula.
-- Requiere las migraciones de eventos, mochila v2 y datos de familia.
-- Se puede ejecutar varias veces.
-- ==================================================================

-- 1. Inscripciones: la familia solo puede cambiar el acompañante
create or replace function eventos_proteger_inscripcion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.estado is distinct from old.estado
     or new.es_voluntario is distinct from old.es_voluntario
     or new.evento_id is distinct from old.evento_id
     or new.actividad_id is distinct from old.actividad_id
     or new.tipo_miembro is distinct from old.tipo_miembro
     or new.socio_id is distinct from old.socio_id
     or new.adulto_id is distinct from old.adulto_id
     or new.alumno_id is distinct from old.alumno_id
     or new.grupo_id is distinct from old.grupo_id then
    raise exception 'Esta inscripción no se puede cambiar. Quítala y vuelve a apuntarte.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_eventos_proteger_inscripcion on evento_inscripciones;
create trigger trg_eventos_proteger_inscripcion before update on evento_inscripciones
for each row execute function eventos_proteger_inscripcion();

-- 2. Inscripciones: solo adultos y alumnos de la propia familia
create or replace function eventos_inscripcion_de_la_familia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.adulto_id is not null and not exists (select 1 from adultos where id = new.adulto_id and socio_id = new.socio_id) then
    raise exception 'Solo puedes apuntar a adultos de tu familia.';
  end if;
  if new.alumno_id is not null and not exists (select 1 from alumnos where id = new.alumno_id and socio_id = new.socio_id) then
    raise exception 'Solo puedes apuntar a alumnos de tu familia.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_evento_inscripcion_de_la_familia on evento_inscripciones;
create trigger trg_evento_inscripcion_de_la_familia before insert on evento_inscripciones
for each row execute function eventos_inscripcion_de_la_familia();

-- 3. Mochila: quien se apunta entra siempre esperando, al final
create or replace function mochila_asignar_posicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  lock table mochila_cola in share row exclusive mode;
  new.posicion := coalesce((select max(posicion) from mochila_cola), 0) + 1;
  if auth.uid() is not null and not is_admin() then
    new.estado := 'espera'; new.notificado_en := null;
    new.fecha_entrega := null; new.fecha_devolucion_prevista := null;
  end if;
  return new;
end;
$$;

-- 4. Mochila: se anota cuándo se mandó el email del turno
alter table mochila_cola add column if not exists aviso_enviado_en timestamptz;
-- Las familias que ya tienen el turno ya recibieron su email
update mochila_cola set aviso_enviado_en = notificado_en where estado = 'asignada' and aviso_enviado_en is null;

-- 5. «Datos revisados» solo lo pone confirmar_datos_familia() (o la Junta)
create or replace function confirmar_datos_familia()
returns void language plpgsql security definer set search_path = public as $$
declare v_socio uuid := mi_socio_id(); v_faltan text;
begin
  if v_socio is null then raise exception 'No se pudo identificar tu cuenta de socio.'; end if;
  select string_agg(nombre, ', ' order by nombre) into v_faltan from alumnos
  where socio_id = v_socio and (coalesce(btrim(etapa), '') = '' or coalesce(btrim(curso), '') = '' or coalesce(btrim(aula), '') = '');
  if v_faltan is not null then
    raise exception 'Falta la etapa, el curso o el aula de: %.', v_faltan;
  end if;
  perform set_config('ampa.confirmando_datos', 'si', true);
  update socios set datos_revisados_en = now() where id = v_socio;
  perform set_config('ampa.confirmando_datos', '', true);
end;
$$;
grant execute on function confirmar_datos_familia() to authenticated;

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
  if new.datos_revisados_en is distinct from old.datos_revisados_en
     and coalesce(current_setting('ampa.confirmando_datos', true), '') <> 'si' then
    raise exception 'Para confirmar los datos de la familia usa el botón de Mis datos.';
  end if;
  return new;
end;
$$;
