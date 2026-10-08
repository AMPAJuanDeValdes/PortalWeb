-- El concurso literario admite un envío POR ALUMNO, no uno por familia.
-- p_alumno_id pasa a ser obligatorio, se valida que pertenezca a la
-- familia del que llama, y se bloquea un segundo envío del mismo alumno
-- para el mismo evento.
create or replace function concurso_enviar_texto(p_evento_id uuid, p_texto text, p_alumno_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_socio_id uuid := mi_socio_id();
  v_envio_id uuid;
begin
  if v_socio_id is null then
    raise exception 'No se pudo identificar tu cuenta de socio.';
  end if;
  if p_alumno_id is null then
    raise exception 'Tienes que indicar a nombre de qué alumno/a envías el texto.';
  end if;
  if not exists (select 1 from alumnos where id = p_alumno_id and socio_id = v_socio_id) then
    raise exception 'Ese alumno/a no pertenece a tu familia.';
  end if;
  if p_texto is null or length(trim(p_texto)) = 0 then
    raise exception 'El texto no puede estar vacío.';
  end if;
  if exists (
    select 1 from concurso_identidades ci
    join concurso_envios ce on ce.id = ci.envio_id
    where ce.evento_id = p_evento_id and ci.alumno_id = p_alumno_id
  ) then
    raise exception 'Este alumno/a ya ha enviado un texto para este concurso.';
  end if;

  insert into concurso_envios (evento_id, texto) values (p_evento_id, p_texto)
  returning id into v_envio_id;

  insert into concurso_identidades (envio_id, socio_id, alumno_id)
  values (v_envio_id, v_socio_id, p_alumno_id);

  return v_envio_id;
end;
$$;
