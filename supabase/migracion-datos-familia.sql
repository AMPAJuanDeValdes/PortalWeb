-- ==================================================================
-- DATOS DE LA FAMILIA REVISADOS + CABALGATA POR EDAD
--  * Las familias (p. ej. las importadas) tienen que revisar y confirmar
--    etapa, curso y aula de cada alumno en «Mis datos» antes de poder
--    apuntarse a eventos. Cada 31 de julio se vuelve a pedir.
--  * La Cabalgata es solo para alumnos de 6 a 12 años (edad el día de la
--    cabalgata), no por curso.
--  * Infantil llega hasta 5 años.
-- Ejecutar después de migracion-eventos-v2.sql. Se puede ejecutar varias veces.
-- ==================================================================

alter table socios add column if not exists datos_revisados_en timestamptz;

-- La familia confirma sus datos: todos sus alumnos tienen que tener
-- etapa, curso y aula
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
  update socios set datos_revisados_en = now() where id = v_socio;
end;
$$;
grant execute on function confirmar_datos_familia() to authenticated;

create or replace function eventos_aplicar_tipo()
returns trigger language plpgsql as $$
begin
  if new.plantilla is null then return new; end if;
  -- Por defecto, con inscripción normal
  if new.plantilla not in ('concurso', 'informativo') then
    new.sin_inscripcion := false; new.usa_concurso_texto := false;
  end if;
  if new.plantilla in ('juegos', 'taller', 'barbacoa', 'concurso') then
    new.tipo_elegibilidad := 'alumnos';
    if new.elegibilidad_modo is null then new.elegibilidad_modo := 'curso'; end if;
  end if;
  case new.plantilla
    when 'chocolatada' then
      new.tipo_elegibilidad := 'toda_familia'; new.pide_alergias := true; new.alumnos_requieren_adulto := true;
      new.permite_invitados := true; new.abierto_no_socios := false; new.publico_solo_actividades := false;
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
    when 'cabalgata' then
      new.tipo_elegibilidad := 'toda_familia'; new.metodo_asignacion := 'sorteo';
      new.requiere_pareja_adulto_alumno := true; new.usa_prioridad_historial := false;
      -- Solo alumnos de 6 a 12 años (edad el día de la cabalgata), no por curso
      new.elegibilidad_modo := 'edad'; new.edad_min := 6; new.edad_max := 12; new.cursos_permitidos := null;
    when 'juegos', 'taller' then
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
      if new.voluntariado_modo = 'adultos_y_ninos' then new.voluntariado_modo := 'adultos'; end if;
    when 'barbacoa' then
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
      new.voluntariado_modo := 'adultos_y_ninos'; new.voluntariado_habilitado := true;
      new.permite_invitados := false;
      if new.abierto_no_socios then new.publico_solo_actividades := true; end if;
      -- Sin cursos marcados = todos los alumnos del colegio
      if new.elegibilidad_modo = 'curso' and (new.cursos_permitidos is null or jsonb_array_length(new.cursos_permitidos) = 0) then
        new.cursos_permitidos := (select jsonb_agg(jsonb_build_object('etapa', e, 'curso', c)) from (values
          ('Infantil','0 años'),('Infantil','1 año'),('Infantil','2 años'),('Infantil','3 años'),('Infantil','4 años'),('Infantil','5 años'),
          ('Primaria','1º'),('Primaria','2º'),('Primaria','3º'),('Primaria','4º'),('Primaria','5º'),('Primaria','6º'),
          ('ESO','1º'),('ESO','2º'),('ESO','3º'),('ESO','4º'),('Bachillerato','1º'),('Bachillerato','2º')) v(e, c));
      end if;
    when 'comedor' then
      new.tipo_elegibilidad := 'adultos'; new.metodo_asignacion := 'sorteo';
      new.usa_prioridad_historial := true; new.requiere_pareja_adulto_alumno := false;
    when 'concurso' then
      new.usa_concurso_texto := true; new.sin_inscripcion := false;
    when 'informativo' then
      new.sin_inscripcion := true; new.usa_concurso_texto := false;
    else null;
  end case;
  return new;
end;
$$;

create or replace function eventos_validar_inscripcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev eventos%rowtype;
  act evento_actividades%rowtype;
  ocupadas integer;
  ahora timestamptz := now();
  es_admin boolean := coalesce(is_admin(), false);
  v_nac date;
  v_edad integer;
begin
  -- Bloquea el evento: dos familias a la vez no pueden pasarse del aforo
  select * into ev from eventos where id = new.evento_id for update;
  if not found then raise exception 'El evento no existe.'; end if;

  if not es_admin then
    if not ev.activo then raise exception 'Este evento ya no está disponible.'; end if;
    if ev.sin_inscripcion or ev.usa_concurso_texto then
      raise exception 'Este evento no tiene inscripción.';
    end if;
    if ev.sorteo_realizado then raise exception 'El sorteo de este evento ya se hizo.'; end if;
    if ev.fecha_cierre_inscripcion is not null and ahora >= ev.fecha_cierre_inscripcion then
      raise exception 'El plazo de inscripción está cerrado.';
    end if;
    if new.tipo_miembro = 'publico' then
      if not ev.abierto_no_socios then raise exception 'Este evento no está abierto a no socios.'; end if;
      if ev.fecha_apertura_no_socios is not null and ahora < ev.fecha_apertura_no_socios then
        raise exception 'La inscripción para no socios todavía no está abierta.';
      end if;
      if ev.publico_solo_actividades and new.actividad_id is null then
        raise exception 'Los no socios solo pueden apuntarse a las actividades.';
      end if;
      if new.es_voluntario then raise exception 'Solo los socios pueden apuntarse como voluntarios.'; end if;
      -- Alumno externo: su curso tiene que estar entre los permitidos
      if ev.tipo_elegibilidad = 'alumnos' and ev.elegibilidad_modo = 'curso'
         and ev.cursos_permitidos is not null and jsonb_array_length(ev.cursos_permitidos) > 0 then
        if not exists (select 1 from jsonb_array_elements(ev.cursos_permitidos) c
                       where c->>'etapa' = new.alumno_etapa and c->>'curso' = new.alumno_curso) then
          raise exception 'Este taller no es para el curso indicado.';
        end if;
      end if;
    elsif ev.fecha_apertura_socios is not null and ahora < ev.fecha_apertura_socios then
      raise exception 'La inscripción todavía no está abierta.';
    end if;
  end if;

  -- La familia tiene que haber revisado sus datos (etapa, curso y aula)
  if not es_admin and new.tipo_miembro in ('adulto', 'alumno') and new.socio_id is not null
     and (select datos_revisados_en from socios where id = new.socio_id) is null then
    raise exception 'Antes de apuntaros a eventos, revisad los datos de vuestra familia en Mis datos (etapa, curso y aula de cada alumno).';
  end if;

  -- Eventos por edad (p. ej. la Cabalgata): edad el día del evento
  if new.tipo_miembro = 'alumno' and not new.es_voluntario and new.actividad_id is null and ev.elegibilidad_modo = 'edad' then
    select fecha_nacimiento into v_nac from alumnos where id = new.alumno_id;
    if v_nac is null then
      raise exception 'Falta la fecha de nacimiento de este alumno o alumna: añadidla en Mis datos.';
    end if;
    v_edad := date_part('year', age(coalesce(ev.fecha::date, current_date), v_nac));
    if (ev.edad_min is not null and v_edad < ev.edad_min) or (ev.edad_max is not null and v_edad > ev.edad_max) then
      raise exception 'Este evento es para alumnos de % a % años.', coalesce(ev.edad_min, 0), coalesce(ev.edad_max, 99);
    end if;
  end if;

  -- Misma persona apuntada dos veces a lo mismo
  if new.tipo_miembro in ('adulto', 'alumno') and exists (
    select 1 from evento_inscripciones i
    where i.evento_id = new.evento_id
      and i.actividad_id is not distinct from new.actividad_id
      and i.es_voluntario = new.es_voluntario
      and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
        or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
  ) then
    raise exception 'Ya está apuntado/a.';
  end if;

  if new.es_voluntario then
    if ev.voluntariado_modo = 'no' then raise exception 'Este evento no busca voluntarios.'; end if;
    if new.tipo_miembro = 'alumno' and ev.voluntariado_modo <> 'adultos_y_ninos' then
      raise exception 'En este evento solo pueden ser voluntarios los adultos.';
    end if;
    -- Quien está apuntado al evento no puede ser voluntario (y al revés)
    if exists (
      select 1 from evento_inscripciones i where i.evento_id = new.evento_id and not i.es_voluntario
        and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
          or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
    ) then
      raise exception 'Ya está apuntado/a al evento: no puede ser también voluntario/a.';
    end if;
    return new;   -- los voluntarios no ocupan plaza
  end if;

  if new.tipo_miembro in ('adulto', 'alumno') and exists (
    select 1 from evento_inscripciones i where i.evento_id = new.evento_id and i.es_voluntario
      and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
        or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
  ) then
    raise exception 'Está apuntado/a como voluntario/a: no puede apuntarse también al evento.';
  end if;

  -- Visita al comedor: como mucho un adulto por familia
  if ev.plantilla = 'comedor' and new.actividad_id is null and new.socio_id is not null and exists (
    select 1 from evento_inscripciones i
    where i.evento_id = new.evento_id and i.socio_id = new.socio_id and i.actividad_id is null and not i.es_voluntario
  ) then
    raise exception 'Ya hay un adulto de vuestra familia apuntado: solo puede ir uno por familia.';
  end if;

  if new.actividad_id is not null then
    select * into act from evento_actividades where id = new.actividad_id and evento_id = new.evento_id for update;
    if not found then raise exception 'Esa actividad no es de este evento.'; end if;
    -- Para una subactividad hay que estar apuntado antes al evento principal
    if new.tipo_miembro in ('adulto', 'alumno') and not exists (
      select 1 from evento_inscripciones i
      where i.evento_id = new.evento_id and i.actividad_id is null and not i.es_voluntario
        and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
          or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
    ) then
      raise exception 'Primero hay que apuntarse al evento principal.';
    end if;
    if act.aforo is not null then
      select count(*) into ocupadas from evento_inscripciones
        where actividad_id = new.actividad_id and not es_voluntario;
      if ocupadas >= act.aforo then raise exception 'La actividad «%» está completa.', act.nombre; end if;
    end if;
    return new;
  end if;

  -- Evento principal: aforo (en los de sorteo no, se reparte al sortear)
  if ev.metodo_asignacion = 'aforo' and ev.aforo_total is not null then
    select count(*) into ocupadas from evento_inscripciones
      where evento_id = new.evento_id and actividad_id is null and not es_voluntario;
    if ocupadas >= ev.aforo_total then raise exception 'El evento está completo.'; end if;
  end if;

  -- Alumnos sin ningún adulto de su familia: tienen que ir con un adulto
  -- socio de otra familia que ya esté apuntado a este evento
  if ev.alumnos_requieren_adulto and new.tipo_miembro = 'alumno'
     and not exists (
       select 1 from evento_inscripciones i
       where i.evento_id = new.evento_id and i.socio_id = new.socio_id and i.actividad_id is null
         and i.tipo_miembro = 'adulto' and not i.es_voluntario
     )
     and not (new.responsable_adulto_id is not null and exists (
       select 1 from evento_inscripciones i
       where i.evento_id = new.evento_id and i.actividad_id is null and i.tipo_miembro = 'adulto'
         and i.adulto_id = new.responsable_adulto_id
     )) then
    raise exception 'Apunta antes a un adulto de la familia, o indica el adulto socio de otra familia que le acompaña (tiene que estar apuntado).';
  end if;

  if ev.pide_alergias and new.tipo_miembro <> 'publico' and new.tiene_alergias is null then
    raise exception 'Indica si tiene alergias.';
  end if;
  return new;
end;
$$;

-- Cabalgatas ya creadas: pasan a ser por edad (6 a 12 años)
update eventos set plantilla = plantilla where plantilla in ('cabalgata', 'barbacoa');

-- Reseteo anual: también vuelve a pedir la revisión de datos
-- (solo si ya está instalado el cron de cron-reseteo-anual.sql)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'reseteo_anual_socios') then
    execute $f$create or replace function reseteo_anual_socios()
returns integer language plpgsql security definer set search_path = public as $body$
declare
  n integer;
begin
  -- cada curso nuevo, las familias vuelven a revisar etapa, curso y aula
  update socios set datos_revisados_en = null where datos_revisados_en is not null;
  with desactivados as (
    update socios s set estado = 'falta_pago'
    where s.estado = 'activa'
      and not exists (select 1 from adultos a where a.socio_id = s.id and a.role = 'admin')
    returning s.id
  ), alumnos_reset as (
    update alumnos al set verificado = false
    where al.socio_id in (select id from desactivados)
    returning 1
  )
  select count(*) into n from desactivados;
  return n;
end;
$body$;
$f$;
  end if;
end $$;
