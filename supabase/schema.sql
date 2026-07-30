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
  forma_pago text check (forma_pago in ('Metálico','Transferencia','Domiciliación Bancaria')),
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
-- 9. COMPROBANTES DE PAGO (cuota anual e invitados)
-- ------------------------------------------------------------
create table if not exists comprobantes_pago (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cuota_socio','invitado_evento')),
  socio_id uuid references socios(id) on delete cascade,
  evento_inscripcion_id uuid references evento_inscripciones(id) on delete cascade,
  archivo_url text not null,
  verificado boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (tipo = 'cuota_socio' and socio_id is not null) or
    (tipo = 'invitado_evento' and evento_inscripcion_id is not null)
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
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

alter table libros_catalogo enable row level security;

create policy "todos ven el catalogo de libros" on libros_catalogo for select
  using (true);

create policy "admins gestionan el catalogo" on libros_catalogo for all
  using (is_admin())
  with check (is_admin());

create table if not exists prestamo_items (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid references alumnos(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  libro_id uuid not null references libros_catalogo(id),
  tipo text not null default 'solicitud' check (tipo in ('solicitud','donacion')),
  cubierto_por_stock boolean not null default false,
  created_at timestamptz not null default now(),
  check (tipo = 'donacion' or alumno_id is not null)
);

alter table prestamo_items enable row level security;

create policy "socios gestionan sus solicitudes de prestamo" on prestamo_items for all
  using (socio_id = mi_socio_id())
  with check (socio_id = mi_socio_id());

create policy "admins ven y gestionan todas las solicitudes" on prestamo_items for all
  using (is_admin());

-- Descuenta stock automáticamente al insertar una solicitud (no donación)
create or replace function descontar_stock_prestamo()
returns trigger language plpgsql security definer as $$
begin
  if new.tipo = 'solicitud' then
    update libros_catalogo
      set stock = stock - 1
      where id = new.libro_id and stock > 0;
    new.cubierto_por_stock := found;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_descontar_stock on prestamo_items;
create trigger trg_descontar_stock
  before insert on prestamo_items
  for each row execute function descontar_stock_prestamo();

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
