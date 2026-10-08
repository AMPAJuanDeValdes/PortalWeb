-- ============================================================
-- Eventos v2: lo que necesitan Chocolatada, Cabalgata, Talleres,
-- Barbacoa y Visita al Comedor tal como los describió la Junta.
-- Se puede ejecutar varias veces sin problema.
-- ============================================================

-- 1. Opciones nuevas del evento ---------------------------------------------
alter table eventos add column if not exists pide_alergias boolean not null default false;
-- Voluntariado: 'no', 'adultos' (solo adultos) o 'adultos_y_ninos'
-- (adultos solos, o adultos con niños de su familia; nunca niños solos)
alter table eventos add column if not exists voluntariado_modo text not null default 'no';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_voluntariado_modo_check') then
    alter table eventos add constraint eventos_voluntariado_modo_check
      check (voluntariado_modo in ('no', 'adultos', 'adultos_y_ninos'));
  end if;
end $$;
update eventos set voluntariado_modo = 'adultos_y_ninos'
  where voluntariado_habilitado = true and voluntariado_modo = 'no';
-- Si una familia apunta niños sin ningún adulto suyo, tiene que decir con
-- qué adulto socio irán (Chocolatada)
alter table eventos add column if not exists alumnos_requieren_adulto boolean not null default false;
-- Pregunta extra para cada alumno (ej. "¿Cómo llega?" Directo de clase /
-- Pasa antes por Patines)
alter table eventos add column if not exists pregunta_extra text;
alter table eventos add column if not exists pregunta_opciones text[];
-- No socios: solo pueden apuntarse a las subactividades (Barbacoa)
alter table eventos add column if not exists publico_solo_actividades boolean not null default false;
-- Aviso que ven los no socios (ej. "Tenéis que pagar la entrada de la Barbacoa")
alter table eventos add column if not exists aviso_no_socios text;

-- 2. Datos nuevos de cada inscripción ---------------------------------------
alter table evento_inscripciones add column if not exists apellidos_invitado text;
alter table evento_inscripciones add column if not exists edad integer;
alter table evento_inscripciones add column if not exists dni_invitado text;
alter table evento_inscripciones add column if not exists tiene_alergias boolean;
alter table evento_inscripciones add column if not exists alergias text;
alter table evento_inscripciones add column if not exists responsable_nombre text;
alter table evento_inscripciones add column if not exists respuesta_extra text;
-- Alumno externo (formulario público de talleres)
alter table evento_inscripciones add column if not exists alumno_nombre text;
alter table evento_inscripciones add column if not exists alumno_apellidos text;
alter table evento_inscripciones add column if not exists alumno_etapa text;
alter table evento_inscripciones add column if not exists alumno_curso text;

-- Documentos firmados por adultos no socios (acompañantes de la Cabalgata)
alter table documentos_evento_respuestas add column if not exists evento_inscripcion_id uuid
  references evento_inscripciones(id) on delete cascade;

-- 3. Plazas: solo cuentan los asistentes (no voluntarios) ------------------
create or replace function evento_plazas_disponibles(p_evento_id uuid)
returns integer language sql security definer set search_path = public stable as $$
  select case when e.aforo_total is null then null
    else e.aforo_total - (select count(*) from evento_inscripciones i
      where i.evento_id = p_evento_id and i.actividad_id is null and not i.es_voluntario)::integer
  end
  from eventos e where e.id = p_evento_id;
$$;
grant execute on function evento_plazas_disponibles(uuid) to authenticated, anon;

create or replace function actividad_plazas_disponibles(p_actividad_id uuid)
returns integer language sql security definer set search_path = public stable as $$
  select case when a.aforo is null then null
    else a.aforo - (select count(*) from evento_inscripciones i
      where i.actividad_id = p_actividad_id and not i.es_voluntario)::integer
  end
  from evento_actividades a where a.id = p_actividad_id;
$$;
grant execute on function actividad_plazas_disponibles(uuid) to authenticated, anon;

-- 4. Reglas de inscripción, comprobadas en la base de datos ---------------
--    (la página guía al usuario, pero esto es lo que de verdad lo impide)
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
    if ev.voluntariado_excluye_asistencia and exists (
      select 1 from evento_inscripciones i where i.evento_id = new.evento_id and not i.es_voluntario
        and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
          or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
    ) then
      raise exception 'Quien va como voluntario/a no puede apuntarse también como asistente.';
    end if;
    return new;   -- los voluntarios no ocupan plaza
  end if;

  if ev.voluntariado_excluye_asistencia and new.tipo_miembro in ('adulto', 'alumno') and exists (
    select 1 from evento_inscripciones i where i.evento_id = new.evento_id and i.es_voluntario
      and ((new.tipo_miembro = 'adulto' and i.adulto_id = new.adulto_id)
        or (new.tipo_miembro = 'alumno' and i.alumno_id = new.alumno_id))
  ) then
    raise exception 'Quien va como voluntario/a no puede apuntarse también como asistente.';
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

  -- Niños sin ningún adulto de su familia: hay que decir con quién van
  if ev.alumnos_requieren_adulto and new.tipo_miembro = 'alumno'
     and coalesce(btrim(new.responsable_nombre), '') = ''
     and not exists (
       select 1 from evento_inscripciones i
       where i.evento_id = new.evento_id and i.socio_id = new.socio_id and i.actividad_id is null
         and i.tipo_miembro = 'adulto' and not i.es_voluntario
     ) then
    raise exception 'Indica con qué adulto socio irá, o apunta antes a un adulto de la familia.';
  end if;

  if ev.pide_alergias and new.tipo_miembro <> 'publico' and new.tiene_alergias is null then
    raise exception 'Indica si tiene alergias.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eventos_validar_inscripcion on evento_inscripciones;
create trigger trg_eventos_validar_inscripcion
before insert on evento_inscripciones
for each row execute function eventos_validar_inscripcion();

-- 5. Al quitar a alguien del evento, se le quita también de sus
--    subactividades -------------------------------------------------------
create or replace function eventos_quitar_subactividades()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.actividad_id is null and not old.es_voluntario and old.tipo_miembro in ('adulto', 'alumno') then
    delete from evento_inscripciones i
    where i.evento_id = old.evento_id and i.actividad_id is not null and not i.es_voluntario
      and ((old.tipo_miembro = 'adulto' and i.adulto_id = old.adulto_id)
        or (old.tipo_miembro = 'alumno' and i.alumno_id = old.alumno_id));
  end if;
  return old;
end;
$$;

drop trigger if exists trg_eventos_quitar_subactividades on evento_inscripciones;
create trigger trg_eventos_quitar_subactividades
after delete on evento_inscripciones
for each row execute function eventos_quitar_subactividades();

-- 6. Inscripción de familias no socias desde la web pública, de una vez
--    (evento + subactividades): si algo falla, no se guarda nada.
create or replace function evento_inscribir_publico(p_evento_id uuid, p_datos jsonb, p_actividades uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_primera uuid;
  v_id uuid;
  v_act uuid;
  v_solo boolean;
begin
  select publico_solo_actividades into v_solo from eventos where id = p_evento_id;
  if not found then raise exception 'El evento no existe.'; end if;
  if coalesce(btrim(p_datos->>'nombre_contacto'), '') = '' or coalesce(btrim(p_datos->>'email_contacto'), '') = '' then
    raise exception 'Faltan el nombre y el email del adulto responsable.';
  end if;
  if v_solo and coalesce(array_length(p_actividades, 1), 0) = 0 then
    raise exception 'Elige al menos una actividad.';
  end if;

  if not v_solo then
    insert into evento_inscripciones (evento_id, tipo_miembro, grupo_id, nombre_contacto, email_contacto, telefono_contacto,
      alumno_nombre, alumno_apellidos, alumno_etapa, alumno_curso, edad, tiene_alergias, alergias, respuesta_extra)
    values (p_evento_id, 'publico', v_grupo, p_datos->>'nombre_contacto', p_datos->>'email_contacto', p_datos->>'telefono_contacto',
      p_datos->>'alumno_nombre', p_datos->>'alumno_apellidos', p_datos->>'alumno_etapa', p_datos->>'alumno_curso',
      nullif(p_datos->>'edad', '')::integer, (p_datos->>'tiene_alergias')::boolean, p_datos->>'alergias', p_datos->>'respuesta_extra')
    returning id into v_primera;
  end if;

  foreach v_act in array coalesce(p_actividades, '{}') loop
    insert into evento_inscripciones (evento_id, actividad_id, tipo_miembro, grupo_id, nombre_contacto, email_contacto, telefono_contacto,
      alumno_nombre, alumno_apellidos, alumno_etapa, alumno_curso, edad, respuesta_extra)
    values (p_evento_id, v_act, 'publico', v_grupo, p_datos->>'nombre_contacto', p_datos->>'email_contacto', p_datos->>'telefono_contacto',
      p_datos->>'alumno_nombre', p_datos->>'alumno_apellidos', p_datos->>'alumno_etapa', p_datos->>'alumno_curso',
      nullif(p_datos->>'edad', '')::integer, p_datos->>'respuesta_extra')
    returning id into v_id;
    v_primera := coalesce(v_primera, v_id);
  end loop;
  return v_primera;
end;
$$;
grant execute on function evento_inscribir_publico(uuid, jsonb, uuid[]) to anon, authenticated;

-- 7. Premios de concursos y torneos ---------------------------------------
--    (de un evento o de una de sus subactividades; el ganador se escribe
--    cuando se sabe y entonces se muestra)
create table if not exists evento_premios (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  actividad_id uuid references evento_actividades(id) on delete cascade,
  puesto text not null,            -- "1er premio", "Mención especial"...
  premio text,                     -- "Lote de libros", "Trofeo"...
  ganador text,                    -- se rellena al final
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
alter table evento_premios enable row level security;
drop policy if exists "todos ven los premios de eventos visibles" on evento_premios;
create policy "todos ven los premios de eventos visibles" on evento_premios for select
  using (exists (select 1 from eventos e where e.id = evento_id and (e.activo or is_admin())));
drop policy if exists "admins gestionan los premios" on evento_premios;
create policy "admins gestionan los premios" on evento_premios for all
  using (is_admin()) with check (is_admin());

-- 8. Concurso literario: el texto puede entregarse en Word (.docx) --------
--    El archivo se guarda con un nombre al azar (sin datos de la familia)
--    para que el jurado no sepa de quién es.
alter table concurso_envios add column if not exists archivo_path text;
insert into storage.buckets (id, name, public) values ('concursos', 'concursos', false) on conflict (id) do nothing;
drop policy if exists "socios suben textos de concurso" on storage.objects;
create policy "socios suben textos de concurso" on storage.objects for insert
  with check (bucket_id = 'concursos' and auth.uid() is not null);
drop policy if exists "admins leen textos de concurso" on storage.objects;
create policy "admins leen textos de concurso" on storage.objects for select
  using (bucket_id = 'concursos' and is_admin());

drop function if exists concurso_enviar_texto(uuid, text, uuid);
create or replace function concurso_enviar_texto(p_evento_id uuid, p_texto text, p_alumno_id uuid, p_archivo_path text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
  v_envio_id uuid;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if p_alumno_id is null then
    raise exception 'Tienes que indicar a nombre de qué alumno/a envías el texto.';
  end if;
  if not exists (select 1 from alumnos where id = p_alumno_id and socio_id = v_socio_id) then
    raise exception 'Ese alumno/a no pertenece a tu familia.';
  end if;
  if coalesce(length(trim(p_texto)), 0) = 0 and p_archivo_path is null then
    raise exception 'Escribe el texto o sube el documento de Word.';
  end if;
  if p_archivo_path is not null and p_archivo_path not like p_evento_id::text || '/%' then
    raise exception 'El archivo no corresponde a este concurso.';
  end if;
  if exists (select 1 from eventos where id = p_evento_id and fecha_cierre_inscripcion is not null and now() >= fecha_cierre_inscripcion) then
    raise exception 'El plazo del concurso está cerrado.';
  end if;
  if exists (
    select 1 from concurso_identidades ci
    join concurso_envios ce on ce.id = ci.envio_id
    where ce.evento_id = p_evento_id and ci.alumno_id = p_alumno_id
  ) then
    raise exception 'Este alumno/a ya ha enviado un texto para este concurso.';
  end if;

  insert into concurso_envios (evento_id, texto, archivo_path) values (p_evento_id, coalesce(p_texto, ''), p_archivo_path)
  returning id into v_envio_id;

  insert into concurso_identidades (envio_id, socio_id, alumno_id)
  values (v_envio_id, v_socio_id, p_alumno_id);

  return v_envio_id;
end;
$$;
grant execute on function concurso_enviar_texto(uuid, text, uuid, text) to authenticated;
