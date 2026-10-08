-- Añade editorial, ISBN y asignatura al catálogo de libros (obligatorios).
-- Ejecutar solo si la tabla libros_catalogo está vacía (los NOT NULL fallarían
-- si ya hay filas sin estos valores).

alter table libros_catalogo add column if not exists editorial text not null;
alter table libros_catalogo add column if not exists isbn text not null;
alter table libros_catalogo add column if not exists asignatura text not null
  check (asignatura in ('Lengua', 'Inglés', 'Alemán'));
