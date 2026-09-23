-- ==================================================================
-- EVENTOS — ampliación con: sorteo (simple, por pareja, o con
-- prioridad histórica), apertura diferenciada socios/no socios,
-- precio por rol, voluntariado de alumnos acompañados, concurso
-- literario anónimo hasta el fallo, y evento sin inscripción.
-- ==================================================================

-- 0. Arreglo: a documentos_evento le faltaban columnas que el frontend
--    ya usa (titulo, pagina_rellenable) — la migración que debía
--    añadirlas nunca llegó a aplicarse.
alter table documentos_evento add column if not exists titulo text not null default 'Documento';
alter table documentos_evento add column if not exists pagina_rellenable integer not null default 1;
alter table documentos_evento alter column titulo drop default;
alter table documentos_evento alter column pagina_rellenable drop default;

-- 1. Nuevas columnas en eventos ---------------------------------------------
alter table eventos add column if not exists abierto_no_socios boolean not null default false;
alter table eventos add column if not exists fecha_apertura_socios timestamptz;
alter table eventos add column if not exists fecha_apertura_no_socios timestamptz;
alter table eventos add column if not exists fecha_cierre_inscripcion timestamptz;
alter table eventos add column if not exists metodo_asignacion text not null default 'aforo'
  check (metodo_asignacion in ('aforo', 'sorteo'));
alter table eventos add column if not exists requiere_pareja_adulto_alumno boolean not null default false;
alter table eventos add column if not exists usa_prioridad_historial boolean not null default false;
alter table eventos add column if not exists sorteo_realizado boolean not null default false;
alter table eventos add column if not exists sin_inscripcion boolean not null default false;
alter table eventos add column if not exists precio_adulto numeric(8,2);
alter table eventos add column if not exists precio_alumno numeric(8,2);

-- 2. Prioridad histórica del Comedor (per-adulto, no por socio, porque
--    quien visita es una persona concreta, no toda la familia) -------------
alter table adultos add column if not exists ya_visito_comedor boolean not null default false;

-- 3. Estado de la inscripción (para eventos con sorteo) y agrupación de
--    parejas adulto+alumno (Cabalgata) ---------------------------------------
alter table evento_inscripciones add column if not exists estado text not null default 'pendiente'
  check (estado in ('pendiente', 'ganador', 'no_ganador'));
alter table evento_inscripciones add column if not exists grupo_id uuid;

-- 4. Un alumno solo puede apuntarse como voluntario si ya hay un adulto
--    de su misma familia apuntado como voluntario en el mismo evento -------
create or replace function verificar_alumno_voluntario_acompanado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo_miembro = 'alumno' and new.es_voluntario = true then
    if not exists (
      select 1 from evento_inscripciones
      where evento_id = new.evento_id and socio_id = new.socio_id
        and tipo_miembro = 'adulto' and es_voluntario = true
    ) then
      raise exception 'Un alumno solo puede apuntarse como voluntario si un adulto de la familia también lo hace en este evento.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verificar_alumno_voluntario on evento_inscripciones;
create trigger trg_verificar_alumno_voluntario
before insert on evento_inscripciones
for each row execute function verificar_alumno_voluntario_acompanado();

-- 5. Concurso literario: envío anónimo hasta que se decide el ganador -------
create table if not exists concurso_envios (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  texto text not null,
  es_ganador boolean not null default false,
  created_at timestamptz not null default now()
);

alter table concurso_envios enable row level security;
-- El admin ve el TEXTO de todos los envíos (para poder juzgarlos), pero
-- nunca a través de esta tabla sabrá quién lo escribió.
create policy "admins ven los textos de los envios" on concurso_envios for select
  using (is_admin());
create policy "admins marcan ganadores" on concurso_envios for update
  using (is_admin()) with check (is_admin());

-- La identidad solo es visible para el admin cuando ese envío concreto
-- ya está marcado como ganador. Los envíos que no ganan permanecen
-- anónimos para siempre, incluso para el admin.
create table if not exists concurso_identidades (
  envio_id uuid primary key references concurso_envios(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  alumno_id uuid references alumnos(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table concurso_identidades enable row level security;
create policy "admins ven identidad solo de envios ganadores" on concurso_identidades for select
  using (
    is_admin() and exists (select 1 from concurso_envios ce where ce.id = envio_id and ce.es_ganador = true)
  );
create policy "socios ven su propio envio" on concurso_identidades for select
  using (socio_id = mi_socio_id());

-- Única vía de envío: guarda texto e identidad de forma atómica, con la
-- identidad protegida por la política de arriba desde el primer momento.
create or replace function concurso_enviar_texto(p_evento_id uuid, p_texto text, p_alumno_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
  v_envio_id uuid;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if p_texto is null or length(trim(p_texto)) = 0 then
    raise exception 'El texto no puede estar vacío.';
  end if;

  insert into concurso_envios (evento_id, texto) values (p_evento_id, p_texto)
  returning id into v_envio_id;

  insert into concurso_identidades (envio_id, socio_id, alumno_id)
  values (v_envio_id, v_socio_id, p_alumno_id);

  return v_envio_id;
end;
$$;
grant execute on function concurso_enviar_texto(uuid, text, uuid) to authenticated;
