// El propio socio pospone su turno una posición ("Prefiero esperar una
// semana más"). Solo puede afectar a SU PROPIA entrada — el id no se
// recibe del cliente, se busca aquí mismo a partir de su sesión, para
// no tener que confiar en lo que mande el navegador.
// Si eso libera la posición 1, se notifica por email a quien pasa a
// ocuparla.

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

  // Cliente "como el usuario": mochila_posponer() comprueba internamente
  // que el que llama es el dueño de la entrada (o admin), vía auth.uid().
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + accessToken } }
  });

  const { data: nuevoP1Id, error: rpcError } = await supabaseUser
    .rpc('mochila_posponer', { p_id: propia.id });
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  if (nuevoP1Id) {
    await notificarNuevoTurno(supabaseAdmin, nuevoP1Id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
