// Función programada (ver netlify.toml): cada 15 minutos mira si la
// familia con turno lleva más de 24 h sin aceptar la mochila. Si es así,
// sale de la lista, el turno pasa a la siguiente y se le manda el email.

const { createClient } = require('@supabase/supabase-js');
const { notificarNuevoTurno } = require('./_lib/mochila');

exports.handler = async () => {
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: idAviso, error } = await supabaseAdmin.rpc('mochila_caducar_turno');
  if (error) { console.error('Mochila: no se pudo revisar el turno:', error.message); return { statusCode: 500 }; }
  if (idAviso) await notificarNuevoTurno(supabaseAdmin, idAviso);
  return { statusCode: 200 };
};
