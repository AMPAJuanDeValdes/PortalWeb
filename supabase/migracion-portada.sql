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
