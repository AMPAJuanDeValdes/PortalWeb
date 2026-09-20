-- ==================================================================
-- ENTREGA DE UNIFORMES — catálogo, convocatorias y pedidos priorizados.
-- El reparto en sí (algoritmo) va en la función de Netlify
-- uniformes-repartir.js; aquí solo van las tablas, RLS y las acciones
-- de admin para editar a mano después del reparto.
-- ==================================================================

-- 1. Catálogo de prendas ---------------------------------------------------
create table if not exists prendas_catalogo (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('Sudadera', 'Pantalón Largo', 'Pantalón Corto', 'Camiseta', 'Baby')),
  talla text not null check (talla in ('1','2','3','4','6','8','10','12','14','16','18','20')),
  stock integer not null default 0,
  created_at timestamptz not null default now(),
  check (tipo <> 'Baby' or talla in ('1','2','3','4','6'))
);
create unique index if not exists prendas_catalogo_tipo_talla_unico on prendas_catalogo (tipo, talla);

alter table prendas_catalogo enable row level security;
create policy "todos ven el catalogo de prendas" on prendas_catalogo for select using (true);
create policy "admins gestionan el catalogo de prendas" on prendas_catalogo for all
  using (is_admin()) with check (is_admin());

-- 2. Convocatorias de uniformes ---------------------------------------------
create table if not exists uniformes_convocatorias (
  id uuid primary key default gen_random_uuid(),
  fecha_cierre timestamptz not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'repartida')),
  created_at timestamptz not null default now()
);
create unique index if not exists uniformes_convocatorias_una_abierta
  on uniformes_convocatorias ((estado = 'abierta')) where estado = 'abierta';

alter table uniformes_convocatorias enable row level security;
create policy "todos ven las convocatorias de uniformes" on uniformes_convocatorias for select
  using (true);
create policy "admins gestionan las convocatorias de uniformes" on uniformes_convocatorias for all
  using (is_admin())
  with check (is_admin());

-- 3. Pedidos (3 prioridades por alumno) --------------------------------------
-- prioridad 0 = asignación manual del admin (no es una de las 3 opciones
-- reales de la familia, sino un ajuste posterior al reparto).
create table if not exists uniformes_pedidos (
  id uuid primary key default gen_random_uuid(),
  convocatoria_id uuid not null references uniformes_convocatorias(id) on delete cascade,
  socio_id uuid not null references socios(id) on delete cascade,
  alumno_id uuid not null references alumnos(id) on delete cascade,
  prioridad integer not null check (prioridad in (0, 1, 2, 3)),
  prenda_id uuid not null references prendas_catalogo(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'no_asignado')),
  created_at timestamptz not null default now()
);
create unique index if not exists uniformes_pedidos_unico on uniformes_pedidos (alumno_id, convocatoria_id, prioridad);

alter table uniformes_pedidos enable row level security;

create policy "socios ven sus propios pedidos de uniformes" on uniformes_pedidos for select
  using (socio_id = mi_socio_id());

create policy "socios piden uniformes durante la convocatoria abierta" on uniformes_pedidos for insert
  with check (
    socio_id = mi_socio_id()
    and prioridad in (1, 2, 3)
    and exists (
      select 1 from uniformes_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

create policy "socios borran sus pedidos pendientes" on uniformes_pedidos for delete
  using (
    socio_id = mi_socio_id()
    and estado = 'pendiente'
    and exists (
      select 1 from uniformes_convocatorias c
      where c.id = convocatoria_id and c.estado = 'abierta' and now() < c.fecha_cierre
    )
  );

create policy "admins ven y gestionan todos los pedidos de uniformes" on uniformes_pedidos for all
  using (is_admin());

-- 4. Acciones de admin tras el reparto ---------------------------------------

-- Asigna (o reasigna) una prenda concreta a un alumno. Si el alumno ya
-- tenía otra prenda asignada en esta convocatoria, la devuelve al stock.
-- Si la prenda no era una de sus 3 opciones originales, crea una fila
-- nueva con prioridad = 0 para dejar constancia de que fue un ajuste manual.
create or replace function uniformes_admin_asignar(p_alumno_id uuid, p_convocatoria_id uuid, p_prenda_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid;
  v_actual uniformes_pedidos;
  v_stock integer;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select socio_id into v_socio_id from alumnos where id = p_alumno_id;
  if v_socio_id is null then
    raise exception 'El alumno no existe.';
  end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';

  if found and v_actual.prenda_id = p_prenda_id then
    return; -- ya estaba asignada esta misma prenda, nada que hacer
  end if;

  if found then
    update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;
    if v_actual.prioridad = 0 then
      delete from uniformes_pedidos where id = v_actual.id;
    else
      update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
    end if;
  end if;

  select stock into v_stock from prendas_catalogo where id = p_prenda_id;
  if v_stock is null or v_stock < 1 then
    raise exception 'Esa prenda no tiene stock disponible.';
  end if;

  update prendas_catalogo set stock = stock - 1 where id = p_prenda_id;

  insert into uniformes_pedidos (convocatoria_id, socio_id, alumno_id, prioridad, prenda_id, estado)
  values (p_convocatoria_id, v_socio_id, p_alumno_id, 0, p_prenda_id, 'asignado')
  on conflict (alumno_id, convocatoria_id, prioridad)
  do update set prenda_id = excluded.prenda_id, estado = 'asignado';
end;
$$;
grant execute on function uniformes_admin_asignar(uuid, uuid, uuid) to authenticated;

-- Quita la prenda asignada a un alumno; la devuelve al stock.
create or replace function uniformes_admin_quitar(p_alumno_id uuid, p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actual uniformes_pedidos;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_actual from uniformes_pedidos
    where alumno_id = p_alumno_id and convocatoria_id = p_convocatoria_id and estado = 'asignado';
  if not found then
    raise exception 'Este alumno no tiene ninguna prenda asignada.';
  end if;

  update prendas_catalogo set stock = stock + 1 where id = v_actual.prenda_id;

  if v_actual.prioridad = 0 then
    delete from uniformes_pedidos where id = v_actual.id;
  else
    update uniformes_pedidos set estado = 'no_asignado' where id = v_actual.id;
  end if;
end;
$$;
grant execute on function uniformes_admin_quitar(uuid, uuid) to authenticated;

-- Deshace TODO el reparto de una convocatoria: devuelve todo el stock
-- asignado, borra los ajustes manuales, vuelve los pedidos originales a
-- "pendiente" y reabre la convocatoria.
create or replace function uniformes_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  update prendas_catalogo set stock = stock + 1
    where id in (
      select prenda_id from uniformes_pedidos
      where convocatoria_id = p_convocatoria_id and estado = 'asignado'
    );

  delete from uniformes_pedidos where convocatoria_id = p_convocatoria_id and prioridad = 0;

  update uniformes_pedidos
    set estado = 'pendiente'
    where convocatoria_id = p_convocatoria_id and prioridad in (1, 2, 3);

  update uniformes_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;
grant execute on function uniformes_admin_resetear_reparto(uuid) to authenticated;
