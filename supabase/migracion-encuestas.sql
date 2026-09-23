-- ==================================================================
-- ENCUESTAS — opción única, opción múltiple y texto libre, con
-- anonimato opcional por encuesta. Todas las escrituras del socio pasan
-- por la función encuesta_responder(), que hace las comprobaciones y
-- las inserciones en una sola transacción atómica.
-- ==================================================================

-- 1. La encuesta en sí -----------------------------------------------------
create table if not exists encuestas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  anonima boolean not null default false,
  fecha_cierre timestamptz, -- null = sin fecha, se cierra a mano
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  created_at timestamptz not null default now()
);

alter table encuestas enable row level security;
create policy "todos ven las encuestas" on encuestas for select using (true);
create policy "admins gestionan las encuestas" on encuestas for all
  using (is_admin()) with check (is_admin());

-- 2. Preguntas ---------------------------------------------------------------
create table if not exists encuesta_preguntas (
  id uuid primary key default gen_random_uuid(),
  encuesta_id uuid not null references encuestas(id) on delete cascade,
  texto text not null,
  tipo text not null check (tipo in ('opcion_unica', 'opcion_multiple', 'texto_libre')),
  orden integer not null default 0
);

alter table encuesta_preguntas enable row level security;
create policy "todos ven las preguntas" on encuesta_preguntas for select using (true);
create policy "admins gestionan las preguntas" on encuesta_preguntas for all
  using (is_admin()) with check (is_admin());

-- 3. Opciones (solo para opcion_unica / opcion_multiple) ----------------------
create table if not exists encuesta_opciones (
  id uuid primary key default gen_random_uuid(),
  pregunta_id uuid not null references encuesta_preguntas(id) on delete cascade,
  texto text not null,
  orden integer not null default 0
);

alter table encuesta_opciones enable row level security;
create policy "todos ven las opciones" on encuesta_opciones for select using (true);
create policy "admins gestionan las opciones" on encuesta_opciones for all
  using (is_admin()) with check (is_admin());

-- 4. Control de quién ha respondido (separado de las respuestas en sí,
--    para que una encuesta anónima pueda impedir el doble envío sin que
--    eso permita rastrear qué contestó cada persona) ------------------------
create table if not exists encuesta_control_respondidos (
  encuesta_id uuid not null references encuestas(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (encuesta_id, socio_id)
);

alter table encuesta_control_respondidos enable row level security;
create policy "socios ven si ya respondieron" on encuesta_control_respondidos for select
  using (socio_id = mi_socio_id());
create policy "admins ven quien ha respondido" on encuesta_control_respondidos for select
  using (is_admin());

-- 5. Envíos (un envío = una persona completando la encuesta una vez) ---------
-- socio_id queda NULL cuando la encuesta es anónima: es la única
-- garantía real de anonimato, así que ninguna función debe rellenarlo
-- en ese caso.
create table if not exists encuesta_envios (
  id uuid primary key default gen_random_uuid(),
  encuesta_id uuid not null references encuestas(id) on delete cascade,
  socio_id uuid references socios(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table encuesta_envios enable row level security;
create policy "socios ven sus propios envios" on encuesta_envios for select
  using (socio_id = mi_socio_id());
create policy "admins ven todos los envios" on encuesta_envios for select
  using (is_admin());

-- 6. Respuestas individuales ---------------------------------------------------
-- Para opcion_multiple se inserta una fila por cada opción marcada
-- (mismo envio_id, mismo pregunta_id, distinto opcion_id).
create table if not exists encuesta_respuestas (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null references encuesta_envios(id) on delete cascade,
  pregunta_id uuid not null references encuesta_preguntas(id) on delete cascade,
  opcion_id uuid references encuesta_opciones(id) on delete cascade,
  texto_libre text,
  check (opcion_id is not null or texto_libre is not null)
);

alter table encuesta_respuestas enable row level security;
create policy "socios ven sus propias respuestas" on encuesta_respuestas for select
  using (exists (select 1 from encuesta_envios ev where ev.id = envio_id and ev.socio_id = mi_socio_id()));
create policy "admins ven todas las respuestas" on encuesta_respuestas for select
  using (is_admin());

-- 7. Responder una encuesta (única vía de escritura para un socio) -----------
-- p_respuestas es un array JSON como:
--   [{"pregunta_id": "...", "opcion_ids": ["...", "..."]},
--    {"pregunta_id": "...", "texto_libre": "..."}]
create or replace function encuesta_responder(p_encuesta_id uuid, p_respuestas jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_encuesta encuestas;
  v_socio_id uuid := mi_socio_id();
  v_envio_id uuid;
  v_item jsonb;
  v_opcion_id text;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;

  select * into v_encuesta from encuestas where id = p_encuesta_id;
  if not found then
    raise exception 'La encuesta no existe.';
  end if;
  if v_encuesta.estado <> 'abierta' or (v_encuesta.fecha_cierre is not null and now() >= v_encuesta.fecha_cierre) then
    raise exception 'Esta encuesta ya está cerrada.';
  end if;

  if exists (select 1 from encuesta_control_respondidos where encuesta_id = p_encuesta_id and socio_id = v_socio_id) then
    raise exception 'Ya has respondido esta encuesta.';
  end if;

  insert into encuesta_control_respondidos (encuesta_id, socio_id) values (p_encuesta_id, v_socio_id);

  insert into encuesta_envios (encuesta_id, socio_id)
  values (p_encuesta_id, case when v_encuesta.anonima then null else v_socio_id end)
  returning id into v_envio_id;

  for v_item in select * from jsonb_array_elements(p_respuestas)
  loop
    if v_item ? 'opcion_ids' then
      for v_opcion_id in select jsonb_array_elements_text(v_item -> 'opcion_ids')
      loop
        insert into encuesta_respuestas (envio_id, pregunta_id, opcion_id)
        values (v_envio_id, (v_item ->> 'pregunta_id')::uuid, v_opcion_id::uuid);
      end loop;
    else
      insert into encuesta_respuestas (envio_id, pregunta_id, texto_libre)
      values (v_envio_id, (v_item ->> 'pregunta_id')::uuid, v_item ->> 'texto_libre');
    end if;
  end loop;

  return v_envio_id;
end;
$$;
grant execute on function encuesta_responder(uuid, jsonb) to authenticated;
