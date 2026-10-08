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
