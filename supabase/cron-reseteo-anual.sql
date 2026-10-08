-- ==================================================================
-- RESETEO ANUAL DE SOCIOS (pg_cron)
-- Cada 31 de julio a las 00:00 UTC (02:00 en Madrid) todas las cuentas
-- "activa" pasan a "falta_pago" y sus alumnos a verificado = false.
-- El año escolar va del 1 de agosto al 31 de julio: para el curso nuevo
-- cada familia tiene que volver a pagar la cuota.
--
-- Las cuentas de la Junta (con algún adulto admin) NO se desactivan:
-- si no, nadie podría entrar a aprobar las reactivaciones.
--
-- Se puede ejecutar varias veces: sustituye al job anterior.
-- ==================================================================

-- 1. COMPROBAR (ejecuta solo estas dos consultas para ver cómo está):
--   select jobid, jobname, schedule, command, active from cron.job;
--   select j.jobname, d.status, d.start_time, d.return_message
--     from cron.job_run_details d join cron.job j using (jobid)
--     order by d.start_time desc limit 10;

-- 2. INSTALAR / ACTUALIZAR
create extension if not exists pg_cron;

create or replace function reseteo_anual_socios()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with desactivados as (
    update socios s set estado = 'falta_pago'
    where s.estado = 'activa'
      and not exists (select 1 from adultos a where a.socio_id = s.id and a.role = 'admin')
    returning s.id
  ), alumnos_reset as (
    update alumnos al set verificado = false
    where al.socio_id in (select id from desactivados)
    returning 1
  )
  select count(*) into n from desactivados;
  return n;
end;
$$;
revoke all on function reseteo_anual_socios() from public, anon, authenticated;

-- Quita cualquier job anterior que hiciera este reseteo (con otro nombre)
select cron.unschedule(jobid) from cron.job
where jobname = 'reseteo-anual-socios' or command ilike '%falta_pago%';

select cron.schedule('reseteo-anual-socios', '0 0 31 7 *', 'select reseteo_anual_socios()');

-- Comprobación
select jobid, jobname, schedule, command, active from cron.job;
