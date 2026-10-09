-- ============================================================

-- Fecha en que la familia confirmó sus datos (hace falta para apuntarse a eventos)
alter table socios add column if not exists datos_revisados_en timestamptz;

-- Eventos v2: lo que necesitan Chocolatada, Cabalgata, Talleres,
-- Barbacoa y Visita al Comedor tal como los describió la Junta.
-- Se puede ejecutar varias veces sin problema.
-- ============================================================

-- 1. Opciones nuevas del evento ---------------------------------------------
alter table eventos add column if not exists pide_alergias boolean not null default false;
-- Voluntariado: 'no', 'adultos' (solo adultos) o 'adultos_y_ninos'
-- (adultos solos, o adultos con alumnos de su familia; nunca alumnos solos)
alter table eventos add column if not exists voluntariado_modo text not null default 'no';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_voluntariado_modo_check') then
    alter table eventos add constraint eventos_voluntariado_modo_check
      check (voluntariado_modo in ('no', 'adultos', 'adultos_y_ninos'));
  end if;
end $$;
update eventos set voluntariado_modo = 'adultos_y_ninos'
  where voluntariado_habilitado = true and voluntariado_modo = 'no';
-- Si una familia apunta alumnos sin ningún adulto suyo, tienen que ir con
-- un adulto socio de otra familia ya apuntado (Chocolatada)
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
-- Adulto socio de otra familia que acompaña al alumno (Chocolatada)
alter table evento_inscripciones add column if not exists responsable_adulto_id uuid references adultos(id) on delete set null;
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
-- Datos del Word o de cómo se escribió en la web (tiempo de edición,
-- veces guardado, texto pegado...). Solo orientan al jurado; no incluyen
-- el autor del archivo para no romper el anonimato.
alter table concurso_envios add column if not exists metadatos jsonb;
insert into storage.buckets (id, name, public) values ('concursos', 'concursos', false) on conflict (id) do nothing;
drop policy if exists "socios suben textos de concurso" on storage.objects;
create policy "socios suben textos de concurso" on storage.objects for insert
  with check (bucket_id = 'concursos' and auth.uid() is not null);
drop policy if exists "admins leen textos de concurso" on storage.objects;
create policy "admins leen textos de concurso" on storage.objects for select
  using (bucket_id = 'concursos' and is_admin());

drop function if exists concurso_enviar_texto(uuid, text, uuid);
drop function if exists concurso_enviar_texto(uuid, text, uuid, text);
create or replace function concurso_enviar_texto(p_evento_id uuid, p_texto text, p_alumno_id uuid, p_archivo_path text default null, p_metadatos jsonb default null)
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

  insert into concurso_envios (evento_id, texto, archivo_path, metadatos) values (p_evento_id, coalesce(p_texto, ''), p_archivo_path, p_metadatos)
  returning id into v_envio_id;

  insert into concurso_identidades (envio_id, socio_id, alumno_id)
  values (v_envio_id, v_socio_id, p_alumno_id);

  return v_envio_id;
end;
$$;
grant execute on function concurso_enviar_texto(uuid, text, uuid, text, jsonb) to authenticated;


-- 9. Buscar el adulto socio de otra familia que acompaña a unos alumnos
--    (por número de socio y nombre). Solo dice si existe y si ya está
--    apuntado a ese evento; no devuelve más datos de esa familia.
create or replace function evento_buscar_acompanante(p_evento_id uuid, p_numero text, p_nombre text)
returns table (adulto_id uuid, nombre text)
language plpgsql security definer set search_path = public as $$
declare
  v_mio uuid := mi_socio_id();
  v_num text := regexp_replace(coalesce(p_numero, ''), '\D', '', 'g');
  v_nombre text := lower(translate(btrim(coalesce(p_nombre, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'));
  v_socio uuid;
  v_adulto adultos%rowtype;
begin
  if v_mio is null then raise exception 'Tienes que entrar con tu cuenta de socio.'; end if;
  if v_num = '' or length(v_nombre) < 2 then raise exception 'Escribe el número de socio y el nombre del adulto.'; end if;
  select id into v_socio from socios
    where estado = 'activa' and (numero_socio_completo = v_num or (length(v_num) <= 4 and numero_secuencial = lpad(v_num, 4, '0')))
    limit 1;
  if v_socio is null then raise exception 'No hay ningún socio activo con el número %.', p_numero; end if;
  if v_socio = v_mio then raise exception 'Ese es tu propio número de socio: apunta a un adulto de tu familia.'; end if;
  select a.* into v_adulto from adultos a
    where a.socio_id = v_socio
      and (lower(translate(a.nombre || ' ' || a.apellidos, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')) like '%' || v_nombre || '%'
        or v_nombre like lower(translate(a.nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')) || '%')
    limit 1;
  if v_adulto.id is null then raise exception 'En el socio nº % no hay ningún adulto con ese nombre.', p_numero; end if;
  if not exists (select 1 from evento_inscripciones i where i.evento_id = p_evento_id and i.actividad_id is null
                 and i.tipo_miembro = 'adulto' and i.adulto_id = v_adulto.id) then
    raise exception '% todavía no está apuntado/a a este evento. Tiene que apuntarse antes.', v_adulto.nombre;
  end if;
  return query select v_adulto.id, v_adulto.nombre || ' ' || v_adulto.apellidos;
end;
$$;
grant execute on function evento_buscar_acompanante(uuid, text, text) to authenticated;

-- 10. Tipo de evento: cada tipo fija sus reglas y no se pueden cambiar
--     (p. ej. en la Barbacoa solo se apuntan alumnos, nunca adultos).
alter table eventos add column if not exists plantilla text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_plantilla_check') then
    alter table eventos add constraint eventos_plantilla_check check (plantilla is null or plantilla in
      ('chocolatada', 'cabalgata', 'juegos', 'taller', 'barbacoa', 'comedor', 'concurso', 'informativo'));
  end if;
end $$;

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
drop trigger if exists trg_eventos_aplicar_tipo on eventos;
create trigger trg_eventos_aplicar_tipo before insert or update on eventos
for each row execute function eventos_aplicar_tipo();
