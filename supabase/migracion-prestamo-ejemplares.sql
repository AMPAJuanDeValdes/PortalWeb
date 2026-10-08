-- ==================================================================
-- PRÉSTAMO DE LIBROS — ejemplares individuales + reparto por
-- convocatoria. Sustituye el mecanismo antiguo de "stock" simple con
-- descuento automático al pedir (primero-en-llegar).
-- ==================================================================

-- 1. Quitar el mecanismo antiguo ------------------------------------------
drop trigger if exists trg_descontar_stock on prestamo_items;
drop function if exists descontar_stock_prestamo();

-- 2. Ejemplares físicos individuales ---------------------------------------
-- El código es el número impreso en el libro (p.ej. "0001"), lo asigna el
-- admin a mano al dar de alta cada copia física. Único en todo el catálogo,
-- no solo dentro de un título.
create table if not exists libros_ejemplares (
  id uuid primary key default gen_random_uuid(),
  libro_id uuid not null references libros_catalogo(id) on delete cascade,
  codigo text not null,
  estado text not null default 'disponible' check (estado in ('disponible', 'prestado', 'perdido', 'baja')),
  created_at timestamptz not null default now()
);
create unique index if not exists libros_ejemplares_codigo_unico on libros_ejemplares (codigo);

alter table libros_ejemplares enable row level security;
create policy "todos ven los ejemplares" on libros_ejemplares for select using (true);
create policy "admins gestionan los ejemplares" on libros_ejemplares for all
  using (is_admin()) with check (is_admin());

-- libros_catalogo.stock deja de editarse a mano: pasa a ser el total de
-- ejemplares de ese título que no estén de baja (disponibles + prestados
-- + perdidos), recalculado automáticamente.
create or replace function recalcular_stock_libro()
returns trigger language plpgsql security definer as $$
declare
  v_libro_id uuid;
begin
  v_libro_id := coalesce(new.libro_id, old.libro_id);
  update libros_catalogo
    set stock = (select count(*) from libros_ejemplares where libro_id = v_libro_id and estado <> 'baja')
    where id = v_libro_id;
  return null;
end;
$$;

drop trigger if exists trg_recalcular_stock_libro on libros_ejemplares;
create trigger trg_recalcular_stock_libro
after insert or update or delete on libros_ejemplares
for each row execute function recalcular_stock_libro();

-- 3. Convocatorias de préstamo (la ventana de tiempo para pedir) ----------
create table if not exists prestamo_convocatorias (
  id uuid primary key default gen_random_uuid(),
  fecha_cierre timestamptz not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'repartida')),
  created_at timestamptz not null default now()
);
-- Solo puede haber una convocatoria abierta a la vez.
create unique index if not exists prestamo_convocatorias_una_abierta
  on prestamo_convocatorias ((estado = 'abierta')) where estado = 'abierta';

alter table prestamo_convocatorias enable row level security;
create policy "todos ven las convocatorias de prestamo" on prestamo_convocatorias for select
  using (true);
create policy "admins gestionan las convocatorias de prestamo" on prestamo_convocatorias for all
  using (is_admin())
  with check (is_admin());

-- 4. Ampliación de prestamo_items -------------------------------------------
alter table prestamo_items add column if not exists convocatoria_id uuid references prestamo_convocatorias(id) on delete cascade;
alter table prestamo_items add column if not exists ejemplar_id uuid references libros_ejemplares(id) on delete set null;
alter table prestamo_items add column if not exists estado text not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'no_asignado'));
alter table prestamo_items add column if not exists fecha_asignacion date;
alter table prestamo_items add column if not exists fecha_devolucion date;
alter table prestamo_items drop column if exists cubierto_por_stock;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prestamo_items_convocatoria_check'
  ) then
    alter table prestamo_items add constraint prestamo_items_convocatoria_check
      check (tipo = 'donacion' or convocatoria_id is not null);
  end if;
end $$;

-- Las políticas antiguas permitían al socio hacer de todo sobre sus
-- propias filas sin mirar si la convocatoria seguía abierta. Las
-- sustituimos por políticas más finas.
drop policy if exists "socios gestionan sus solicitudes de prestamo" on prestamo_items;

create policy "socios ven sus propias solicitudes" on prestamo_items for select
  using (socio_id = mi_socio_id());

create policy "socios piden libros durante la convocatoria abierta" on prestamo_items for insert
  with check (
    socio_id = mi_socio_id()
    and (
      tipo = 'donacion'
      or exists (
        select 1 from prestamo_convocatorias c
        where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
      )
    )
  );

create policy "socios borran sus solicitudes pendientes" on prestamo_items for delete
  using (
    socio_id = mi_socio_id()
    and estado = 'pendiente'
    and exists (
      select 1 from prestamo_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

-- (la política "admins ven y gestionan todas las solicitudes" ya existente
-- se mantiene sin cambios)
