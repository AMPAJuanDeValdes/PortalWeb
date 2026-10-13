-- ==================================================================
-- MOCHILA: la lista no se puede editar mientras una familia tiene el turno
-- (ya le ha llegado el email). Antes, al guardar la lista se le quitaba el
-- turno sin avisarla y el enlace del email dejaba de funcionar.
-- Se puede ejecutar varias veces.
-- ==================================================================

-- 7. Junta: «Editar lista». Quien la tiene, siempre primera. Mientras una
--    familia tiene el turno (le ha llegado el email), la lista no se toca:
--    se libera cuando lo rechaza, caduca o se le entrega la mochila.
create or replace function mochila_admin_guardar_lista(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_tiene uuid;
begin
  if not is_admin() then raise exception 'Solo la Junta puede hacer esto.'; end if;
  lock table mochila_cola in share row exclusive mode;
  if exists (select 1 from mochila_cola where estado in ('asignada', 'aceptada')) then
    raise exception 'Hay una familia con el turno asignado: la lista no se puede cambiar hasta que lo rechace o se le entregue la mochila.';
  end if;
  p_ids := coalesce(p_ids, '{}');
  select id into v_tiene from mochila_cola where estado = 'la_tiene';
  if v_tiene is not null and (array_length(p_ids, 1) is null or p_ids[1] <> v_tiene) then
    raise exception 'La familia que tiene la mochila no se puede mover ni quitar: márcala antes como recibida.';
  end if;
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from mochila_cola c where c.id = x)) then
    raise exception 'La lista ha cambiado mientras la editabas. Recarga la página.';
  end if;
  delete from mochila_cola where not (id = any(p_ids));
  set constraints mochila_cola_posicion_unica deferred;
  update mochila_cola c set posicion = o.n
  from unnest(p_ids) with ordinality as o(id, n) where c.id = o.id;
end;
$$;
grant execute on function mochila_admin_guardar_lista(uuid[]) to authenticated;
