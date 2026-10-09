-- ==================================================================
-- DONACIONES DE MATERIAL. Cualquiera (socio o no) puede anunciar desde
-- donar.html lo que va a dejar en la caja de donaciones. Solo se recoge:
--   · libros del catálogo del Banco de Libros
--   · prendas del Banco de Uniformes (cualquier talla)
--   · instrumentos: carillones y flautas
--   · ropa de extraescolares: kimonos, chándal y pantalón de fútbol
--   · «otra cosa»: la Junta la revisa y puede rechazarla
-- Se guarda por la función de Netlify `donacion` (clave de servicio): solo
-- la Junta puede leer y cambiar la tabla.
-- Se puede ejecutar varias veces (también si ya se ejecutó la versión anterior).
-- ==================================================================
create table if not exists donaciones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  otros text,
  nombre text not null,
  email text not null,
  telefono text,
  socio_id uuid references socios(id) on delete set null,
  estado text not null default 'pendiente',
  nota_junta text
);
-- Por si existía la primera versión de la tabla
alter table donaciones add column if not exists items jsonb not null default '[]'::jsonb;
alter table donaciones add column if not exists otros text;
do $$ begin
  -- La primera versión guardaba tipo + descripción: pasan juntos a «otros»
  if exists (select 1 from information_schema.columns where table_name = 'donaciones' and column_name = 'descripcion') then
    if exists (select 1 from information_schema.columns where table_name = 'donaciones' and column_name = 'tipo') then
      execute 'update donaciones set otros = coalesce(otros, tipo || '': '' || descripcion)';
    else
      execute 'update donaciones set otros = coalesce(otros, descripcion)';
    end if;
    alter table donaciones drop column descripcion;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'donaciones' and column_name = 'tipo') then
    alter table donaciones drop column tipo;
  end if;
end $$;
alter table donaciones drop constraint if exists donaciones_estado_check;
update donaciones set estado = 'rechazada' where estado = 'descartada';
alter table donaciones add constraint donaciones_estado_check check (estado in ('pendiente','aceptada','recibida','rechazada'));
alter table donaciones drop constraint if exists donaciones_algo_check;
alter table donaciones add constraint donaciones_algo_check check (jsonb_array_length(items) > 0 or coalesce(otros, '') <> '');
create index if not exists donaciones_estado_idx on donaciones (estado, created_at desc);

alter table donaciones enable row level security;
drop policy if exists "junta ve las donaciones" on donaciones;
create policy "junta ve las donaciones" on donaciones for select using (is_admin());
drop policy if exists "junta gestiona las donaciones" on donaciones;
create policy "junta gestiona las donaciones" on donaciones for update using (is_admin()) with check (is_admin());
drop policy if exists "junta borra donaciones" on donaciones;
create policy "junta borra donaciones" on donaciones for delete using (is_admin());
