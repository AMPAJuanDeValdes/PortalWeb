-- ==================================================================
-- PRÉSTAMO DE LIBROS — acciones de admin tras el reparto:
-- reasignar un ejemplar, quitar una asignación, o deshacer todo el
-- reparto de una convocatoria.
-- ==================================================================

-- (Re)asigna un ejemplar concreto a una solicitud. Si esa solicitud ya
-- tenía otro ejemplar distinto, lo libera automáticamente.
create or replace function prestamo_admin_asignar(p_item_id uuid, p_ejemplar_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
  v_ejemplar libros_ejemplares;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_item from prestamo_items where id = p_item_id;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  select * into v_ejemplar from libros_ejemplares where id = p_ejemplar_id;
  if not found then
    raise exception 'El ejemplar no existe.';
  end if;
  if v_ejemplar.libro_id <> v_item.libro_id then
    raise exception 'Ese ejemplar no es del mismo título que la solicitud.';
  end if;
  if v_ejemplar.estado <> 'disponible' and v_item.ejemplar_id <> p_ejemplar_id then
    raise exception 'Ese ejemplar no está disponible.';
  end if;

  if v_item.ejemplar_id is not null and v_item.ejemplar_id <> p_ejemplar_id then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;

  update libros_ejemplares set estado = 'prestado' where id = p_ejemplar_id;
  update prestamo_items
    set ejemplar_id = p_ejemplar_id, estado = 'asignado', fecha_asignacion = coalesce(fecha_asignacion, current_date)
    where id = p_item_id;
end;
$$;
grant execute on function prestamo_admin_asignar(uuid, uuid) to authenticated;

-- Quita la asignación de una solicitud (el libro vuelve al stock
-- disponible para poder dárselo a otra familia).
create or replace function prestamo_admin_quitar(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item prestamo_items;
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  select * into v_item from prestamo_items where id = p_item_id;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  if v_item.ejemplar_id is not null then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;

  update prestamo_items
    set ejemplar_id = null, estado = 'no_asignado', fecha_asignacion = null
    where id = p_item_id;
end;
$$;
grant execute on function prestamo_admin_quitar(uuid) to authenticated;

-- Deshace TODO el reparto de una convocatoria: libera todos los
-- ejemplares que había asignado, vuelve las solicitudes a "pendiente" y
-- reabre la convocatoria para poder pulsar "Repartir" de nuevo.
create or replace function prestamo_admin_resetear_reparto(p_convocatoria_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Solo un admin puede hacer esto.';
  end if;

  update libros_ejemplares
    set estado = 'disponible'
    where id in (
      select ejemplar_id from prestamo_items
      where convocatoria_id = p_convocatoria_id and ejemplar_id is not null
    );

  update prestamo_items
    set ejemplar_id = null, estado = 'pendiente', fecha_asignacion = null
    where convocatoria_id = p_convocatoria_id and tipo = 'solicitud';

  update prestamo_convocatorias set estado = 'abierta' where id = p_convocatoria_id;
end;
$$;
grant execute on function prestamo_admin_resetear_reparto(uuid) to authenticated;
