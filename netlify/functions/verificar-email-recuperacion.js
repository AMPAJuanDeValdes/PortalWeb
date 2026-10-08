// Se llama desde login.html ANTES de pedir el email de "recuperar
// contraseña". Solo revela una cosa: si la cuenta está DADA DE BAJA
// (para poder ofrecerle "reactivar"). Para cualquier otro caso —email
// que no existe, cuenta activa, impago, solicitud pendiente— responde
// exactamente igual ({ bloqueado: false }), así nadie puede usar esto
// para averiguar qué emails están registrados.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return json(400, { error: 'JSON no válido' }); }
  const email = String(payload.email || '').trim();
  if (!email) return json(200, { bloqueado: false });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await supabaseAdmin
    .from('adultos')
    .select('socios(estado)')
    .ilike('email', email)
    .limit(1);

  const estado = data && data[0] && data[0].socios ? data[0].socios.estado : null;
  return json(200, { bloqueado: estado === 'baja' });
};
