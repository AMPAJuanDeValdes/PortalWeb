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
