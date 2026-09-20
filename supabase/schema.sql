-- ============================================================
-- PORTAL AMPA — ESQUEMA V2 (reconstrucción completa)
-- Refleja el documento "Modelo de datos consolidado" (15 secciones).
-- Pensado para un proyecto Supabase NUEVO o reseteado por completo:
-- el cambio de fondo (login por adulto, no por cuenta) hace inviable
-- una migración segura en caliente desde el esquema anterior.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- FUNCIONES AUXILIARES (evitan recursión infinita en RLS)
-- ------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (select 1 from adultos where id = auth.uid() and role = 'admin');
$$;

create or replace function mi_socio_id()
returns uuid language sql security definer set search_path = public stable
as $$
  select socio_id from adultos where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 1. SOCIOS (cuenta familiar — sin nombre propio, solo el número)
-- ------------------------------------------------------------
create table if not exists socios (
  id uuid primary key default gen_random_uuid(),
  anio_ultima_cuota integer not null,
  codigo_asociacion text not null default '0300',
  numero_secuencial text check (numero_secuencial ~ '^[0-9]{4}$'),
  numero_socio_completo text generated always as (
    case when numero_secuencial is not null
      then lpad(anio_ultima_cuota::text, 4, '0') || codigo_asociacion || numero_secuencial
    end
  ) stored,
  estado text not null default 'recien_creada'
    check (estado in ('activa','recien_creada','falta_pago','baja')),
  forma_pago text check (forma_pago in ('Transferencia','Domiciliación Bancaria')),
  iban text,
  created_at timestamptz not null default now()
);

create unique index if not exists socios_numero_socio_completo_idx
  on socios (numero_socio_completo) where numero_socio_completo is not null;

alter table socios enable row level security;

create policy "adultos ven su propio socio" on socios for select
  using (id = mi_socio_id());

create policy "adultos actualizan su propio socio" on socios for update
  using (id = mi_socio_id());

create policy "admins ven todos los socios" on socios for select
  using (is_admin());

create policy "admins actualizan cualquier socio" on socios for update
  using (is_admin());

create policy "admins crean socios" on socios for insert
  with check (is_admin());

-- El alta autoservicio también necesita poder crear su propia fila de
-- socio (estado recien_creada) antes de que exista sesión con socio_id,
-- así que se permite inserción pública controlada:
create policy "autoservicio crea su propio socio" on socios for insert
  with check (estado = 'recien_creada' and numero_secuencial is null);

-- ------------------------------------------------------------
-- 2. ADULTOS (1 o 2 por socio, login individual)
-- ------------------------------------------------------------
create table if not exists adultos (
  id uuid primary key references auth.users(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  nombre text not null,
  apellidos text not null,
  es_pasaporte boolean not null default false,
  dni_nie text not null,
  sexo text check (sexo in ('Masculino','Femenino','Otro')),
  email text not null,
  direccion text not null,
  ciudad text not null,
  provincia text not null,
  codigo_postal text not null,
  telefono_fijo text,
  movil text,
  relacion_alumnos text,
  role text not null default 'socio' check (role in ('socio','admin')),
  force_password_change boolean not null default true,
  created_at timestamptz not null default now()
);

alter table adultos enable row level security;

create policy "adultos ven su propia fila" on adultos for select
  using (id = auth.uid());

create policy "adultos ven a su pareja del mismo socio" on adultos for select
  using (socio_id = mi_socio_id());

create policy "adultos actualizan su propia fila" on adultos for update
  using (id = auth.uid());

create policy "admins ven todos los adultos" on adultos for select
  using (is_admin());

create policy "admins actualizan cualquier adulto" on adultos for update
  using (is_admin());

create policy "admins crean adultos" on adultos for insert
  with check (is_admin());

create policy "autoservicio crea su propio adulto" on adultos for insert
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- 3. ALUMNOS
-- ------------------------------------------------------------
create table if not exists alumnos (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  nombre text not null,
  apellidos text not null,
  fecha_nacimiento date,
  sexo text check (sexo in ('Masculino','Femenino','Otro')),
  etapa text not null check (etapa in ('Infantil','Primaria','ESO','Bachillerato')),
  curso text not null,
  aula text check (aula in ('A','B','C','D')),
  verificado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table alumnos enable row level security;

create policy "socios gestionan sus alumnos" on alumnos for all
  using (socio_id = mi_socio_id())
  with check (socio_id = mi_socio_id());

create policy "admins ven y gestionan todos los alumnos" on alumnos for all
  using (is_admin());

-- ------------------------------------------------------------
-- 4. MANDATOS SEPA (domiciliación bancaria)
-- ------------------------------------------------------------
create table if not exists mandatos_sepa (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  firmado_por uuid references adultos(id),
  iban text not null,
  archivo_url text not null,
  vigente boolean not null default true,
  created_at timestamptz not null default now()
);

alter table mandatos_sepa enable row level security;

-- La familia puede CREAR un mandato (rellenar y firmar), pero no verlo
-- después: solo select para admins.
create policy "socios crean su mandato sepa" on mandatos_sepa for insert
  with check (socio_id = mi_socio_id());

create policy "admins ven todos los mandatos" on mandatos_sepa for select
  using (is_admin());

create policy "admins gestionan mandatos" on mandatos_sepa for update
  using (is_admin());

-- ------------------------------------------------------------
-- 5. EVENTOS
-- ------------------------------------------------------------
create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  fecha timestamptz,
  activo boolean not null default true,
  tipo_elegibilidad text not null default 'toda_familia'
    check (tipo_elegibilidad in ('toda_familia','alumnos','adultos')),
  elegibilidad_modo text check (elegibilidad_modo in ('curso','edad')),
  cursos_permitidos jsonb,
  edad_min integer,
  edad_max integer,
  aforo_total integer,
  permite_invitados boolean not null default false,
  precio_invitado numeric(8,2),
  voluntariado_habilitado boolean not null default false,
  voluntariado_excluye_asistencia boolean not null default false,
  created_by uuid references adultos(id),
  created_at timestamptz not null default now()
);

alter table eventos enable row level security;

create policy "todos ven eventos activos" on eventos for select
  using (activo = true or is_admin());

create policy "admins gestionan eventos" on eventos for all
  using (is_admin())
  with check (is_admin());

-- ------------------------------------------------------------
-- 6. ACTIVIDADES (dentro de un evento)
-- ------------------------------------------------------------
create table if not exists evento_actividades (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  nombre text not null,
  horario text,
  aforo integer,
  elegibilidad_modo text check (elegibilidad_modo in ('curso','edad')),
  cursos_permitidos jsonb,
  edad_min integer,
  edad_max integer,
  voluntariado_habilitado boolean not null default false,
  voluntariado_excluye_asistencia boolean not null default false,
  created_at timestamptz not null default now()
);

alter table evento_actividades enable row level security;

create policy "todos ven actividades de eventos visibles" on evento_actividades for select
  using (
    exists (select 1 from eventos e where e.id = evento_id and (e.activo = true or is_admin()))
  );

create policy "admins gestionan actividades" on evento_actividades for all
  using (is_admin())
  with check (is_admin());

-- ------------------------------------------------------------
-- 7. EXCLUSIONES ENTRE ACTIVIDADES (pares simétricos)
-- ------------------------------------------------------------
create table if not exists actividad_exclusiones (
  id uuid primary key default gen_random_uuid(),
  actividad_id_1 uuid not null references evento_actividades(id) on delete cascade,
  actividad_id_2 uuid not null references evento_actividades(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (actividad_id_1 <> actividad_id_2)
);

alter table actividad_exclusiones enable row level security;

create policy "todos ven exclusiones" on actividad_exclusiones for select
  using (true);

create policy "admins gestionan exclusiones" on actividad_exclusiones for all
  using (is_admin())
  with check (is_admin());

-- ------------------------------------------------------------
-- 8. INSCRIPCIONES A EVENTOS/ACTIVIDADES
-- ------------------------------------------------------------
create table if not exists evento_inscripciones (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  actividad_id uuid references evento_actividades(id) on delete cascade,
  tipo_miembro text not null check (tipo_miembro in ('adulto','alumno','invitado','publico')),
  socio_id uuid references socios(id),
  adulto_id uuid references adultos(id),
  alumno_id uuid references alumnos(id),
  nombre_invitado text,
  nombre_contacto text,
  email_contacto text,
  telefono_contacto text,
  es_voluntario boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (tipo_miembro = 'adulto' and adulto_id is not null and socio_id is not null) or
    (tipo_miembro = 'alumno' and alumno_id is not null and socio_id is not null) or
    (tipo_miembro = 'invitado' and nombre_invitado is not null and socio_id is not null) or
    (tipo_miembro = 'publico' and nombre_contacto is not null and email_contacto is not null)
  )
);

alter table evento_inscripciones enable row level security;

create policy "socios gestionan inscripciones de su familia" on evento_inscripciones for all
  using (socio_id = mi_socio_id())
  with check (socio_id = mi_socio_id());

create policy "publico se inscribe sin login" on evento_inscripciones for insert
  with check (tipo_miembro = 'publico' and socio_id is null);

create policy "admins ven y gestionan todas las inscripciones" on evento_inscripciones for all
  using (is_admin());

create or replace function evento_plazas_disponibles(p_evento_id uuid)
returns integer language sql security definer set search_path = public stable as $$
  select case when e.aforo_total is null then null
    else e.aforo_total - (select count(*) from evento_inscripciones i where i.evento_id = p_evento_id)::integer
  end
  from eventos e where e.id = p_evento_id;
$$;
grant execute on function evento_plazas_disponibles(uuid) to authenticated, anon;

create or replace function actividad_plazas_disponibles(p_actividad_id uuid)
returns integer language sql security definer set search_path = public stable as $$
  select case when a.aforo is null then null
    else a.aforo - (select count(*) from evento_inscripciones i where i.actividad_id = p_actividad_id)::integer
  end
  from evento_actividades a where a.id = p_actividad_id;
$$;
grant execute on function actividad_plazas_disponibles(uuid) to authenticated, anon;

create or replace function siguiente_numero_secuencial()
returns text language sql security definer set search_path = public as $$
  select lpad((coalesce(max(numero_secuencial::int), 0) + 1)::text, 4, '0')
  from socios where numero_secuencial is not null;
$$;
grant execute on function siguiente_numero_secuencial() to authenticated;

-- ------------------------------------------------------------
-- 8b. MOCHILA JUGONA EXPLORADORA
-- ------------------------------------------------------------
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

create or replace function mochila_asignar_posicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  lock table mochila_cola in share row exclusive mode;
  new.posicion := coalesce((select max(posicion) from mochila_cola), 0) + 1;
  return new;
end;
$$;

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

create or replace function mochila_cola_length()
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::integer from mochila_cola;
$$;
grant execute on function mochila_cola_length() to authenticated, anon;

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
    return null;
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

-- ------------------------------------------------------------
-- 9. COMPROBANTES DE PAGO (cuota anual, invitados y mochila)
-- ------------------------------------------------------------
create table if not exists comprobantes_pago (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cuota_socio','invitado_evento','mochila_no_socio')),
  socio_id uuid references socios(id) on delete cascade,
  evento_inscripcion_id uuid references evento_inscripciones(id) on delete cascade,
  mochila_cola_id uuid references mochila_cola(id) on delete set null,
  archivo_url text not null,
  verificado boolean not null default false,
  reembolsado boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (tipo = 'cuota_socio' and socio_id is not null) or
    (tipo = 'invitado_evento' and evento_inscripcion_id is not null) or
    (tipo = 'mochila_no_socio' and mochila_cola_id is not null)
  )
);

alter table comprobantes_pago enable row level security;

create policy "socios suben su comprobante de cuota" on comprobantes_pago for insert
  with check (tipo = 'cuota_socio' and socio_id = mi_socio_id());

create policy "cualquiera sube comprobante de invitado" on comprobantes_pago for insert
  with check (tipo = 'invitado_evento');

create policy "admins ven y gestionan comprobantes" on comprobantes_pago for all
  using (is_admin());

-- ------------------------------------------------------------
-- 10. DOCUMENTOS DE EVENTO (plantilla a firmar, o subida libre)
-- ------------------------------------------------------------
create table if not exists documentos_evento (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  aplica_a text not null check (aplica_a in ('adulto','alumno')),
  tipo_documento text not null default 'plantilla_firma'
    check (tipo_documento in ('plantilla_firma','archivo_libre')),
  elegibilidad_modo text check (elegibilidad_modo in ('curso','edad')),
  cursos_permitidos jsonb,
  edad_min integer,
  edad_max integer,
  archivo_base_url text,
  campos jsonb,
  created_at timestamptz not null default now()
);

alter table documentos_evento enable row level security;

create policy "todos ven documentos de eventos visibles" on documentos_evento for select
  using (
    exists (select 1 from eventos e where e.id = evento_id and (e.activo = true or is_admin()))
  );

create policy "admins gestionan documentos de evento" on documentos_evento for all
  using (is_admin())
  with check (is_admin());

create table if not exists documentos_evento_respuestas (
  id uuid primary key default gen_random_uuid(),
  documento_evento_id uuid not null references documentos_evento(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  adulto_id uuid references adultos(id),
  alumno_id uuid references alumnos(id),
  archivo_final_url text not null,
  datos_finales jsonb,
  aviso_diferencias boolean not null default false,
  created_at timestamptz not null default now()
);

alter table documentos_evento_respuestas enable row level security;

create policy "socios crean y ven sus respuestas de documento" on documentos_evento_respuestas for all
  using (socio_id = mi_socio_id())
  with check (socio_id = mi_socio_id());

create policy "admins ven todas las respuestas de documento" on documentos_evento_respuestas for select
  using (is_admin());

-- ------------------------------------------------------------
-- 11. CATÁLOGO DE LIBROS Y PRÉSTAMO
-- ------------------------------------------------------------
create table if not exists libros_catalogo (
  id uuid primary key default gen_random_uuid(),
  etapa text not null check (etapa in ('Infantil','Primaria','ESO','Bachillerato')),
  curso text not null,
  titulo text not null,
  editorial text not null,
  isbn text not null,
  asignatura text not null check (asignatura in ('Lengua', 'Inglés', 'Alemán')),
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

alter table libros_catalogo enable row level security;

create policy "todos ven el catalogo de libros" on libros_catalogo for select
  using (true);

create policy "admins gestionan el catalogo" on libros_catalogo for all
  using (is_admin())
  with check (is_admin());

-- Ejemplares físicos individuales. El código es el número impreso en el
-- libro (p.ej. "0001"), lo asigna el admin a mano al dar de alta cada
-- copia física. Único en todo el catálogo, no solo dentro de un título.
create table if not exists libros_ejemplares (
  id uuid primary key default gen_random_uuid(),
  libro_id uuid not null references libros_catalogo(id) on delete cascade,
  codigo text not null,
  estado text not null default 'disponible' check (estado in ('disponible', 'prestado', 'perdido', 'baja')),
  created_at timestamptz not null default now()
);
create unique index if not exists libros_ejemplares_codigo_unico on libros_ejemplares (codigo);

alter table libros_ejemplares enable row level security;
create policy "todos ven los ejemplares" on libros_ejemplares for select using (true);
create policy "admins gestionan los ejemplares" on libros_ejemplares for all
  using (is_admin()) with check (is_admin());

-- libros_catalogo.stock ya no se edita a mano: es el total de ejemplares
-- de ese título que no estén de baja, recalculado automáticamente.
create or replace function recalcular_stock_libro()
returns trigger language plpgsql security definer as $$
declare
  v_libro_id uuid;
begin
  v_libro_id := coalesce(new.libro_id, old.libro_id);
  update libros_catalogo
    set stock = (select count(*) from libros_ejemplares where libro_id = v_libro_id and estado <> 'baja')
    where id = v_libro_id;
  return null;
end;
$$;

create trigger trg_recalcular_stock_libro
after insert or update or delete on libros_ejemplares
for each row execute function recalcular_stock_libro();

-- Convocatorias de préstamo (la ventana de tiempo para pedir). El cierre
-- de peticiones es automático por fecha; el reparto lo dispara el admin
-- con un botón.
create table if not exists prestamo_convocatorias (
  id uuid primary key default gen_random_uuid(),
  fecha_cierre timestamptz not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'repartida')),
  created_at timestamptz not null default now()
);
create unique index if not exists prestamo_convocatorias_una_abierta
  on prestamo_convocatorias ((estado = 'abierta')) where estado = 'abierta';

alter table prestamo_convocatorias enable row level security;
create policy "todos ven las convocatorias de prestamo" on prestamo_convocatorias for select
  using (true);
create policy "admins gestionan las convocatorias de prestamo" on prestamo_convocatorias for all
  using (is_admin())
  with check (is_admin());

create table if not exists prestamo_items (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid references alumnos(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  libro_id uuid not null references libros_catalogo(id),
  tipo text not null default 'solicitud' check (tipo in ('solicitud','donacion')),
  convocatoria_id uuid references prestamo_convocatorias(id) on delete cascade,
  ejemplar_id uuid references libros_ejemplares(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'no_asignado')),
  fecha_asignacion date,
  fecha_devolucion date,
  created_at timestamptz not null default now(),
  check (tipo = 'donacion' or alumno_id is not null),
  check (tipo = 'donacion' or convocatoria_id is not null)
);

alter table prestamo_items enable row level security;

create policy "socios ven sus propias solicitudes" on prestamo_items for select
  using (socio_id = mi_socio_id());

create policy "socios piden libros durante la convocatoria abierta" on prestamo_items for insert
  with check (
    socio_id = mi_socio_id()
    and (
      tipo = 'donacion'
      or exists (
        select 1 from prestamo_convocatorias c
        where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
      )
    )
  );

create policy "socios borran sus solicitudes pendientes" on prestamo_items for delete
  using (
    socio_id = mi_socio_id()
    and estado = 'pendiente'
    and exists (
      select 1 from prestamo_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

create policy "admins ven y gestionan todas las solicitudes" on prestamo_items for all
  using (is_admin());

create or replace function prestamo_admin_asignar(p_item_id uuid, p_ejemplar_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
  v_ejemplar libros_ejemplares;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_item from prestamo_items where id = p_item_id;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  select * into v_ejemplar from libros_ejemplares where id = p_ejemplar_id;
  if not found then
    raise exception 'El ejemplar no existe.';
  end if;
  if v_ejemplar.libro_id <> v_item.libro_id then
    raise exception 'Ese ejemplar no es del mismo título que la solicitud.';
  end if;
  if v_ejemplar.estado <> 'disponible' and v_item.ejemplar_id <> p_ejemplar_id then
    raise exception 'Ese ejemplar no está disponible.';
  end if;

  if v_item.ejemplar_id is not null and v_item.ejemplar_id <> p_ejemplar_id then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;

  update libros_ejemplares set estado = 'prestado' where id = p_ejemplar_id;
  update prestamo_items
    set ejemplar_id = p_ejemplar_id, estado = 'asignado', fecha_asignacion = coalesce(fecha_asignacion, current_date)
    where id = p_item_id;
end;
$$;
grant execute on function prestamo_admin_asignar(uuid, uuid) to authenticated;

create or replace function prestamo_admin_quitar(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_item from prestamo_items where id = p_item_id;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  if v_item.ejemplar_id is not null then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;

  update prestamo_items
    set ejemplar_id = null, estado = 'no_asignado', fecha_asignacion = null
    where id = p_item_id;
end;
$$;
grant execute on function prestamo_admin_quitar(uuid) to authenticated;

create or replace function prestamo_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  update libros_ejemplares
    set estado = 'disponible'
    where id in (
      select ejemplar_id from prestamo_items
      where convocatoria_id = p_convocatoria_id and ejemplar_id is not null
    );

  update prestamo_items
    set ejemplar_id = null, estado = 'pendiente', fecha_asignacion = null
    where convocatoria_id = p_convocatoria_id and tipo = 'solicitud';

  update prestamo_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;
grant execute on function prestamo_admin_resetear_reparto(uuid) to authenticated;

-- ------------------------------------------------------------
-- 12. DOCUMENTOS / NEWSLETTERS (sin cambios respecto a v1)
-- ------------------------------------------------------------
create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'documento' check (categoria in ('newsletter','documento')),
  url text not null,
  fecha date,
  activo boolean not null default true,
  created_by uuid references adultos(id),
  created_at timestamptz not null default now()
);

alter table documentos enable row level security;

create policy "todos ven documentos activos" on documentos for select
  using (activo = true or is_admin());

create policy "admins gestionan documentos" on documentos for all
  using (is_admin())
  with check (is_admin());

-- ------------------------------------------------------------
-- 13. FOTOS DE CARRUSEL (portada si evento_id es null, o de un evento)
-- ------------------------------------------------------------
create table if not exists fotos_carrusel (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid references eventos(id) on delete cascade,
  url text not null,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

alter table fotos_carrusel enable row level security;

create policy "todos ven fotos de carrusel" on fotos_carrusel for select
  using (
    evento_id is null
    or exists (select 1 from eventos e where e.id = evento_id and (e.activo = true or is_admin()))
  );

create policy "admins gestionan fotos de carrusel" on fotos_carrusel for all
  using (is_admin())
  with check (is_admin());

insert into storage.buckets (id, name, public) values ('carrusel', 'carrusel', true) on conflict (id) do nothing;

create policy "lectura publica bucket carrusel" on storage.objects for select
  using (bucket_id = 'carrusel');
create policy "admins suben bucket carrusel" on storage.objects for insert
  with check (bucket_id = 'carrusel' and is_admin());
create policy "admins borran bucket carrusel" on storage.objects for delete
  using (bucket_id = 'carrusel' and is_admin());

-- ------------------------------------------------------------
-- BUCKETS DE ALMACENAMIENTO
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documentos', 'documentos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('mandatos-sepa', 'mandatos-sepa', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('documentos-evento', 'documentos-evento', false) on conflict (id) do nothing;

create policy "lectura publica bucket documentos" on storage.objects for select
  using (bucket_id = 'documentos');
create policy "admins suben bucket documentos" on storage.objects for insert
  with check (bucket_id = 'documentos' and is_admin());
create policy "admins borran bucket documentos" on storage.objects for delete
  using (bucket_id = 'documentos' and is_admin());

create policy "usuarios suben comprobantes" on storage.objects for insert
  with check (bucket_id = 'comprobantes');
create policy "admins leen comprobantes" on storage.objects for select
  using (bucket_id = 'comprobantes' and is_admin());

create policy "usuarios suben mandatos sepa" on storage.objects for insert
  with check (bucket_id = 'mandatos-sepa');
create policy "admins leen mandatos sepa" on storage.objects for select
  using (bucket_id = 'mandatos-sepa' and is_admin());

create policy "usuarios suben documentos de evento" on storage.objects for insert
  with check (bucket_id = 'documentos-evento');
create policy "todos leen documentos de evento visibles" on storage.objects for select
  using (bucket_id = 'documentos-evento');
create policy "admins suben plantillas de documentos de evento" on storage.objects for update
  using (bucket_id = 'documentos-evento' and is_admin());

-- ============================================================
-- FIN DEL ESQUEMA V2
-- Siguiente paso: crear el primer admin a mano (socio + adulto con
-- role='admin'), ver README.
-- ============================================================

-- ------------------------------------------------------------
-- 13. ENTREGA DE UNIFORMES
-- ------------------------------------------------------------
-- ==================================================================
-- ENTREGA DE UNIFORMES — catálogo, convocatorias y pedidos priorizados.
-- El reparto en sí (algoritmo) va en la función de Netlify
-- uniformes-repartir.js; aquí solo van las tablas, RLS y las acciones
-- de admin para editar a mano después del reparto.
-- ==================================================================

-- 1. Catálogo de prendas ---------------------------------------------------
create table if not exists prendas_catalogo (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('Sudadera', 'Pantalón Largo', 'Pantalón Corto', 'Camiseta', 'Baby')),
  talla text not null check (talla in ('1','2','3','4','6','8','10','12','14','16','18','20')),
  stock integer not null default 0,
  created_at timestamptz not null default now(),
  check (tipo <> 'Baby' or talla in ('1','2','3','4','6'))
);
create unique index if not exists prendas_catalogo_tipo_talla_unico on prendas_catalogo (tipo, talla);

alter table prendas_catalogo enable row level security;
create policy "todos ven el catalogo de prendas" on prendas_catalogo for select using (true);
create policy "admins gestionan el catalogo de prendas" on prendas_catalogo for all
  using (is_admin()) with check (is_admin());

-- 2. Convocatorias de uniformes ---------------------------------------------
create table if not exists uniformes_convocatorias (
  id uuid primary key default gen_random_uuid(),
  fecha_cierre timestamptz not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'repartida')),
  created_at timestamptz not null default now()
);
create unique index if not exists uniformes_convocatorias_una_abierta
  on uniformes_convocatorias ((estado = 'abierta')) where estado = 'abierta';

alter table uniformes_convocatorias enable row level security;
create policy "todos ven las convocatorias de uniformes" on uniformes_convocatorias for select
  using (true);
create policy "admins gestionan las convocatorias de uniformes" on uniformes_convocatorias for all
  using (is_admin())
  with check (is_admin());

-- 3. Pedidos (3 prioridades por alumno) --------------------------------------
-- prioridad 0 = asignación manual del admin (no es una de las 3 opciones
-- reales de la familia, sino un ajuste posterior al reparto).
create table if not exists uniformes_pedidos (
  id uuid primary key default gen_random_uuid(),
  convocatoria_id uuid not null references uniformes_convocatorias(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  alumno_id uuid not null references alumnos(id) on delete cascade,
  prioridad integer not null check (prioridad in (0, 1, 2, 3)),
  prenda_id uuid not null references prendas_catalogo(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'no_asignado')),
  created_at timestamptz not null default now()
);
create unique index if not exists uniformes_pedidos_unico on uniformes_pedidos (alumno_id, convocatoria_id, prioridad);

alter table uniformes_pedidos enable row level security;

create policy "socios ven sus propios pedidos de uniformes" on uniformes_pedidos for select
  using (socio_id = mi_socio_id());

create policy "socios piden uniformes durante la convocatoria abierta" on uniformes_pedidos for insert
  with check (
    socio_id = mi_socio_id()
    and prioridad in (1, 2, 3)
    and exists (
      select 1 from uniformes_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

create policy "socios borran sus pedidos pendientes" on uniformes_pedidos for delete
  using (
    socio_id = mi_socio_id()
    and estado = 'pendiente'
    and exists (
      select 1 from uniformes_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

create policy "admins ven y gestionan todos los pedidos de uniformes" on uniformes_pedidos for all
  using (is_admin());

-- 4. Acciones de admin tras el reparto ---------------------------------------

-- Asigna (o reasigna) una prenda concreta a un alumno. Si el alumno ya
-- tenía otra prenda asignada en esta convocatoria, la devuelve al stock.
-- Si la prenda no era una de sus 3 opciones originales, crea una fila
-- nueva con prioridad = 0 para dejar constancia de que fue un ajuste manual.
create or replace function uniformes_admin_asignar(p_alumno_id uuid, p_convocatoria_id uuid, p_prenda_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid;
  v_actual uniformes_pedidos;
  v_stock integer;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select socio_id into v_socio_id from alumnos where id = p_alumno_id;
  if v_socio_id is null then
    raise exception 'El alumno no existe.';
  end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';

  if found and v_actual.prenda_id = p_prenda_id then
    return; -- ya estaba asignada esta misma prenda, nada que hacer
  end if;

  if found then
    update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
    if v_actual.prioridad = 0 then
      delete from uniformes_pedidos where id = v_actual.id;
    else
      update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
    end if;
  end if;

  select stock into v_stock from prendas_catalogo where id = p_prenda_id;
  if v_stock is null or v_stock < 1 then
    raise exception 'Esa prenda no tiene stock disponible.';
  end if;

  update prendas_catalogo set stock = stock - 1 where id = p_prenda_id;

  insert into uniformes_pedidos (convocatoria_id, socio_id, alumno_id, prioridad, prenda_id, estado)
  values (p_convocatoria_id, v_socio_id, p_alumno_id, 0, p_prenda_id, 'asignado')
  on conflict (alumno_id, convocatoria_id, prioridad)
  do update set prenda_id = excluded.prenda_id, estado = 'asignado';
end;
$$;
grant execute on function uniformes_admin_asignar(uuid, uuid, uuid) to authenticated;

-- Quita la prenda asignada a un alumno; la devuelve al stock.
create or replace function uniformes_admin_quitar(p_alumno_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actual uniformes_pedidos;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if not found then
    raise exception 'Este alumno no tiene ninguna prenda asignada.';
  end if;

  update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;

  if v_actual.prioridad = 0 then
    delete from uniformes_pedidos where id = v_actual.id;
  else
    update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
  end if;
end;
$$;
grant execute on function uniformes_admin_quitar(uuid, uuid) to authenticated;

-- Deshace TODO el reparto de una convocatoria: devuelve todo el stock
-- asignado, borra los ajustes manuales, vuelve los pedidos originales a
-- "pendiente" y reabre la convocatoria.
create or replace function uniformes_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  update prendas_catalogo set stock = stock + 1
    where id in (
      select prenda_id from uniformes_pedidos
      where convocatoria_id = p_convocatoria_id and estado = 'asignado'
    );

  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and prioridad = 0;

  update uniformes_pedidos
    set estado = 'pendiente'
    where convocatoria_id = p_convocatoria_id and prioridad in (1, 2, 3);

  update uniformes_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;
grant execute on function uniformes_admin_resetear_reparto(uuid) to authenticated;
