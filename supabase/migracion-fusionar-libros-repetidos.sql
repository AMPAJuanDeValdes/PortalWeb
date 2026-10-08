-- ============================================================
-- Fusiona títulos repetidos del catálogo de libros.
--
-- Antes un mismo libro usado en varios cursos (p. ej. Coraline en 1º y
-- 2º ESO) se daba de alta una vez por curso. Ahora un título puede tener
-- varios cursos, así que se deja UNO solo por título con todos sus
-- cursos, y sus ejemplares, peticiones y compras pasan a ese registro.
--
-- Se puede ejecutar varias veces: si no hay repetidos, no hace nada.
-- ============================================================
do $$
declare
  g record;
  v_quedan uuid;
  v_sobran uuid[];
begin
  for g in
    select lower(btrim(titulo)) as clave, array_agg(id order by created_at, id) as ids
    from libros_catalogo
    group by lower(btrim(titulo))
    having count(*) > 1
  loop
    v_quedan := g.ids[1];
    v_sobran := g.ids[2:];

    -- todos los cursos de los repetidos, sin duplicar
    update libros_catalogo l set cursos = (
      select array_agg(distinct c order by c)
      from libros_catalogo x, unnest(coalesce(x.cursos, array[x.etapa || '|' || x.curso])) c
      where x.id = any(g.ids)
    ) where l.id = v_quedan;

    update libros_ejemplares set libro_id = v_quedan where libro_id = any(v_sobran);
    update prestamo_items    set libro_id = v_quedan where libro_id = any(v_sobran);
    update libros_compras    set libro_id = v_quedan where libro_id = any(v_sobran);
    delete from libros_catalogo where id = any(v_sobran);

    update libros_catalogo
      set stock = (select count(*) from libros_ejemplares where libro_id = v_quedan and estado <> 'baja')
      where id = v_quedan;

    raise notice 'Fusionado: % (% registros en 1)', g.clave, cardinality(g.ids);
  end loop;
end;
$$;

-- Comprobación: debe salir vacío
select titulo, count(*) from libros_catalogo group by titulo having count(*) > 1;

-- A partir de ahora no se puede repetir un título (en vez de eso se
-- marcan varios cursos en el mismo título).
create unique index if not exists libros_catalogo_titulo_unico on libros_catalogo (lower(btrim(titulo)));
