-- ==================================================================
-- VENTA DE LOTERÍA y LUGAR de los eventos.
-- · Columna «lugar» para todos los eventos (dónde es).
-- · Tipo de evento «loteria»: se publica día, hora y lugar; nadie se
--   apunta y lo ve todo el mundo (también sin cuenta, en la web pública).
--   Varias fechas de venta se crean de una vez como eventos separados.
-- Requiere migracion-eventos-v2.sql y migracion-datos-familia.sql.
-- Se puede ejecutar varias veces.
-- ==================================================================
alter table eventos add column if not exists lugar text;

alter table eventos drop constraint if exists eventos_plantilla_check;
alter table eventos add constraint eventos_plantilla_check check (plantilla is null or plantilla in
  ('chocolatada', 'cabalgata', 'juegos', 'taller', 'barbacoa', 'comedor', 'concurso', 'informativo', 'loteria'));

create or replace function eventos_aplicar_tipo()
returns trigger language plpgsql as $$
begin
  if new.plantilla is null then return new; end if;
  -- Por defecto, con inscripción normal
  if new.plantilla not in ('concurso', 'informativo', 'loteria') then
    new.sin_inscripcion := false; new.usa_concurso_texto := false;
  end if;
  if new.plantilla in ('juegos', 'taller', 'barbacoa', 'concurso') then
    new.tipo_elegibilidad := 'alumnos';
    if new.elegibilidad_modo is null then new.elegibilidad_modo := 'curso'; end if;
  end if;
  case new.plantilla
    when 'chocolatada' then
      new.tipo_elegibilidad := 'toda_familia'; new.pide_alergias := true; new.alumnos_requieren_adulto := true;
      new.permite_invitados := true; new.abierto_no_socios := false; new.publico_solo_actividades := false;
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
    when 'cabalgata' then
      new.tipo_elegibilidad := 'toda_familia'; new.metodo_asignacion := 'sorteo';
      new.requiere_pareja_adulto_alumno := true; new.usa_prioridad_historial := false;
      -- Solo alumnos de 6 a 12 años (edad el día de la cabalgata), no por curso
      new.elegibilidad_modo := 'edad'; new.edad_min := 6; new.edad_max := 12; new.cursos_permitidos := null;
    when 'juegos', 'taller' then
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
      if new.voluntariado_modo = 'adultos_y_ninos' then new.voluntariado_modo := 'adultos'; end if;
    when 'barbacoa' then
      new.metodo_asignacion := 'aforo'; new.requiere_pareja_adulto_alumno := false;
      new.voluntariado_modo := 'adultos_y_ninos'; new.voluntariado_habilitado := true;
      new.permite_invitados := false;
      if new.abierto_no_socios then new.publico_solo_actividades := true; end if;
      -- Sin cursos marcados = todos los alumnos del colegio
      if new.elegibilidad_modo = 'curso' and (new.cursos_permitidos is null or jsonb_array_length(new.cursos_permitidos) = 0) then
        new.cursos_permitidos := (select jsonb_agg(jsonb_build_object('etapa', e, 'curso', c)) from (values
          ('Infantil','0 años'),('Infantil','1 año'),('Infantil','2 años'),('Infantil','3 años'),('Infantil','4 años'),('Infantil','5 años'),
          ('Primaria','1º'),('Primaria','2º'),('Primaria','3º'),('Primaria','4º'),('Primaria','5º'),('Primaria','6º'),
          ('ESO','1º'),('ESO','2º'),('ESO','3º'),('ESO','4º'),('Bachillerato','1º'),('Bachillerato','2º')) v(e, c));
      end if;
    when 'comedor' then
      new.tipo_elegibilidad := 'adultos'; new.metodo_asignacion := 'sorteo';
      new.usa_prioridad_historial := true; new.requiere_pareja_adulto_alumno := false;
    when 'concurso' then
      new.usa_concurso_texto := true; new.sin_inscripcion := false;
    when 'informativo' then
      new.sin_inscripcion := true; new.usa_concurso_texto := false;
    when 'loteria' then
      -- Venta de Lotería: día, hora y lugar. Nadie se apunta y la ve todo el mundo
      new.sin_inscripcion := true; new.usa_concurso_texto := false;
      new.abierto_no_socios := true; new.publico_solo_actividades := false;
      new.voluntariado_modo := 'no'; new.voluntariado_habilitado := false; new.permite_invitados := false;
    else null;
  end case;
  return new;
end;
$$;
