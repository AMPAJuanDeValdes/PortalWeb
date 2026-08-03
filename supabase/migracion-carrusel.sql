-- Añade el carrusel de fotos a un proyecto que ya tenga el resto del
-- esquema v2 desplegado. Ejecuta esto en el SQL Editor.

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
