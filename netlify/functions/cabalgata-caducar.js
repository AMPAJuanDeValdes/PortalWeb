// Función programada (ver netlify.toml): cada 30 minutos, en las Cabalgatas
// con la gestión empezada, quien no ha confirmado a tiempo pierde la plaza
// y entra el siguiente suplente (con email y aviso al móvil).

const { createClient } = require('@supabase/supabase-js');
const { caducar } = require('./_lib/cabalgata');

exports.handler = async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: eventos, error } = await sb.from('eventos').select('id, fecha')
    .not('gestion_confirmar_hasta', 'is', null).eq('sorteo_realizado', true);
  if (error) { console.error('Cabalgata: no se pudieron leer los eventos:', error.message); return { statusCode: 500 }; }
  for (const ev of eventos || []) {
    if (ev.fecha && new Date(ev.fecha) < new Date()) continue;   // ya pasó
    try { await caducar(sb, ev.id); }
    catch (e) { console.error('Cabalgata: no se pudieron revisar los plazos:', e.message); }
  }
  return { statusCode: 200 };
};
