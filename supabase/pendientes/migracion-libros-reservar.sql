-- ==================================================================
-- BANCO DE LIBROS: RESERVAR UN EJEMPLAR PARA UN ALUMNO/A
--  · La Junta puede reservar a mano un ejemplar disponible para un
--    alumno/a (lo mismo que hace el reparto): a la familia le aparece
--    como asignado, pendiente de recoger. Si el alumno/a tiene una
--    petición sin ejemplar de ese libro en la convocatoria, se le asigna
--    a esa petición; si no, queda como préstamo a mano sin entregar.
--  · Un ejemplar reservado solo se puede prestar (entregar) a ese
--    alumno/a; al entregarlo pasa a prestado.
--  · Quitar la reserva deja el ejemplar disponible.
-- Se puede ejecutar varias veces.
-- ==================================================================

create or replace function prestamo_admin_reservar(p_ejemplar_id uuid, p_alumno_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ej libros_ejemplares;
  v_al alumnos;
  v_item uuid;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_ej from libros_ejemplares where id = p_ejemplar_id for update;
  if not found then raise exception 'El ejemplar no existe.'; end if;
  if v_ej.estado <> 'disponible' then raise exception 'Ese ejemplar no está disponible.'; end if;
  select * into v_al from alumnos where id = p_alumno_id;
  if not found then raise exception 'El alumno/a no existe.'; end if;
  if exists (select 1 from prestamo_items where alumno_id = v_al.id and libro_id = v_ej.libro_id and estado = 'asignado'
             and ejemplar_id is not null and fecha_devolucion is null) then
    raise exception '% ya tiene un ejemplar de este libro reservado o prestado.', v_al.nombre;
  end if;

  -- Su petición de ese libro en la convocatoria, si la tiene sin ejemplar
  select i.id into v_item from prestamo_items i join prestamo_convocatorias c on c.id = i.convocatoria_id
  where i.alumno_id = v_al.id and i.libro_id = v_ej.libro_id and i.tipo = 'solicitud' and i.ejemplar_id is null
    and i.estado in ('pendiente', 'no_asignado')
  order by c.created_at desc limit 1;

  if v_item is not null then
    update prestamo_items set ejemplar_id = v_ej.id, estado = 'asignado', fecha_asignacion = current_date where id = v_item;
  else
    insert into prestamo_items (alumno_id, socio_id, libro_id, tipo, a_mano, ejemplar_id, estado, fecha_asignacion)
    values (v_al.id, v_al.socio_id, v_ej.libro_id, 'solicitud', true, v_ej.id, 'asignado', current_date);
  end if;
  update libros_ejemplares set estado = 'prestado' where id = v_ej.id;
end;
$$;
grant execute on function prestamo_admin_reservar(uuid, uuid) to authenticated;

create or replace function prestamo_admin_quitar_reserva(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_item prestamo_items;
begin
  if not is_admin() then raise exception 'Solo un admin puede hacer esto.'; end if;
  select * into v_item from prestamo_items where id = p_item_id;
  if not found then raise exception 'La reserva no existe.'; end if;
  if v_item.entregado_en is not null then raise exception 'Ese libro ya se entregó a la familia: registra antes su devolución.'; end if;
  if v_item.ejemplar_id is not null then
    update libros_ejemplares set estado = 'disponible' where id = v_item.ejemplar_id;
  end if;
  if v_item.a_mano then
    delete from prestamo_items where id = p_item_id;
  else
    update prestamo_items set ejemplar_id = null, estado = 'no_asignado', fecha_asignacion = null where id = p_item_id;
  end if;
end;
$$;
grant execute on function prestamo_admin_quitar_reserva(uuid) to authenticated;

notify pgrst, 'reload schema';
