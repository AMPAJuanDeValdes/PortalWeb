-- ==================================================================
-- Eventos de prueba: uno por cada mecánica diseñada en ESTRUCTURA.md §4.
-- Pensado para ejecutar en el SQL Editor de Supabase DESPUÉS de haber
-- importado el CSV de socios de prueba (así hay alumnos de sobra para
-- que la elegibilidad tenga sentido).
--
-- Fechas de referencia: hoy = 2026-09-29. Ajusta si hace falta.
-- ==================================================================

-- 1. TALLER (aforo, PRIVADO — solo socios) -----------------------------------
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
  aforo_total, metodo_asignacion, fecha_cierre_inscripcion, abierto_no_socios
) values (
  'Taller de Juegos de Mesa',
  'Sesión de juegos de mesa cooperativos para Primaria. Aforo limitado.',
  '2026-10-17 17:00:00+02', 'alumnos', 'curso',
  '[{"etapa":"Primaria","curso":"1º"},{"etapa":"Primaria","curso":"2º"},{"etapa":"Primaria","curso":"3º"},{"etapa":"Primaria","curso":"4º"}]'::jsonb,
  16, 'aforo', '2026-10-14 23:59:00+02', false
);

-- 2. TALLER (aforo, PÚBLICO — fechas de apertura distintas para socios y no socios)
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
  aforo_total, metodo_asignacion, abierto_no_socios,
  fecha_apertura_socios, fecha_apertura_no_socios, fecha_cierre_inscripcion,
  precio_invitado
) values (
  'Taller de Rol para Secundaria',
  'Iniciación a partidas de rol de mesa, pensado para ESO. Los socios se apuntan una semana antes que el resto.',
  '2026-10-24 17:30:00+02', 'alumnos', 'curso',
  '[{"etapa":"ESO","curso":"1º"},{"etapa":"ESO","curso":"2º"},{"etapa":"ESO","curso":"3º"},{"etapa":"ESO","curso":"4º"}]'::jsonb,
  14, 'aforo', true,
  '2026-09-29 09:00:00+02', '2026-10-06 09:00:00+02', '2026-10-20 23:59:00+02',
  5.00
);

-- 3. CABALGATA DEL DISTRITO (pareja obligatoria + sorteo) --------------------
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, elegibilidad_modo, edad_min, edad_max,
  aforo_total, metodo_asignacion, requiere_pareja_adulto_alumno, fecha_cierre_inscripcion
) values (
  'Cabalgata del Distrito',
  'Desfile de Reyes del distrito. Cada alumno debe ir acompañado de un adulto; si hay más peticiones que plazas, se sortea por pareja.',
  '2027-01-04 18:00:00+01', 'alumnos', 'edad', 3, 12,
  20, 'sorteo', true, '2026-12-20 23:59:00+01'
);

-- 4. VISITA AL COMEDOR (2 plazas fijas, sorteo con prioridad histórica) ------
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad,
  aforo_total, metodo_asignacion, usa_prioridad_historial, fecha_cierre_inscripcion
) values (
  'Visita al Comedor Escolar',
  'Dos plazas para conocer el comedor por dentro. Prioridad a quien no haya ido antes.',
  '2026-11-05 13:00:00+01', 'adultos',
  2, 'sorteo', true, '2026-10-29 23:59:00+01'
);

-- 5. CONCURSO DE CHRISTMAS (sin inscripción, puramente informativo) ----------
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, sin_inscripcion
) values (
  'Concurso de Christmas',
  'Concurso de postales navideñas. Entrega tu postal en secretaría antes del 12 de diciembre — no requiere apuntarse aquí.',
  '2026-12-12 00:00:00+01', 'toda_familia', true
);

-- 6. CONCURSO LITERARIO (envío anónimo por alumno) ---------------------------
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, elegibilidad_modo, cursos_permitidos,
  usa_concurso_texto, fecha_cierre_inscripcion
) values (
  'Concurso Literario del Cole',
  'Envía tu relato o poema. El jurado lo lee sin saber quién lo escribió.',
  '2026-11-20 00:00:00+01', 'alumnos', 'curso',
  (select jsonb_agg(jsonb_build_object('etapa', e, 'curso', c))
     from (values ('Primaria','1º'),('Primaria','2º'),('Primaria','3º'),('Primaria','4º'),('Primaria','5º'),('Primaria','6º'),
                   ('ESO','1º'),('ESO','2º'),('ESO','3º'),('ESO','4º'),('Bachillerato','1º'),('Bachillerato','2º')) as t(e,c)),
  true, '2026-11-13 23:59:00+01'
);

-- 7. CHOCOLATADA (el socio invita, pagando, desde su cuenta — nunca pública) -
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad,
  permite_invitados, precio_invitado, abierto_no_socios
) values (
  'Chocolatada de Navidad',
  'Merienda de Navidad. Los socios pueden invitar a un amigo o familiar, pagando su entrada.',
  '2026-12-18 17:00:00+01', 'toda_familia',
  true, 3.00, false
);

-- 8. FORMULARIO DE VOLUNTARIOS (sin aforo, adultos + alumnos acompañados) ----
insert into eventos (
  titulo, descripcion, fecha, tipo_elegibilidad, voluntariado_habilitado
) values (
  'Voluntarios para la Feria del Libro',
  'Necesitamos manos para montar y desmontar los puestos. Los alumnos pueden ayudar acompañados de un adulto de la familia.',
  '2026-10-30 09:00:00+02', 'toda_familia', true
);

-- 9. BARBACOA DEL COLE (alumno gratis, adulto paga, con actividades anidadas
--    y una exclusión entre dos de ellas) -------------------------------------
with nueva_barbacoa as (
  insert into eventos (
    titulo, descripcion, fecha, tipo_elegibilidad,
    precio_adulto, precio_alumno, fecha_cierre_inscripcion
  ) values (
    'Barbacoa de Fin de Curso',
    'Barbacoa para todas las familias. La entrada del alumnado es gratuita (hay que apuntarse igualmente para el recuento); los adultos pagan su entrada.',
    '2027-06-19 13:30:00+02', 'toda_familia',
    8.00, 0.00, '2027-06-12 23:59:00+02'
  )
  returning id
),
act_warhammer as (
  insert into evento_actividades (evento_id, nombre, horario, aforo, elegibilidad_modo, cursos_permitidos)
  select id, 'Torneo de Warhammer', '16:00 - 17:30', 12, 'curso',
         '[{"etapa":"ESO","curso":"1º"},{"etapa":"ESO","curso":"2º"},{"etapa":"ESO","curso":"3º"},{"etapa":"ESO","curso":"4º"}]'::jsonb
  from nueva_barbacoa
  returning id, evento_id
),
act_ajedrez as (
  insert into evento_actividades (evento_id, nombre, horario, aforo, elegibilidad_modo, cursos_permitidos)
  select id, 'Torneo de Ajedrez', '16:00 - 17:30', 12, 'curso',
         '[{"etapa":"Primaria","curso":"4º"},{"etapa":"Primaria","curso":"5º"},{"etapa":"Primaria","curso":"6º"},
           {"etapa":"ESO","curso":"1º"},{"etapa":"ESO","curso":"2º"},{"etapa":"ESO","curso":"3º"},{"etapa":"ESO","curso":"4º"}]'::jsonb
  from nueva_barbacoa
  returning id, evento_id
)
-- Warhammer y Ajedrez son a la misma hora: no se puede ir a los dos.
insert into actividad_exclusiones (actividad_id_1, actividad_id_2)
select act_warhammer.id, act_ajedrez.id from act_warhammer, act_ajedrez;
