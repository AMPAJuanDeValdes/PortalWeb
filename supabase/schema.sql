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

-- ------------------------------------------------------------
-- 14. ENCUESTAS
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 15. COMENTARIO DIRECTO POR EMAIL
-- ------------------------------------------------------------
-- ==================================================================
-- COMENTARIO DIRECTO POR EMAIL — guarda copia en la base de datos
-- además de enviar el email al AMPA. Las inserciones las hacen las
-- funciones de Netlify con la Service Role (no hay política de insert
-- para usuarios normales: todo pasa por ahí).
-- ==================================================================

create table if not exists comentarios (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('publico', 'socio')),
  socio_id uuid references socios(id) on delete set null,
  nombre_contacto text,
  email_contacto text,
  mensaje text not null,
  created_at timestamptz not null default now(),
  check (origen = 'socio' or email_contacto is not null)
);

alter table comentarios enable row level security;
create policy "admins ven los comentarios" on comentarios for select
  using (is_admin());

-- ------------------------------------------------------------
-- 16. EVENTOS AVANZADO (sorteo, pareja, prioridad, concurso anonimo)
-- ------------------------------------------------------------
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
-- El concurso literario admite un envío POR ALUMNO, no uno por familia.
-- p_alumno_id pasa a ser obligatorio, se valida que pertenezca a la
-- familia del que llama, y se bloquea un segundo envío del mismo alumno
-- para el mismo evento.
create or replace function concurso_enviar_texto(p_evento_id uuid, p_texto text, p_alumno_id uuid)
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
  if p_texto is null or length(trim(p_texto)) = 0 then
    raise exception 'El texto no puede estar vacío.';
  end if;
  if exists (
    select 1 from concurso_identidades ci
    join concurso_envios ce on ce.id = ci.envio_id
    where ce.evento_id = p_evento_id and ci.alumno_id = p_alumno_id
  ) then
    raise exception 'Este alumno/a ya ha enviado un texto para este concurso.';
  end if;

  insert into concurso_envios (evento_id, texto) values (p_evento_id, p_texto)
  returning id into v_envio_id;

  insert into concurso_identidades (envio_id, socio_id, alumno_id)
  values (v_envio_id, v_socio_id, p_alumno_id);

  return v_envio_id;
end;
$$;
grant execute on function concurso_enviar_texto(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 17. EVENTOS: flag de concurso literario
-- ------------------------------------------------------------
alter table eventos add column if not exists usa_concurso_texto boolean not null default false;

-- ------------------------------------------------------------
-- 18. DOMICILIACION BANCARIA (mandato SEPA)
-- ------------------------------------------------------------
-- ==================================================================
-- DOMICILIACIÓN BANCARIA (mandato SEPA) — una sola plantilla global
-- gestionada por el admin (reutiliza el editor de documentoRellenable.js
-- ya construido para documentos de evento). El socio la rellena y
-- firma desde "Mis datos"; al confirmar, se activa la domiciliación al
-- instante (sin revisión de admin) y puede volver a firmar más tarde
-- para cambiar de cuenta, lo que sustituye el mandato anterior.
-- ==================================================================

-- 1. Configuración global (una sola fila) ------------------------------------
create table if not exists mandato_sepa_config (
  id smallint primary key default 1 check (id = 1),
  archivo_base_url text,
  pagina_rellenable integer not null default 1,
  campos jsonb not null default '[]'::jsonb,
  identificador_acreedor text,
  nombre_acreedor text,
  direccion_acreedor text,
  cp_acreedor text,
  pais_acreedor text default 'España',
  updated_at timestamptz not null default now()
);
insert into mandato_sepa_config (id) values (1) on conflict (id) do nothing;

alter table mandato_sepa_config enable row level security;
create policy "todos ven la config del mandato sepa" on mandato_sepa_config for select
  using (true);
create policy "admins editan la config del mandato sepa" on mandato_sepa_config for all
  using (is_admin()) with check (is_admin());

-- 2. Mandatos firmados (historial completo, uno vigente por socio) ------------
create table if not exists mandatos_sepa (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  adulto_id uuid not null references adultos(id) on delete cascade,
  iban text not null,
  archivo_final_url text not null,
  datos_finales jsonb,
  aviso_diferencias boolean not null default false,
  vigente boolean not null default true,
  created_at timestamptz not null default now()
);

alter table mandatos_sepa enable row level security;
create policy "socios ven sus propios mandatos" on mandatos_sepa for select
  using (socio_id = mi_socio_id());
create policy "admins ven y gestionan todos los mandatos" on mandatos_sepa for all
  using (is_admin());

-- 3. Firmar un mandato: guarda el mandato, retira el anterior como no
--    vigente, y activa la domiciliación al instante en socios. -------------
create or replace function mandato_sepa_firmar(
  p_iban text, p_archivo_url text, p_datos_finales jsonb, p_aviso_diferencias boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
  v_id uuid;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if p_iban is null or length(trim(p_iban)) = 0 then
    raise exception 'Falta el IBAN.';
  end if;

  update mandatos_sepa set vigente = false where socio_id = v_socio_id and vigente = true;

  insert into mandatos_sepa (socio_id, adulto_id, iban, archivo_final_url, datos_finales, aviso_diferencias, vigente)
  values (v_socio_id, auth.uid(), p_iban, p_archivo_url, p_datos_finales, p_aviso_diferencias, true)
  returning id into v_id;

  update socios set forma_pago = 'Domiciliación Bancaria', iban = p_iban where id = v_socio_id;

  return v_id;
end;
$$;
grant execute on function mandato_sepa_firmar(text, text, jsonb, boolean) to authenticated;

-- 4. Storage privado para los mandatos firmados (contienen IBAN, no son
--    públicos como el carrusel) --------------------------------------------
insert into storage.buckets (id, name, public) values ('mandatos-sepa', 'mandatos-sepa', false)
  on conflict (id) do nothing;

create policy "socios suben su mandato firmado" on storage.objects for insert
  with check (bucket_id = 'mandatos-sepa');
create policy "socios ven su propio mandato en storage" on storage.objects for select
  using (bucket_id = 'mandatos-sepa' and (storage.foldername(name))[1] = mi_socio_id()::text);
create policy "admins ven todos los mandatos en storage" on storage.objects for select
  using (bucket_id = 'mandatos-sepa' and is_admin());

-- También para la plantilla BASE (el PDF que sube el admin una vez).
insert into storage.buckets (id, name, public) values ('mandato-sepa-plantilla', 'mandato-sepa-plantilla', true)
  on conflict (id) do nothing;
create policy "lectura publica plantilla mandato sepa" on storage.objects for select
  using (bucket_id = 'mandato-sepa-plantilla');
create policy "admins suben plantilla mandato sepa" on storage.objects for insert
  with check (bucket_id = 'mandato-sepa-plantilla' and is_admin());


-- ============================================================
-- (Añadido) Contenido de migracion-gestion-cuentas.sql
-- ============================================================
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


-- ============================================================
-- (Añadido) Contenido de migracion-libros-uniformes.sql
-- ============================================================
-- ============================================================
-- MIGRACIÓN: lo que aportaban las webs separadas de Libros y
-- Uniformes (ampa-libros-web / ampa-uniformes-web), integrado en el
-- portal. Se puede ejecutar más de una vez sin romper nada.
-- Requiere haber ejecutado antes migracion-gestion-cuentas.sql.
-- ============================================================

-- Pequeña ayuda: cambia la lista de valores permitidos de una columna
-- "estado" sin depender del nombre exacto de su restricción.
create or replace function _cambiar_check_estado(p_tabla text, p_valores text)
returns void language plpgsql as $$
declare v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
    where c.conrelid = ('public.' || p_tabla)::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table %I drop constraint %I', p_tabla, v_nombre);
  end loop;
  execute format('alter table %I add constraint %I check (estado in (%s))', p_tabla, p_tabla || '_estado_check', p_valores);
end;
$$;

-- ************************************************************
-- LIBROS
-- ************************************************************

-- 1. Un mismo título puede servir para VARIOS cursos (ej. Coraline en
--    1º y 2º ESO). Cada curso se guarda como 'Etapa|Curso' ('ESO|1º').
--    etapa/curso se mantienen como el curso "principal" (compatibilidad).
alter table libros_catalogo add column if not exists cursos text[];
update libros_catalogo set cursos = array[etapa || '|' || curso] where cursos is null or cardinality(cursos) = 0;

-- 2. Catálogo real (el de ampa-libros-web). Solo inserta los títulos que
--    todavía no existan (por título, sin distinguir mayúsculas).
insert into libros_catalogo (etapa, curso, cursos, titulo, editorial, isbn, asignatura)
select v.etapa, v.curso, v.cursos, v.titulo, v.editorial, v.isbn, v.asignatura
from (values
  ('Primaria','3º', array['Primaria|3º'], 'Un intruso en mi cuaderno', 'Edelvives', '9788414041079', 'Lengua'),
  ('Primaria','3º', array['Primaria|3º'], 'Lucas se tragó un dragón', 'Edelvives', '9788414060537', 'Lengua'),
  ('Primaria','3º', array['Primaria|3º'], 'Nasreddin - Ten stories', 'Black Cat', '9788853006998', 'Inglés'),
  ('Primaria','4º', array['Primaria|4º'], 'El Colegio de los animales mágicos', 'Edelvives', '9788426398482', 'Lengua'),
  ('Primaria','4º', array['Primaria|4º'], 'El monstruo y la bibliotecaria', 'Edelvives', '9788414052457', 'Lengua'),
  ('Primaria','4º', array['Primaria|4º'], 'The Lighthouse Ghost', 'Black Cat', '9788853018373 / 9788468270623', 'Inglés'),
  ('Primaria','5º', array['Primaria|5º'], 'El ojo que todo lo ve', 'Edelvives', '9788414060629', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], 'Aurora y en la hora', 'Edelvives', '9788414033357', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], '¿Dónde está Morrison?', 'Edelvives', '9788414010877', 'Lengua'),
  ('Primaria','5º', array['Primaria|5º'], 'The Adventures of Tom Sawyer - versión Life Skills', 'Black Cat', '9788853016294 / 9788468250199', 'Inglés'),
  ('Primaria','6º', array['Primaria|6º'], 'El cartero de Bagdad', 'Edelvives', '9788426372864 / 9788426366252', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'El secreto de Enola', 'Edelvives', '9788414005576 / 9788414041178', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'Padres Padrísimos', 'Edelvives', '9788414017883 / 9786077460404', 'Lengua'),
  ('Primaria','6º', array['Primaria|6º'], 'Tales from Camelot', 'Black Cat', '9788853016317', 'Inglés'),
  ('ESO','1º', array['ESO|1º','ESO|2º'], 'Coraline, Neil Gaiman', 'Bloomsbury', '9781408841754', 'Inglés'),
  ('ESO','1º', array['ESO|1º'], 'Unheimliches im Wald', 'Klett', '9783125570061', 'Alemán'),
  ('ESO','2º', array['ESO|2º'], 'Diebstahl im Museum', 'ELI', '9788853628794', 'Alemán'),
  ('ESO','3º', array['ESO|3º','ESO|4º'], 'The curious incident of the dog in the night-time, Mark Haddon', 'Vintage Books', '9780099450252', 'Inglés'),
  ('Bachillerato','1º', array['Bachillerato|1º'], 'The Outsiders, S.E. Hinton', 'Viking Books', '9780142407332', 'Inglés'),
  ('Bachillerato','2º', array['Bachillerato|2º'], 'Persépolis, de Marjane Satrapi', 'Pantheon Books', '9780375714573 / 9788417910143', 'Inglés')
) as v(etapa, curso, cursos, titulo, editorial, isbn, asignatura)
where not exists (select 1 from libros_catalogo l where lower(l.titulo) = lower(v.titulo));

-- 3. Registro de compras (reservado → comprado → obtenido), compartido
--    entre los admins, con quién y cuándo lo registró.
create table if not exists libros_compras (
  id uuid primary key default gen_random_uuid(),
  libro_id uuid not null references libros_catalogo(id) on delete cascade,
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'comprado' check (estado in ('reservado', 'comprado', 'recibido')),
  tienda text,
  coste numeric(10,2) check (coste is null or coste >= 0),
  creado_por uuid references adultos(id) on delete set null,
  creado_por_nombre text,           -- foto del nombre (también para compras importadas)
  actualizado_por_nombre text,
  actualizado_en timestamptz,
  created_at timestamptz not null default now()
);
alter table libros_compras enable row level security;
drop policy if exists "admins gestionan las compras de libros" on libros_compras;
create policy "admins gestionan las compras de libros" on libros_compras for all
  using (is_admin()) with check (is_admin());

-- 4. Entrega física y devolución de cada libro prestado
alter table prestamo_items add column if not exists entregado_en date;
alter table prestamo_items add column if not exists perdido boolean not null default false;
-- (fecha_devolucion ya existía: se rellena al marcarlo devuelto o perdido)

create or replace function prestamo_admin_entrega(p_item_id uuid, p_accion text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item prestamo_items;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.estado <> 'asignado' or v_item.ejemplar_id is null then
    raise exception 'Este libro no tiene ningún ejemplar asignado.';
  end if;

  if p_accion = 'entregar' then
    update prestamo_items set entregado_en = current_date where id = p_item_id;
  elsif p_accion = 'deshacer_entrega' then
    if v_item.fecha_devolucion is not null then raise exception 'Primero deshaz la devolución.'; end if;
    update prestamo_items set entregado_en = null where id = p_item_id;
  elsif p_accion in ('devuelto', 'perdido') then
    if v_item.entregado_en is null then raise exception 'Este libro todavía no se ha entregado.'; end if;
    update prestamo_items set fecha_devolucion = current_date, perdido = (p_accion = 'perdido') where id = p_item_id;
    update libros_ejemplares set estado = case when p_accion = 'perdido' then 'perdido' else 'disponible' end
      where id = v_item.ejemplar_id;
  elsif p_accion = 'deshacer_devolucion' then
    if v_item.fecha_devolucion is null then raise exception 'Este libro no estaba devuelto.'; end if;
    if exists (select 1 from prestamo_items o where o.ejemplar_id = v_item.ejemplar_id and o.id <> p_item_id
               and o.estado = 'asignado' and o.fecha_devolucion is null) then
      raise exception 'Ese ejemplar ya se ha vuelto a prestar a otra familia.';
    end if;
    update prestamo_items set fecha_devolucion = null, perdido = false where id = p_item_id;
    update libros_ejemplares set estado = 'prestado' where id = v_item.ejemplar_id;
  else
    raise exception 'Acción no reconocida.';
  end if;
end;
$$;
grant execute on function prestamo_admin_entrega(uuid, text) to authenticated;

-- Un libro ya entregado a la familia no se puede quitar ni cambiar desde
-- el reparto (hay que registrar antes su devolución).
create or replace function prestamo_admin_asignar(p_item_id uuid, p_ejemplar_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
  v_ejemplar libros_ejemplares;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.entregado_en is not null then raise exception 'Ese libro ya se entregó a la familia: no se puede cambiar.'; end if;

  select * into v_ejemplar from libros_ejemplares where id = p_ejemplar_id;
  if not found then raise exception 'El ejemplar no existe.'; end if;
  if v_ejemplar.libro_id <> v_item.libro_id then raise exception 'Ese ejemplar no es del mismo título que la solicitud.'; end if;
  if v_ejemplar.estado <> 'disponible' and v_item.ejemplar_id is distinct from p_ejemplar_id then
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

create or replace function prestamo_admin_quitar(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item prestamo_items;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_item.entregado_en is not null then raise exception 'Ese libro ya se entregó a la familia: registra antes su devolución.'; end if;
  if v_item.ejemplar_id is not null then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;
  update prestamo_items set ejemplar_id = null, estado = 'no_asignado', fecha_asignacion = null where id = p_item_id;
end;
$$;

create or replace function prestamo_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if exists (select 1 from prestamo_items where convocatoria_id = p_convocatoria_id and entregado_en is not null) then
    raise exception 'Ya hay libros de esta convocatoria entregados a las familias: el reparto no se puede anular entero.';
  end if;
  update libros_ejemplares set estado = 'disponible'
    where id in (select ejemplar_id from prestamo_items where convocatoria_id = p_convocatoria_id and ejemplar_id is not null);
  update prestamo_items set ejemplar_id = null, estado = 'pendiente', fecha_asignacion = null
    where convocatoria_id = p_convocatoria_id and tipo = 'solicitud';
  update prestamo_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;

-- ************************************************************
-- CONVOCATORIAS (libros y uniformes): cerrar ya, cancelar, finalizar
-- ************************************************************
select _cambiar_check_estado('prestamo_convocatorias', '''abierta'',''repartida'',''cancelada''');
select _cambiar_check_estado('uniformes_convocatorias', '''abierta'',''repartida'',''finalizada'',''cancelada''');

alter table uniformes_convocatorias add column if not exists resumen_reparto jsonb;
alter table uniformes_convocatorias add column if not exists finalizada_en timestamptz;
alter table uniformes_convocatorias add column if not exists finalizada_por text;
alter table prestamo_convocatorias add column if not exists resumen_reparto jsonb;

-- Acciones sobre la convocatoria en marcha (la más reciente):
--   'cerrar'    -> adelanta el cierre del plazo a ahora mismo
--   'cancelar'  -> la archiva sin repartir (los pedidos se conservan)
--   'finalizar' -> (solo uniformes) cierra y guarda en firme un reparto:
--                  ya no se puede tocar y la familia ve su resultado
create or replace function convocatoria_admin_accion(p_tipo text, p_convocatoria_id uuid, p_accion text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tabla text;
  v_estado text;
  v_nombre text;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if p_tipo = 'prestamo' then v_tabla := 'prestamo_convocatorias';
  elsif p_tipo = 'uniformes' then v_tabla := 'uniformes_convocatorias';
  else raise exception 'Tipo de convocatoria no válido.'; end if;

  execute format('select estado from %I where id = $1', v_tabla) into v_estado using p_convocatoria_id;
  if v_estado is null then raise exception 'La convocatoria no existe.'; end if;

  if p_accion = 'cerrar' then
    if v_estado <> 'abierta' then raise exception 'Solo se puede cerrar el plazo de una convocatoria abierta.'; end if;
    execute format('update %I set fecha_cierre = now() where id = $1', v_tabla) using p_convocatoria_id;
  elsif p_accion = 'cancelar' then
    if v_estado <> 'abierta' then raise exception 'Solo se puede cancelar una convocatoria que todavía no se ha repartido.'; end if;
    execute format('update %I set estado = ''cancelada'' where id = $1', v_tabla) using p_convocatoria_id;
  elsif p_accion = 'finalizar' and p_tipo = 'uniformes' then
    if v_estado <> 'repartida' then raise exception 'Solo se puede cerrar y guardar una convocatoria ya repartida.'; end if;
    select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
    update uniformes_convocatorias set estado = 'finalizada', finalizada_en = now(), finalizada_por = v_nombre
      where id = p_convocatoria_id;
  else
    raise exception 'Acción no reconocida.';
  end if;
end;
$$;
grant execute on function convocatoria_admin_accion(text, uuid, text) to authenticated;

-- ************************************************************
-- UNIFORMES
-- ************************************************************

-- 5. Stock inicial (el de ampa-uniformes-web). Solo crea las
--    combinaciones que todavía no existan; nunca pisa un stock ya puesto.
insert into prendas_catalogo (tipo, talla, stock)
select v.tipo, v.talla, v.stock from (values
  ('Camiseta','1',1),('Camiseta','2',22),('Camiseta','4',12),('Camiseta','6',3),('Camiseta','8',10),
  ('Camiseta','14',4),('Camiseta','16',2),('Camiseta','20',3),
  ('Sudadera','1',6),('Sudadera','2',26),('Sudadera','3',9),('Sudadera','4',26),('Sudadera','6',12),
  ('Sudadera','8',11),('Sudadera','10',1),('Sudadera','12',1),('Sudadera','14',4),('Sudadera','16',3),('Sudadera','20',1),
  ('Pantalón Corto','1',1),('Pantalón Corto','2',13),('Pantalón Corto','4',6),('Pantalón Corto','6',10),
  ('Pantalón Corto','8',10),('Pantalón Corto','10',1),('Pantalón Corto','14',4),('Pantalón Corto','16',1),
  ('Pantalón Corto','18',1),('Pantalón Corto','20',1),
  ('Pantalón Largo','1',4),('Pantalón Largo','2',23),('Pantalón Largo','3',5),('Pantalón Largo','4',7),
  ('Pantalón Largo','8',9),('Pantalón Largo','10',4),('Pantalón Largo','14',2),('Pantalón Largo','16',2),('Pantalón Largo','18',2),
  ('Baby','1',7),('Baby','2',9),('Baby','4',3),('Baby','6',4)
) as v(tipo, talla, stock)
on conflict (tipo, talla) do nothing;

-- 6. Movimientos de stock: el catálogo ya no se edita número a número,
--    se registra lo que entra o sale (con historial).
create table if not exists prendas_movimientos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  talla text not null,
  cantidad integer not null,            -- positiva = entra, negativa = sale
  stock_resultante integer not null,
  motivo text,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
alter table prendas_movimientos enable row level security;
drop policy if exists "admins ven los movimientos de prendas" on prendas_movimientos;
create policy "admins ven los movimientos de prendas" on prendas_movimientos for select using (is_admin());

create or replace function uniformes_mover_stock(p_tipo text, p_talla text, p_cantidad integer, p_operacion text, p_motivo text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_prenda prendas_catalogo;
  v_delta integer;
  v_nombre text;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor que 0.'; end if;
  if p_operacion not in ('sumar', 'restar') then raise exception 'Operación no válida.'; end if;
  v_delta := case when p_operacion = 'sumar' then p_cantidad else -p_cantidad end;

  select * into v_prenda from prendas_catalogo where tipo = p_tipo and talla = p_talla for update;
  if not found then
    if p_operacion = 'restar' then raise exception 'No hay ninguna % talla % en el catálogo todavía.', p_tipo, p_talla; end if;
    insert into prendas_catalogo (tipo, talla, stock) values (p_tipo, p_talla, p_cantidad) returning * into v_prenda;
  else
    if v_prenda.stock + v_delta < 0 then
      raise exception 'Solo quedan % — no se pueden quitar %.', v_prenda.stock, p_cantidad;
    end if;
    update prendas_catalogo set stock = stock + v_delta where id = v_prenda.id returning * into v_prenda;
  end if;

  select nombre || ' ' || apellidos into v_nombre from adultos where id = auth.uid();
  insert into prendas_movimientos (tipo, talla, cantidad, stock_resultante, motivo, creado_por_nombre)
  values (p_tipo, p_talla, v_delta, v_prenda.stock, nullif(trim(coalesce(p_motivo, '')), ''), v_nombre);
  return v_prenda.stock;
end;
$$;
grant execute on function uniformes_mover_stock(text, text, integer, text, text) to authenticated;

-- 7. Una convocatoria finalizada (cerrada y guardada) ya no se toca
create or replace function _uniformes_comprobar_editable(p_convocatoria_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from uniformes_convocatorias where id = p_convocatoria_id;
  if v_estado = 'finalizada' then
    raise exception 'Esta convocatoria está cerrada y guardada: ya no se puede modificar.';
  end if;
end;
$$;

create or replace function uniformes_admin_asignar(p_alumno_id uuid, p_convocatoria_id uuid, p_prenda_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid;
  v_actual uniformes_pedidos;
  v_stock integer;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);

  select socio_id into v_socio_id from alumnos where id = p_alumno_id;
  if v_socio_id is null then raise exception 'El alumno no existe.'; end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if found and v_actual.prenda_id = p_prenda_id then return; end if;

  select stock into v_stock from prendas_catalogo where id = p_prenda_id for update;
  if v_stock is null or v_stock < 1 then raise exception 'Esa prenda no tiene stock disponible.'; end if;

  if v_actual.id is not null then
    update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
    if v_actual.prioridad = 0 then
      delete from uniformes_pedidos where id = v_actual.id;
    else
      update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
    end if;
  end if;

  update prendas_catalogo set stock = stock - 1 where id = p_prenda_id;
  insert into uniformes_pedidos (convocatoria_id, socio_id, alumno_id, prioridad, prenda_id, estado)
  values (p_convocatoria_id, v_socio_id, p_alumno_id, 0, p_prenda_id, 'asignado')
  on conflict (alumno_id, convocatoria_id, prioridad)
  do update set prenda_id = excluded.prenda_id, estado = 'asignado';
end;
$$;

create or replace function uniformes_admin_quitar(p_alumno_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_actual uniformes_pedidos;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if not found then raise exception 'Este alumno no tiene ninguna prenda asignada.'; end if;
  update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
  if v_actual.prioridad = 0 then
    delete from uniformes_pedidos where id = v_actual.id;
  else
    update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
  end if;
end;
$$;

create or replace function uniformes_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  if (select estado from uniformes_convocatorias where id = p_convocatoria_id) <> 'repartida' then
    raise exception 'Esta convocatoria no está repartida.';
  end if;
  update prendas_catalogo p set stock = stock + x.n
    from (select prenda_id, count(*)::int n from uniformes_pedidos
          where convocatoria_id = p_convocatoria_id and estado = 'asignado' group by prenda_id) x
    where p.id = x.prenda_id;
  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and prioridad = 0;
  update uniformes_pedidos set estado = 'pendiente' where convocatoria_id = p_convocatoria_id and prioridad in (1, 2, 3);
  update uniformes_convocatorias set estado = 'abierta', resumen_reparto = null where id = p_convocatoria_id;
end;
$$;

-- 8. Borrar el pedido completo de una familia (spam, duplicado, o porque
--    lo pide). Si algún hijo/a tenía prenda asignada, se devuelve al stock.
create or replace function uniformes_admin_borrar_pedido(p_socio_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  perform _uniformes_comprobar_editable(p_convocatoria_id);
  update prendas_catalogo p set stock = stock + x.n
    from (select prenda_id, count(*)::int n from uniformes_pedidos
          where convocatoria_id = p_convocatoria_id and socio_id = p_socio_id and estado = 'asignado' group by prenda_id) x
    where p.id = x.prenda_id;
  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and socio_id = p_socio_id;
end;
$$;
grant execute on function uniformes_admin_borrar_pedido(uuid, uuid) to authenticated;

drop function _cambiar_check_estado(text, text);

-- ======== migracion-fusionar-libros-repetidos.sql ========
-- ============================================================
-- Fusiona títulos repetidos del catálogo de libros.
--
-- Antes un mismo libro usado en varios cursos (p. ej. Coraline en 1º y
-- 2º ESO) se daba de alta una vez por curso. Ahora un título puede tener
-- varios cursos, así que se deja UNO solo por título con todos sus
-- cursos, y sus ejemplares, peticiones y compras pasan a ese registro.
--
-- Se puede ejecutar varias veces: si no hay repetidos, no hace nada.
-- ============================================================
do $$
declare
  g record;
  v_quedan uuid;
  v_sobran uuid[];
begin
  for g in
    select lower(btrim(titulo)) as clave, array_agg(id order by created_at, id) as ids
    from libros_catalogo
    group by lower(btrim(titulo))
    having count(*) > 1
  loop
    v_quedan := g.ids[1];
    v_sobran := g.ids[2:];

    -- todos los cursos de los repetidos, sin duplicar
    update libros_catalogo l set cursos = (
      select array_agg(distinct c order by c)
      from libros_catalogo x, unnest(coalesce(x.cursos, array[x.etapa || '|' || x.curso])) c
      where x.id = any(g.ids)
    ) where l.id = v_quedan;

    update libros_ejemplares set libro_id = v_quedan where libro_id = any(v_sobran);
    update prestamo_items    set libro_id = v_quedan where libro_id = any(v_sobran);
    update libros_compras    set libro_id = v_quedan where libro_id = any(v_sobran);
    delete from libros_catalogo where id = any(v_sobran);

    update libros_catalogo
      set stock = (select count(*) from libros_ejemplares where libro_id = v_quedan and estado <> 'baja')
      where id = v_quedan;

    raise notice 'Fusionado: % (% registros en 1)', g.clave, cardinality(g.ids);
  end loop;
end;
$$;

-- Comprobación: debe salir vacío
select titulo, count(*) from libros_catalogo group by titulo having count(*) > 1;

-- A partir de ahora no se puede repetir un título (en vez de eso se
-- marcan varios cursos en el mismo título).
create unique index if not exists libros_catalogo_titulo_unico on libros_catalogo (lower(btrim(titulo)));

-- ======== migracion-portada.sql ========
-- ============================================================
-- Portada nueva: pie de foto en el carrusel y vídeos gestionables.
-- Se puede ejecutar varias veces sin problema.
-- ============================================================

-- Texto bajo cada foto del carrusel de portada (ej. "Chocolatada de Navidad 2025")
alter table fotos_carrusel add column if not exists pie text;

-- Vídeos de la portada (enlaces de YouTube; pueden ser vídeos ocultos)
create table if not exists videos_portada (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  youtube_id text not null,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
alter table videos_portada enable row level security;

drop policy if exists "todos ven los videos de portada" on videos_portada;
create policy "todos ven los videos de portada" on videos_portada for select using (true);

drop policy if exists "admins gestionan los videos de portada" on videos_portada;
create policy "admins gestionan los videos de portada" on videos_portada for all
  using (is_admin()) with check (is_admin());

-- ======== migracion-eventos-v2.sql ========
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
