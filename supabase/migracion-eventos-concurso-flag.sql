-- Distingue un evento "concurso literario" (mecánica de envío de texto
-- anónimo) de un evento normal con inscripción. Se decidió a posteriori
-- de migracion-eventos-avanzado.sql, de ahí ir en archivo aparte.
alter table eventos add column if not exists usa_concurso_texto boolean not null default false;
