-- ============================================================
-- ESQUEMA DEL PORTAL AMPA — Supabase (Postgres)
-- Pega esto entero en: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- PERFILES = CUENTA DE SOCIO (una familia, vinculada a auth.users)
-- El número de socio de 12 cifras se compone de:
--   año última cuota (4) + código asociación (4, fijo "0300") + secuencial (4)
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  anio_ultima_cuota integer not null,
  codigo_asociacion text not null default '0300',
  numero_secuencial text not null check (numero_secuencial ~ '^[0-9]{4}$'),
  numero_socio_completo text generated always as (
    lpad(anio_ultima_cuota::text, 4, '0') || codigo_asociacion || numero_secuencial
  ) stored,
  forma_pago text check (forma_pago in ('Metálico','Transferencia','Domiciliación Bancaria')),
  iban text,
  email text not null,
  role text not null default 'socio' check (role in ('socio','admin')),
  force_password_change boolean not null default true,
  created_at timestamptz not null default now(),
  unique (numero_secuencial, anio_ultima_cuota)
);

create unique index if not exists profiles_numero_socio_completo_idx on profiles (numero_socio_completo);

alter table profiles enable row level security;

create policy "select propio perfil" on profiles for select
  using (auth.uid() = id);

create policy "admins ven todos los perfiles" on profiles for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "actualizar propio perfil" on profiles for update
  using (auth.uid() = id);

create policy "admins actualizan cualquier perfil" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- PROGENITORES (hasta 2 por familia: principal y secundario)
-- ------------------------------------------------------------
create table if not exists progenitores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  tipo text not null check (tipo in ('principal','secundario')),
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
  created_at timestamptz not null default now(),
  unique (profile_id, tipo)
);

alter table progenitores enable row level security;

create policy "socios gestionan sus progenitores" on progenitores for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins ven todos los progenitores" on progenitores for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- HIJOS/AS (deben ser alumnos del colegio)
-- ------------------------------------------------------------
create table if not exists hijos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  nombre text not null,
  apellidos text not null,
  fecha_nacimiento date,
  sexo text check (sexo in ('Masculino','Femenino','Otro')),
  etapa text not null check (etapa in ('Infantil','Primaria','ESO','Bachillerato')),
  curso text not null,
  aula text check (aula in ('A','B','C','D')),
  created_at timestamptz not null default now()
);

alter table hijos enable row level security;

create policy "socios gestionan sus hijos" on hijos for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins ven todos los hijos" on hijos for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- SOLICITUDES DE PRÉSTAMO DE LIBROS (un registro por libro pedido)
-- ------------------------------------------------------------
create table if not exists prestamo_items (
  id uuid primary key default gen_random_uuid(),
  hijo_id uuid not null references hijos(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  curso text not null,
  libro text not null,
  created_at timestamptz not null default now()
);

alter table prestamo_items enable row level security;

create policy "socios gestionan sus solicitudes" on prestamo_items for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins ven todas las solicitudes" on prestamo_items for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- EVENTOS
-- ------------------------------------------------------------
create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  fecha timestamptz,
  aforo integer,
  activo boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table eventos enable row level security;

create policy "todos ven eventos activos" on eventos for select
  using (activo = true or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins crean eventos" on eventos for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins editan eventos" on eventos for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins borran eventos" on eventos for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- INSCRIPCIONES A EVENTOS
-- ------------------------------------------------------------
create table if not exists evento_inscripciones (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  num_asistentes integer not null default 1,
  notas text,
  created_at timestamptz not null default now(),
  unique (evento_id, profile_id)
);

alter table evento_inscripciones enable row level security;

create policy "socios gestionan su inscripcion" on evento_inscripciones for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins ven todas las inscripciones" on evento_inscripciones for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Función para saber plazas libres sin exponer quién se ha apuntado
create or replace function evento_plazas_disponibles(p_evento_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case when e.aforo is null then null
         else e.aforo - coalesce(sum(i.num_asistentes),0)::integer
         end
  from eventos e
  left join evento_inscripciones i on i.evento_id = e.id
  where e.id = p_evento_id
  group by e.aforo;
$$;

grant execute on function evento_plazas_disponibles(uuid) to authenticated;

-- ------------------------------------------------------------
-- FORMULARIOS GENÉRICOS (para futuras encuestas/inscripciones)
-- campos = jsonb array de {id,label,type,options,required}
-- tipos soportados por el frontend: texto, numero, select, checkbox
-- ------------------------------------------------------------
create table if not exists formularios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  campos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table formularios enable row level security;

create policy "todos ven formularios activos" on formularios for select
  using (activo = true or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins crean formularios" on formularios for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins actualizan formularios" on formularios for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "admins borran formularios" on formularios for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- RESPUESTAS A FORMULARIOS GENÉRICOS
-- ------------------------------------------------------------
create table if not exists formulario_respuestas (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid not null references formularios(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  respuestas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (formulario_id, profile_id)
);

alter table formulario_respuestas enable row level security;

create policy "socios gestionan sus respuestas" on formulario_respuestas for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins ven todas las respuestas" on formulario_respuestas for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ============================================================
-- FIN DEL ESQUEMA
-- Siguiente paso: crea manualmente el primer admin (ver README.md,
-- sección "Primer arranque"), porque hasta que exista un admin
-- nadie puede usar la importación masiva por CSV.
-- ============================================================
