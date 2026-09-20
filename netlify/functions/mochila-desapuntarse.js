// El propio socio se desapunta de la cola ("Desapuntarme de la Mochila").
// Igual que en posponer, el id de la entrada se busca aquí a partir de
// la sesión, nunca se recibe del cliente.
// Si tiene la mochila en este momento (posición 0), la base de datos
// rechaza la acción: hay que devolverla vía el admin, no desapuntarse.

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

  const { data: adulto } = await supabaseAdmin
    .from('adultos').select('socio_id').eq('id', userData.user.id).single();
  if (!adulto) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No se encontró tu ficha de adulto' }) };
  }

  const { data: propia } = await supabaseAdmin
    .from('mochila_cola').select('id').eq('socio_id', adulto.socio_id).single();
  if (!propia) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No estás en la lista de la Mochila' }) };
  }

  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + accessToken } }
  });

  const { data: nuevoP1Id, error: rpcError } = await supabaseUser
    .rpc('mochila_salir', { p_id: propia.id });
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  if (nuevoP1Id) {
    await notificarNuevoTurno(supabaseAdmin, nuevoP1Id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
