-- ==================================================================
-- DOMICILIACIÓN ⇔ IBAN
--  · Una cuenta con domiciliación bancaria tiene IBAN, y una cuenta con
--    IBAN tiene domiciliación bancaria. La base de datos ya no deja guardar
--    una cosa sin la otra.
--  · La familia que elige domiciliación en el alta queda «pendiente de
--    firmar» (sepa_pendiente) hasta que firma la orden SEPA: la web se la
--    pide al entrar. También puede pasar a pagar por transferencia.
--  · Las familias ya no pueden cambiar la forma de pago ni el IBAN a mano:
--    solo firmando la orden SEPA (o la Junta desde el panel).
--  · Arregla los datos que ya hay:
--      - con IBAN y sin domiciliación → domiciliación;
--      - con domiciliación y sin IBAN → pendiente de firmar la orden.
-- Se puede ejecutar varias veces.
-- ==================================================================
alter table socios add column if not exists sepa_pendiente boolean not null default false;

-- 1. Normaliza el IBAN (sin espacios, en mayúsculas) y aplica la regla
create or replace function socios_normalizar_pago()
returns trigger language plpgsql set search_path = public as $$
begin
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '[\s-]', '', 'g')), '');
  if new.forma_pago = 'Domiciliación Bancaria' and new.iban is null then
    raise exception 'Con domiciliación bancaria hace falta el IBAN.';
  end if;
  if new.iban is not null and new.forma_pago is distinct from 'Domiciliación Bancaria' then
    raise exception 'Con IBAN, la forma de pago es domiciliación bancaria (o borra el IBAN).';
  end if;
  -- Ya hay forma de pago: no queda nada pendiente de firmar
  if new.forma_pago is not null then new.sepa_pendiente := false; end if;
  return new;
end;
$$;

-- 2. Arregla los datos actuales (antes del trigger y de la restricción)
drop trigger if exists trg_socios_normalizar_pago on socios;
alter table socios drop constraint if exists socios_domiciliacion_iban;
update socios set iban = nullif(upper(regexp_replace(coalesce(iban, ''), '[\s-]', '', 'g')), '')
  where iban is distinct from nullif(upper(regexp_replace(coalesce(iban, ''), '[\s-]', '', 'g')), '');
update socios set forma_pago = 'Domiciliación Bancaria', sepa_pendiente = false
  where iban is not null and forma_pago is distinct from 'Domiciliación Bancaria';
update socios set forma_pago = null, sepa_pendiente = true
  where forma_pago = 'Domiciliación Bancaria' and iban is null;

create trigger trg_socios_normalizar_pago before insert or update on socios
  for each row execute function socios_normalizar_pago();
alter table socios add constraint socios_domiciliacion_iban
  check ((coalesce(forma_pago, '') = 'Domiciliación Bancaria') = (iban is not null));

-- 3. La familia no cambia la forma de pago ni el IBAN a mano
create or replace function proteger_campos_socio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.estado is distinct from old.estado and new.estado <> 'baja' then
    raise exception 'Solo el AMPA puede cambiar el estado de la cuenta.';
  end if;
  if new.numero_secuencial is distinct from old.numero_secuencial
     or new.anio_ultima_cuota is distinct from old.anio_ultima_cuota
     or new.codigo_asociacion is distinct from old.codigo_asociacion
     or new.motivo_rechazo is distinct from old.motivo_rechazo
     or new.reactivacion_solicitada_en is distinct from old.reactivacion_solicitada_en then
    raise exception 'Solo el AMPA puede cambiar el número de socio o la cuota.';
  end if;
  if new.datos_revisados_en is distinct from old.datos_revisados_en
     and coalesce(current_setting('ampa.confirmando_datos', true), '') <> 'si' then
    raise exception 'Para confirmar los datos de la familia usa el botón de Mis datos.';
  end if;
  if (new.forma_pago is distinct from old.forma_pago or new.iban is distinct from old.iban
      or new.sepa_pendiente is distinct from old.sepa_pendiente)
     and coalesce(current_setting('ampa.cambiando_pago', true), '') <> 'si' then
    raise exception 'Para domiciliar la cuota firma la orden SEPA en Mis datos.';
  end if;
  return new;
end;
$$;

-- 4. Firmar la orden SEPA: domicilia la cuota con ese IBAN
create or replace function mandato_sepa_firmar(
  p_iban text, p_archivo_url text, p_datos_finales jsonb, p_aviso_diferencias boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
  v_iban text := upper(regexp_replace(coalesce(p_iban, ''), '[\s-]', '', 'g'));
  v_id uuid;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then
    raise exception 'Falta el IBAN o no es válido.';
  end if;

  update mandatos_sepa set vigente = false where socio_id = v_socio_id and vigente = true;

  insert into mandatos_sepa (socio_id, adulto_id, iban, archivo_final_url, datos_finales, aviso_diferencias, vigente)
  values (v_socio_id, auth.uid(), v_iban, p_archivo_url, p_datos_finales, p_aviso_diferencias, true)
  returning id into v_id;

  perform set_config('ampa.cambiando_pago', 'si', true);
  update socios set forma_pago = 'Domiciliación Bancaria', iban = v_iban, sepa_pendiente = false where id = v_socio_id;
  perform set_config('ampa.cambiando_pago', '', true);

  return v_id;
end;
$$;
grant execute on function mandato_sepa_firmar(text, text, jsonb, boolean) to authenticated;

-- 5. Eligió domiciliación pero prefiere pagar por transferencia
create or replace function socio_pagar_por_transferencia()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if not exists (select 1 from socios where id = v_socio_id and sepa_pendiente) then
    raise exception 'Para dejar la domiciliación, escribe a la Junta del AMPA.';
  end if;
  perform set_config('ampa.cambiando_pago', 'si', true);
  update socios set forma_pago = 'Transferencia', iban = null, sepa_pendiente = false where id = v_socio_id;
  perform set_config('ampa.cambiando_pago', '', true);
end;
$$;
grant execute on function socio_pagar_por_transferencia() to authenticated;
