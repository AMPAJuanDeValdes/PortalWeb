// Función programada (ver netlify.toml): cada 15 minutos, en los eventos con
// sorteo (menos la Cabalgata), si ha quedado libre alguna plaza (alguien se ha
// desapuntado o la Junta le ha quitado la plaza) entra el primer suplente y le
// llega un email.

const { createClient } = require('@supabase/supabase-js');
const { promover } = require('./_lib/sorteo');

exports.handler = async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: eventos, error } = await sb.from('eventos').select('id, fecha, requiere_pareja_adulto_alumno')
    .eq('metodo_asignacion', 'sorteo').eq('sorteo_realizado', true)
    .not('aforo_total', 'is', null);
  if (error) { console.error('Suplentes: no se pudieron leer los eventos:', error.message); return { statusCode: 500 }; }
  for (const ev of (eventos || []).filter(e => !e.requiere_pareja_adulto_alumno)) {
    if (ev.fecha && new Date(ev.fecha) < new Date()) continue;   // ya pasó
    try { await promover(sb, ev.id); }
    catch (e) { console.error('Suplentes: no se pudo revisar el evento', ev.id, e.message); }
  }
  return { statusCode: 200 };
};
