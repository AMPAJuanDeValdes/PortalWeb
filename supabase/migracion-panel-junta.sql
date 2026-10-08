-- ============================================================
-- Panel de la Junta: los mensajes de las familias se pueden marcar como
-- atendidos. Se puede ejecutar varias veces sin problema.
-- ============================================================
alter table comentarios add column if not exists atendido boolean not null default false;
drop policy if exists "admins marcan comentarios atendidos" on comentarios;
create policy "admins marcan comentarios atendidos" on comentarios for update
  using (is_admin()) with check (is_admin());
