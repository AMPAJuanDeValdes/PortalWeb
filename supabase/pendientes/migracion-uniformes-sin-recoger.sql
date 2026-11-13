-- ==================================================================
-- BANCO DE UNIFORMES: EMAIL A QUIEN NO HA RECOGIDO SUS PRENDAS
--  · Panel → Banco de Uniformes, con los resultados publicados: el email
--    de recogida se puede mandar solo a las familias que tienen prendas
--    asignadas sin recoger (ni devueltas al stock), con solo esas prendas.
--  · Queda en el historial de difusiones con su propio canal: sin_recoger.
-- Se puede ejecutar varias veces.
-- ==================================================================

alter table difusiones drop constraint if exists difusiones_canal_check;
alter table difusiones add constraint difusiones_canal_check check (canal in ('aviso', 'circular', 'recogida', 'incompletas', 'sin_recoger'));

notify pgrst, 'reload schema';
