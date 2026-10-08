// El admin pulsa "Pasar una semana" cuando la familia en posición 1
// contesta que no puede recibir la mochila esta semana. Hace lo mismo
// que el botón del socio "Prefiero esperar una semana más", pero
// operando siempre sobre quien esté ahora mismo en la posición 1 (no
// hace falta indicar ningún id).

const { createClient } = require('@supabase/supabase-js');
const { notificarNuevoTurno } = require('./_lib/mochila');
const { clienteUsuario } = require('./_lib/clientes');

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

  // Cliente "como el usuario": mochila_admin_pasar_semana() vuelve a
  // comprobar is_admin() por su cuenta vía auth.uid(), esta comprobación
  // de arriba es solo para dar un error más rápido y amable.
  let supabaseUser;
  try { supabaseUser = clienteUsuario(event, accessToken); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const { data: nuevoP1Id, error: rpcError } = await supabaseUser
    .rpc('mochila_admin_pasar_semana');
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  if (nuevoP1Id) {
    await notificarNuevoTurno(supabaseAdmin, nuevoP1Id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
