-- ============================================================
-- BORRA TODOS LOS EVENTOS y crea un juego de eventos de prueba.
-- Se borran también sus inscripciones, subactividades, premios, fotos,
-- documentos a firmar y textos de concursos (en cascada).
-- Requiere haber ejecutado migracion-eventos-v2.sql.
-- ============================================================
begin;

delete from eventos;

do $$
declare
  hoy date := current_date;
  primaria_3_6 jsonb := '[{"etapa":"Primaria","curso":"3º"},{"etapa":"Primaria","curso":"4º"},{"etapa":"Primaria","curso":"5º"},{"etapa":"Primaria","curso":"6º"}]';
  primaria_1_2 jsonb := '[{"etapa":"Primaria","curso":"1º"},{"etapa":"Primaria","curso":"2º"}]';
  eso jsonb := '[{"etapa":"ESO","curso":"1º"},{"etapa":"ESO","curso":"2º"},{"etapa":"ESO","curso":"3º"},{"etapa":"ESO","curso":"4º"}]';
  primaria_eso jsonb;
  v_juegos uuid; v_barbacoa uuid; v_literario uuid; v_christmas uuid; v_olimpiadas uuid; v_ajedrez uuid; v_catan uuid;
begin
  primaria_eso := '[{"etapa":"Primaria","curso":"1º"},{"etapa":"Primaria","curso":"2º"}]'::jsonb || primaria_3_6 || eso;

  -- 1. Chocolatada: toda la familia, alergias, invitados no socios de pago, voluntarios
  insert into eventos (plantilla, titulo, descripcion, fecha, fecha_cierre_inscripcion, precio_invitado, voluntariado_modo)
  values ('chocolatada', 'Chocolatada de Navidad',
    E'En el patio del colegio. Chocolate con churros para toda la familia.\nTrae tu taza para reducir residuos.',
    (hoy + 20) + time '17:00', (hoy + 15) + time '23:59', 3, 'adultos_y_ninos');

  -- 2. Cabalgata: alumno con adulto, sorteo, 20 plazas de alumnos
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, fecha_cierre_inscripcion)
  values ('cabalgata', 'Cabalgata de Reyes del distrito',
    'Desfilamos con la carroza del AMPA. Cada alumno o alumna va con un adulto. Las plazas se sortean al cerrar el plazo.',
    (hoy + 40) + time '17:30', 20, (hoy + 10) + time '23:59');

  -- 3. Taller de juegos de mesa: 3º a 6º de Primaria, externos de pago, pregunta de Patines, torneo
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
    abierto_no_socios, precio_invitado, voluntariado_modo, pregunta_extra, pregunta_opciones, fecha_cierre_inscripcion)
  values ('juegos', 'Taller de juegos de mesa', 'Jueves de 16:30 a 18:00 en la biblioteca.',
    (hoy + 7) + time '16:30', 20, 'alumnos', 'curso', primaria_3_6, true, 5, 'adultos',
    '¿Cómo llega al taller?', array['Directo de clase', 'Pasa antes por Patines'], (hoy + 5) + time '23:59')
  returning id into v_juegos;
  insert into evento_actividades (evento_id, nombre, horario, aforo) values (v_juegos, 'Torneo de Catán', 'Último jueves, 18:00', 8)
  returning id into v_catan;
  insert into evento_premios (evento_id, actividad_id, puesto, premio, orden) values
    (v_juegos, v_catan, '1er premio', 'Un juego de mesa', 0),
    (v_juegos, v_catan, '2º premio', 'Medalla', 1);

  -- 4. Taller de rol: ESO, 6 plazas
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
    abierto_no_socios, precio_invitado, voluntariado_modo)
  values ('taller', 'Taller de juegos de rol', 'Martes de 16:30 a 18:30.',
    (hoy + 9) + time '16:30', 6, 'alumnos', 'curso', eso, true, 5, 'adultos');

  -- 5. Warhammer: solo ESO, todo el curso
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos, voluntariado_modo)
  values ('taller', 'Taller de Warhammer', 'Viernes de 16:30 a 18:30, durante todo el curso. Los apuntados ahora son los del año entero.',
    (hoy + 11) + time '16:30', 12, 'alumnos', 'curso', eso, 'adultos');

  -- 6. Taller de ciencias: 1º y 2º de Primaria, siempre directo de clase
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
    abierto_no_socios, precio_invitado, voluntariado_modo)
  values ('taller', 'Taller de ciencias', E'Miércoles de 16:30 a 17:30.\nVienen siempre directamente de clase.',
    (hoy + 8) + time '16:30', 15, 'alumnos', 'curso', primaria_1_2, true, 5, 'adultos');

  -- 7. Barbacoa: solo alumnos (gratis), adultos pagan en la entrada, subactividades, externos solo a subactividades
  insert into eventos (plantilla, titulo, descripcion, fecha, abierto_no_socios, precio_adulto, aviso_no_socios, fecha_cierre_inscripcion)
  values ('barbacoa', 'Barbacoa de fin de curso', 'En el patio grande. Los alumnos socios entran gratis.',
    (hoy + 60) + time '12:00', true, 8, 'Recordad que hay que pagar la entrada de la Barbacoa.', (hoy + 55) + time '23:59')
  returning id into v_barbacoa;
  insert into evento_actividades (evento_id, nombre, horario, aforo) values
    (v_barbacoa, 'Torneo de Warhammer', '12:30', 16),
    (v_barbacoa, 'Rol en vivo', '13:00', 20);
  insert into evento_actividades (evento_id, nombre, horario, aforo) values (v_barbacoa, 'Torneo de ajedrez', '16:00', 24)
  returning id into v_ajedrez;
  insert into evento_premios (evento_id, actividad_id, puesto, premio, orden) values
    (v_barbacoa, v_ajedrez, 'Campeón', 'Trofeo', 0),
    (v_barbacoa, v_ajedrez, 'Subcampeón', 'Medalla', 1);

  -- 8. Visita al comedor: solo adultos, 2 plazas, sorteo con prioridad a quien nunca fue
  insert into eventos (plantilla, titulo, descripcion, fecha, aforo_total, fecha_cierre_inscripcion)
  values ('comedor', 'Visita al comedor', 'Dos familias comen con los alumnos y comprueban el servicio.',
    (hoy + 14) + time '13:00', 2, (hoy + 6) + time '23:59');

  -- 9. Concurso literario: un texto (Word) por alumno, con premios
  insert into eventos (plantilla, titulo, descripcion, fecha, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos, fecha_cierre_inscripcion)
  values ('concurso', 'Concurso literario', 'Tema libre. Máximo dos páginas. Con los textos haremos un libro.',
    (hoy + 45) + time '18:00', 'alumnos', 'curso', primaria_eso, (hoy + 30) + time '23:59')
  returning id into v_literario;
  insert into evento_premios (evento_id, puesto, premio, orden) values
    (v_literario, '1er premio Primaria', 'Lote de libros', 0),
    (v_literario, '1er premio ESO', 'Lote de libros', 1);

  -- 10. Concurso de Christmas: informativo, con premios
  insert into eventos (plantilla, titulo, descripcion, fecha)
  values ('informativo', 'Concurso de Christmas', 'Entregad el dibujo a vuestro tutor antes de las vacaciones.', (hoy + 18) + time '17:00')
  returning id into v_christmas;
  insert into evento_premios (evento_id, puesto, premio, orden) values
    (v_christmas, 'Infantil', 'Caja de pinturas', 0), (v_christmas, 'Primaria', 'Caja de pinturas', 1);

  -- 11. Olimpiadas matemáticas: informativo, con premios
  insert into eventos (plantilla, titulo, descripcion, fecha)
  values ('informativo', 'Olimpiadas matemáticas', 'Prueba en el colegio para 5º y 6º de Primaria y ESO.', (hoy + 50) + time '10:00')
  returning id into v_olimpiadas;
  insert into evento_premios (evento_id, puesto, premio, orden) values
    (v_olimpiadas, '1er puesto', 'Calculadora científica', 0);
end $$;

commit;

-- Comprobación
select titulo, plantilla, to_char(fecha, 'DD/MM HH24:MI') as dia, aforo_total, metodo_asignacion, voluntariado_modo
from eventos order by eventos.fecha;
