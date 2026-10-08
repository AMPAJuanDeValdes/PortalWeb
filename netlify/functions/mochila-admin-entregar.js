// El admin pulsa "Entregado" el viernes, al dar la mochila a la familia
// que estaba en posición 1. Esa familia pasa a posición 0 (la tiene
// ahora), el resto de la cola sube un puesto, y se avisa por email a
// quien pasa a ocupar la nueva posición 1.

const { createClient } = require('@supabase/supabase-js');
const { notificarNuevoTurno } = require('./_lib/mochila');
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

  const fecha = String(payload.fecha || '').trim() || hoyISO();

  let supabaseUser;
  try { supabaseUser = clienteUsuario(event, accessToken); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const { data: nuevoP1Id, error: rpcError } = await supabaseUser
    .rpc('mochila_admin_entregar', { p_fecha: fecha });
  if (rpcError) {
    return { statusCode: 400, body: JSON.stringify({ error: rpcError.message }) };
  }

  if (nuevoP1Id) {
    await notificarNuevoTurno(supabaseAdmin, nuevoP1Id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
