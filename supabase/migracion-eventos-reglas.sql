-- ==================================================================
-- Reglas de inscripción en eventos (ejecutar después de migracion-eventos-v2.sql):
--  * Quien está apuntado a un evento no puede ser voluntario, y al revés.
--  * Visita al comedor: como mucho un adulto apuntado por familia.
-- Se puede ejecutar varias veces.
-- ==================================================================

create or replace function eventos_validar_inscripcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev eventos%rowtype;
  act evento_actividades%rowtype;
  ocupadas integer;
  ahora timestamptz := now();
  es_admin boolean := coalesce(is_admin(), false);
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
