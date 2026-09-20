// Apunta al socio que llama a la cola de la Mochila Jugona Exploradora.
// La posición la calcula el trigger de la base de datos, nunca el cliente.
// Si la cola estaba vacía, la nueva entrada queda directamente en
// posición 1 y recibe el email de aviso al instante.

const { createClient } = require('@supabase/supabase-js');
const { notificarNuevoTurno } = require('./_lib/mochila');

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) };
  }
  const accessToken = authHeader.replace('Bearer ', '');

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) };
  }

  const { data: adulto, error: adultoError } = await supabaseAdmin
    .from('adultos')
    .select('socio_id')
    .eq('id', userData.user.id)
    .single();
  if (adultoError || !adulto) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No se encontró tu ficha de adulto' }) };
  }

  // Cliente "como el usuario": así el trigger de posición y las políticas
  // RLS se aplican exactamente igual que si insertara desde el navegador.
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + accessToken } }
  });

  const { data: nuevaEntrada, error: insertError } = await supabaseUser
    .from('mochila_cola')
    .insert({ tipo: 'socio', socio_id: adulto.socio_id })
    .select('id, posicion')
    .single();

  if (insertError) {
    const yaApuntado = insertError.code === '23505'; // violación de índice único (ya tenía una entrada)
    return {
      statusCode: 400,
      body: JSON.stringify({ error: yaApuntado ? 'Tu familia ya está en la lista de la Mochila.' : insertError.message })
    };
  }

  if (nuevaEntrada.posicion === 1) {
    await notificarNuevoTurno(supabaseAdmin, nuevaEntrada.id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, posicion: nuevaEntrada.posicion }) };
};
