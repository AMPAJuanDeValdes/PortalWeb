-- ==================================================================
-- BANCO DE UNIFORMES: EMAIL DE RECOGIDA
--  · Después de publicar los resultados, la Junta manda a las familias
--    que pidieron uniformes un email con cuándo y dónde recogerlos y qué
--    ha recibido cada alumno/a (Netlify: uniformes-recogida-avisar).
--  · Queda en el historial (difusiones, canal 'recogida').
-- Se puede ejecutar varias veces.
-- ==================================================================
alter table difusiones drop constraint if exists difusiones_canal_check;
alter table difusiones add constraint difusiones_canal_check check (canal in ('aviso', 'circular', 'recogida'));

notify pgrst, 'reload schema';
