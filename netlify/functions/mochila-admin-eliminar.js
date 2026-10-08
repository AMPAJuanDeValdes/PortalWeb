// El admin elimina de la lista a una familia que no ha contestado en 24
// horas (o por cualquier otro motivo). A diferencia de "Desapuntarme",
// aquí sí se recibe el id desde el panel de admin, porque el admin
// puede actuar sobre CUALQUIER entrada, no solo la suya.
// No se puede eliminar así a quien tiene la mochila en este momento
// (posición 0) — eso se gestiona con "Marcar como devuelta".

const { createClient } = require('@supabase/supabase-js');
const { clienteUsuario } = require('./_lib/clientes');
const { notificarNuevoTurno } = require('./_lib/mochila');

const SUPABASE_URL = process.env.SUPABASE_URL;
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
    .from('adultos').select('role').eq('id', userData.user.id).single();
  if (!adulto || adulto.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo un admin puede hacer esto' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const id = String(payload.id || '').trim();
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el id de la entrada a eliminar' }) };
  }

  let supabaseUser;
  try { supabaseUser = clienteUsuario(event, accessToken); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const { data: nuevoP1Id, error: rpcError } = await supabaseUser
    .rpc('mochila_salir', { p_id: id });
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  if (nuevoP1Id) {
    await notificarNuevoTurno(supabaseAdmin, nuevoP1Id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
