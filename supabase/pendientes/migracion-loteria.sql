-- ==================================================================
-- LOTERÍA (panel de la Junta)
--  · Cada año, una campaña (por ejemplo «Lotería de Navidad 2026») con
--    sus talonarios. Cada talonario tiene 25 participaciones de 5 € (125 €
--    el talonario entero); las participaciones van numeradas seguidas:
--    talonario 1 → 1-25, talonario 2 → 26-50...
--  · De cada talonario se apunta quién lo tiene (una familia socia o
--    cualquier otra persona), cuántas participaciones ha vendido, si lo ha
--    devuelto y cada ingreso de su dinero en la cuenta del AMPA.
--  · No se puede ingresar más de lo vendido, ni vender más participaciones
--    de las que tiene el talonario.
--  · Todo cambio queda en el historial (quién lo hizo y cuándo).
--  · La campaña se comienza (fecha desde la que hay participaciones) y se
--    cierra cuando ya no se venden más. Mientras está abierta, en la página
--    principal y en el portal sale «Quiero comprar Lotería» (loteria.html):
--    las fechas de venta y un mensaje para la Junta (loteria_mensajes).
--  · Solo la Junta lo ve y lo toca.
-- Se puede ejecutar varias veces.
-- ==================================================================
create table if not exists loteria_campanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  numeros text,                                   -- número(s) que juega el AMPA
  precio numeric(6,2) not null default 5 check (precio > 0),
  participaciones_por_talonario integer not null default 25 check (participaciones_por_talonario between 1 and 500),
  inicio date,                                    -- desde cuándo hay participaciones (campaña comenzada)
  cerrada_en timestamptz,                         -- ya no se venden más
  created_at timestamptz not null default now()
);

create table if not exists loteria_talonarios (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references loteria_campanas(id) on delete cascade,
  numero integer not null check (numero > 0),
  socio_id uuid references socios(id) on delete set null,
  titular_nombre text,
  titular_movil text,
  entregado_en date,
  vendidas integer not null default 0 check (vendidas >= 0),
  devuelto_en date,                               -- devuelve las que no ha vendido
  nota text,
  updated_at timestamptz not null default now(),
  unique (campana_id, numero)
);
create index if not exists loteria_talonarios_socio on loteria_talonarios(socio_id);

create table if not exists loteria_ingresos (
  id uuid primary key default gen_random_uuid(),
  talonario_id uuid not null references loteria_talonarios(id) on delete cascade,
  importe numeric(8,2) not null check (importe > 0),
  fecha date not null default current_date,
  nota text,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists loteria_ingresos_talonario on loteria_ingresos(talonario_id);

create table if not exists loteria_movimientos (
  id bigint generated always as identity primary key,
  campana_id uuid not null references loteria_campanas(id) on delete cascade,
  talonario_numero integer,
  texto text not null,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists loteria_movimientos_campana on loteria_movimientos(campana_id, created_at desc);

alter table loteria_campanas enable row level security;
alter table loteria_talonarios enable row level security;
alter table loteria_ingresos enable row level security;
alter table loteria_movimientos enable row level security;
drop policy if exists "la junta gestiona la loteria" on loteria_campanas;
create policy "la junta gestiona la loteria" on loteria_campanas for all using (is_admin()) with check (is_admin());
drop policy if exists "la junta gestiona los talonarios" on loteria_talonarios;
create policy "la junta gestiona los talonarios" on loteria_talonarios for all using (is_admin()) with check (is_admin());
drop policy if exists "la junta gestiona los ingresos de loteria" on loteria_ingresos;
create policy "la junta gestiona los ingresos de loteria" on loteria_ingresos for all using (is_admin()) with check (is_admin());
drop policy if exists "la junta ve el historial de loteria" on loteria_movimientos;
create policy "la junta ve el historial de loteria" on loteria_movimientos for select using (is_admin());

create or replace function _loteria_quien() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select trim(nombre || ' ' || coalesce(apellidos, '')) from adultos where id = auth.uid()), 'Sistema');
$$;

create or replace function _loteria_ingresado(p_talonario uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(importe), 0) from loteria_ingresos where talonario_id = p_talonario;
$$;

-- 125 → «125 €», 12.5 → «12,50 €»
create or replace function _eur(p numeric) returns text language sql immutable as $$
  select case when p = trunc(p) then trunc(p)::text else replace(to_char(p, 'FM999999990.00'), '.', ',') end || ' €';
$$;

-- Reglas de cada talonario e historial de cambios
create or replace function loteria_talonario_cambia() returns trigger language plpgsql security definer set search_path = public as $$
declare
  c loteria_campanas;
  v_quien text := _loteria_quien();
  v_tit text;
begin
  select * into c from loteria_campanas where id = new.campana_id;
  if new.vendidas > c.participaciones_por_talonario then
    raise exception 'Un talonario tiene % participaciones: no se pueden vender %.', c.participaciones_por_talonario, new.vendidas;
  end if;
  new.titular_nombre := nullif(trim(new.titular_nombre), '');
  new.titular_movil := nullif(trim(new.titular_movil), '');
  if new.socio_id is not null and new.titular_nombre is null then
    raise exception 'Escribe el nombre de quien tiene el talonario %.', new.numero;
  end if;
  if new.vendidas > 0 and new.titular_nombre is null and tg_op = 'UPDATE' and old.titular_nombre is not null then
    raise exception 'El talonario % tiene % vendidas: no se puede dejar sin nadie (si lo tiene otra persona, cámbiale el nombre).', new.numero, new.vendidas;
  end if;
  if new.vendidas > 0 and new.titular_nombre is null then
    raise exception 'El talonario % no lo tiene nadie: asígnalo antes de apuntar ventas.', new.numero;
  end if;
  if tg_op = 'UPDATE' then
    if new.vendidas * c.precio < _loteria_ingresado(new.id) then
      raise exception 'Del talonario % ya se han ingresado %: no puede tener menos de % vendidas.',
        new.numero, _eur(_loteria_ingresado(new.id)), ceil(_loteria_ingresado(new.id) / c.precio);
    end if;
    if new.titular_nombre is null and old.titular_nombre is not null and _loteria_ingresado(new.id) > 0 then
      raise exception 'El talonario % ya tiene ingresos: no se puede dejar sin nadie.', new.numero;
    end if;
    new.updated_at := now();
    v_tit := coalesce(new.titular_nombre, 'nadie');
    if coalesce(new.titular_nombre, '') is distinct from coalesce(old.titular_nombre, '') then
      insert into loteria_movimientos (campana_id, talonario_numero, texto, creado_por_nombre)
      values (new.campana_id, new.numero, case when new.titular_nombre is null then 'Queda sin asignar (lo tenía ' || old.titular_nombre || ')'
        when old.titular_nombre is null then 'Se entrega a ' || new.titular_nombre
        else 'Pasa de ' || old.titular_nombre || ' a ' || new.titular_nombre end, v_quien);
    end if;
    if new.vendidas <> old.vendidas then
      insert into loteria_movimientos (campana_id, talonario_numero, texto, creado_por_nombre)
      values (new.campana_id, new.numero, 'Vendidas: ' || old.vendidas || ' → ' || new.vendidas || ' (' || v_tit || ')', v_quien);
    end if;
    if new.devuelto_en is distinct from old.devuelto_en then
      insert into loteria_movimientos (campana_id, talonario_numero, texto, creado_por_nombre)
      values (new.campana_id, new.numero, case when new.devuelto_en is null then 'Se anula la devolución'
        else 'Devuelto con ' || (c.participaciones_por_talonario - new.vendidas) || ' sin vender (' || v_tit || ')' end, v_quien);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists loteria_talonario_cambia on loteria_talonarios;
create trigger loteria_talonario_cambia before insert or update on loteria_talonarios
  for each row execute function loteria_talonario_cambia();

create or replace function loteria_ingreso_cambia() returns trigger language plpgsql security definer set search_path = public as $$
declare
  t loteria_talonarios;
  c loteria_campanas;
  v_otros numeric;
begin
  select * into t from loteria_talonarios where id = coalesce(new.talonario_id, old.talonario_id);
  select * into c from loteria_campanas where id = t.campana_id;
  if tg_op = 'DELETE' then
    if t.id is null then return old; end if;   -- se está borrando el talonario o la campaña entera
    insert into loteria_movimientos (campana_id, talonario_numero, texto, creado_por_nombre)
    values (t.campana_id, t.numero, 'Se borra el ingreso de ' || _eur(old.importe) || ' del ' || to_char(old.fecha, 'DD/MM/YYYY'), _loteria_quien());
    return old;
  end if;
  v_otros := coalesce((select sum(importe) from loteria_ingresos where talonario_id = t.id and id <> new.id), 0);
  if v_otros + new.importe > t.vendidas * c.precio then
    raise exception 'Del talonario % hay % vendidas (%) y ya se han ingresado %: como mucho se pueden ingresar % más. Si se han vendido más, apúntalo antes.',
      t.numero, t.vendidas, _eur(t.vendidas * c.precio), _eur(v_otros), _eur(t.vendidas * c.precio - v_otros);
  end if;
  if tg_op = 'INSERT' then
    new.creado_por_nombre := _loteria_quien();
    insert into loteria_movimientos (campana_id, talonario_numero, texto, creado_por_nombre)
    values (t.campana_id, t.numero, 'Ingreso de ' || _eur(new.importe) || ' en la cuenta el ' || to_char(new.fecha, 'DD/MM/YYYY') || coalesce(' (' || t.titular_nombre || ')', ''), new.creado_por_nombre);
  end if;
  return new;
end;
$$;
drop trigger if exists loteria_ingreso_cambia on loteria_ingresos;
create trigger loteria_ingreso_cambia before insert or update or delete on loteria_ingresos
  for each row execute function loteria_ingreso_cambia();

-- Crear los talonarios de una campaña (o añadir más): del siguiente número
-- libre en adelante
create or replace function loteria_crear_talonarios(p_campana uuid, p_cuantos integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_desde integer;
begin
  if not is_admin() then raise exception 'Solo la Junta.'; end if;
  if p_cuantos is null or p_cuantos < 1 or p_cuantos > 1000 then raise exception 'Indica cuántos talonarios (de 1 a 1000).'; end if;
  select coalesce(max(numero), 0) + 1 into v_desde from loteria_talonarios where campana_id = p_campana;
  insert into loteria_talonarios (campana_id, numero) select p_campana, g from generate_series(v_desde, v_desde + p_cuantos - 1) g;
  insert into loteria_movimientos (campana_id, texto, creado_por_nombre)
  values (p_campana, 'Se crean los talonarios ' || v_desde || ' a ' || (v_desde + p_cuantos - 1), _loteria_quien());
  return p_cuantos;
end;
$$;
grant execute on function loteria_crear_talonarios(uuid, integer) to authenticated;

-- Las reglas de la campaña no cambian si ya hay ventas
create or replace function loteria_campana_cambia() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.precio <> old.precio or new.participaciones_por_talonario <> old.participaciones_por_talonario)
     and exists (select 1 from loteria_talonarios where campana_id = new.id and vendidas > 0) then
    raise exception 'Ya hay participaciones vendidas: no se puede cambiar el precio ni las participaciones por talonario.';
  end if;
  return new;
end;
$$;
drop trigger if exists loteria_campana_cambia on loteria_campanas;
create trigger loteria_campana_cambia before update on loteria_campanas
  for each row execute function loteria_campana_cambia();

-- Asignar un grupo de talonarios enteros a la misma persona, dando las
-- participaciones (de la 1 a la 300 → talonarios 1 a 12). No se puede
-- asignar parte de un talonario.
-- p_reasignar = false: los que ya tiene otra persona no se tocan.
-- p_reasignar = true:  pasan también a la nueva persona.
-- Devuelve cuántos talonarios se han asignado.
create or replace function loteria_asignar(p_campana uuid, p_desde integer, p_hasta integer,
  p_socio uuid, p_nombre text, p_movil text, p_entregado date default null, p_reasignar boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c loteria_campanas;
  v_t1 integer; v_t2 integer; v_hay integer; v_n integer;
  v_nombre text := nullif(trim(p_nombre), '');
begin
  if not is_admin() then raise exception 'Solo la Junta.'; end if;
  select * into c from loteria_campanas where id = p_campana;
  if c.id is null then raise exception 'La campaña no existe.'; end if;
  if v_nombre is null then raise exception 'Escribe el nombre de quien recibe los talonarios.'; end if;
  if p_desde is null or p_hasta is null or p_desde < 1 or p_hasta < p_desde then
    raise exception 'Indica de qué participación a qué participación.';
  end if;
  if (p_desde - 1) % c.participaciones_por_talonario <> 0 or p_hasta % c.participaciones_por_talonario <> 0 then
    raise exception 'Solo se pueden asignar talonarios enteros: la primera participación tiene que ser 1, %, %… y la última %, %, %…',
      c.participaciones_por_talonario + 1, 2 * c.participaciones_por_talonario + 1,
      c.participaciones_por_talonario, 2 * c.participaciones_por_talonario, 3 * c.participaciones_por_talonario;
  end if;
  v_t1 := (p_desde - 1) / c.participaciones_por_talonario + 1;
  v_t2 := p_hasta / c.participaciones_por_talonario;
  select count(*) into v_hay from loteria_talonarios where campana_id = p_campana and numero between v_t1 and v_t2;
  if v_hay < v_t2 - v_t1 + 1 then
    raise exception 'Hay talonarios entre el % y el % que no existen en esta campaña: añádelos antes.', v_t1, v_t2;
  end if;
  update loteria_talonarios
     set socio_id = p_socio, titular_nombre = v_nombre, titular_movil = nullif(trim(p_movil), ''),
         entregado_en = coalesce(p_entregado, current_date)
   where campana_id = p_campana and numero between v_t1 and v_t2
     and (p_reasignar or titular_nombre is null
          or (lower(titular_nombre) = lower(v_nombre) and socio_id is not distinct from p_socio));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function loteria_asignar(uuid, integer, integer, uuid, text, text, date, boolean) to authenticated;

-- Comenzar y cerrar la campaña (si se ejecutó una versión anterior de
-- esta migración, «cerrada» pasa a «cerrada_en»)
alter table loteria_campanas add column if not exists inicio date;
alter table loteria_campanas add column if not exists cerrada_en timestamptz;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'loteria_campanas' and column_name = 'cerrada') then
    execute 'update loteria_campanas set cerrada_en = coalesce(cerrada_en, now()) where cerrada';
    execute 'alter table loteria_campanas drop column cerrada';
  end if;
end $$;
-- Solo una campaña abierta (comenzada y sin cerrar) a la vez
create unique index if not exists loteria_una_campana_abierta on loteria_campanas ((true)) where inicio is not null and cerrada_en is null;

-- La campaña abierta hoy, para la web pública (sin datos de la Junta)
create or replace function loteria_publica()
returns table (id uuid, nombre text, numeros text, precio numeric, inicio date)
language sql stable security definer set search_path = public as $$
  select id, nombre, numeros, precio, inicio from loteria_campanas
   where inicio is not null and inicio <= (now() at time zone 'Europe/Madrid')::date and cerrada_en is null
   limit 1;
$$;
grant execute on function loteria_publica() to anon, authenticated;

-- Mensajes de «Quiero comprar Lotería». Los guarda la función
-- netlify/functions/loteria-mensaje.js (que también avisa por email).
create table if not exists loteria_mensajes (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid references loteria_campanas(id) on delete cascade,
  socio_id uuid references socios(id) on delete set null,
  nombre text not null,
  apellidos text not null,
  email text not null,
  movil text not null,
  mensaje text not null,
  atendido_en timestamptz,
  nota_junta text,
  created_at timestamptz not null default now()
);
create index if not exists loteria_mensajes_campana on loteria_mensajes(campana_id, created_at desc);
alter table loteria_mensajes enable row level security;
drop policy if exists "la junta gestiona los mensajes de loteria" on loteria_mensajes;
create policy "la junta gestiona los mensajes de loteria" on loteria_mensajes for all using (is_admin()) with check (is_admin());

-- Historial: comenzar, cerrar y reabrir la campaña
create or replace function loteria_campana_historial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inicio is distinct from old.inicio then
    insert into loteria_movimientos (campana_id, texto, creado_por_nombre)
    values (new.id, case when new.inicio is null then 'Se anula el comienzo de la campaña'
      else 'Campaña comenzada: participaciones disponibles desde el ' || to_char(new.inicio, 'DD/MM/YYYY') end, _loteria_quien());
  end if;
  if new.cerrada_en is distinct from old.cerrada_en then
    insert into loteria_movimientos (campana_id, texto, creado_por_nombre)
    values (new.id, case when new.cerrada_en is null then 'Campaña reabierta' else 'Campaña cerrada' end, _loteria_quien());
  end if;
  return new;
end;
$$;
drop trigger if exists loteria_campana_historial on loteria_campanas;
create trigger loteria_campana_historial after update on loteria_campanas
  for each row execute function loteria_campana_historial();

-- Mensaje claro si ya hay otra campaña abierta
create or replace function loteria_campana_una_abierta() returns trigger language plpgsql security definer set search_path = public as $$
declare v_otra text;
begin
  if new.inicio is not null and new.cerrada_en is null then
    select nombre into v_otra from loteria_campanas where id <> new.id and inicio is not null and cerrada_en is null limit 1;
    if v_otra is not null then raise exception 'Ya hay otra campaña abierta («%»): ciérrala antes de comenzar esta.', v_otra; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists loteria_campana_una_abierta on loteria_campanas;
create trigger loteria_campana_una_abierta before insert or update on loteria_campanas
  for each row execute function loteria_campana_una_abierta();

-- Que la API vea ya las funciones nuevas (evita «Could not find the function ... in the schema cache»)
notify pgrst, 'reload schema';
