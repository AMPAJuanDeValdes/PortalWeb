// El admin pulsa "Marcar como devuelta" cuando la familia que la tenía
// (posición 0) la trae de vuelta. Se archiva en mochila_historial (con
// snapshot de nombre y número de socio) y se borra de la cola activa.
// No mueve al resto de la cola ni envía ningún email: la posición 1
// sigue siendo la misma familia hasta que el admin la "entregue".
// La fecha de devolución es editable — por defecto hoy, pero el admin
// puede indicar otra si lo registra con retraso.

const { createClient } = require('@supabase/supabase-js');
const { clienteUsuario } = require('./_lib/clientes');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

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

  let payload = {};
  try { payload = event.body ? JSON.parse(event.body) : {}; }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const fechaDevolucion = String(payload.fechaDevolucion || '').trim() || hoyISO();

  let supabaseUser;
  try { supabaseUser = clienteUsuario(event, accessToken); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const { data: historialId, error: rpcError } = await supabaseUser
    .rpc('mochila_admin_devuelto', { p_fecha_devolucion: fechaDevolucion });
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, historialId }) };
};
