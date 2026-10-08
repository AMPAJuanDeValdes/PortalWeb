// Utilidad compartida de la Mochila Jugona Exploradora: cuando una familia recibe el
// turno (la Junta pulsa «Entregar mochila», otra familia pasa su turno,
// se desapunta o caduca a las 24 h), se le avisa por email para que
// entre en la web a aceptarla.
//
// Recibe SIEMPRE el cliente de Supabase con la SERVICE ROLE KEY, porque
// para socios necesita leer el email de OTRA familia (la que pasa a ser
// la nueva posición 1), algo que las políticas RLS no permiten al socio
// que disparó la acción.

const { enviarEmail, plantillaMochilaTurno } = require('./email');

async function notificarNuevoTurno(supabaseAdmin, nuevoP1Id) {
  if (!nuevoP1Id) return;

  const { data: entrada, error } = await supabaseAdmin
    .from('mochila_cola')
    .select('tipo, socio_id, nombre_contacto, email_contacto')
    .eq('id', nuevoP1Id)
    .single();
  if (error || !entrada) return;

  let nombre, email;
  if (entrada.tipo === 'socio') {
    const { data: adulto } = await supabaseAdmin
      .from('adultos')
      .select('nombre, email')
      .eq('socio_id', entrada.socio_id)
      .order('created_at')
      .limit(1)
      .single();
    if (!adulto) return;
    nombre = adulto.nombre;
    email = adulto.email;
  } else {
    nombre = entrada.nombre_contacto;
    email = entrada.email_contacto;
  }

  const { subject, text } = plantillaMochilaTurno({ nombre });
  // Si el correo falla, la acción sobre la cola YA se ha hecho: no debe
  // devolver error al usuario (antes, un fallo de SMTP hacía que
  // "Apuntarme" mostrara error aunque sí se hubiera apuntado).
  try {
    await enviarEmail({ to: email, subject, text });
  } catch (e) {
    console.error('No se pudo enviar el aviso de la Mochila:', e.message);
  }
}

const { clienteUsuario } = require('./clientes');
const { createClient } = require('@supabase/supabase-js');

// Llama a una función SQL de la Mochila "como el usuario" (las funciones
// comprueban dentro quién es: la familia o la Junta) y, si devuelve el id
// de una familia que acaba de recibir el turno, le manda el email.
async function accionMochila(event, rpc, { soloAdmin = false } = {}) {
  const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return json(401, { error: 'Falta token de sesión' });
  const accessToken = authHeader.replace('Bearer ', '');
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return json(401, { error: 'Sesión no válida' });
  if (soloAdmin) {
    const { data: quien } = await supabaseAdmin.from('adultos').select('role').eq('id', userData.user.id).single();
    if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede hacer esto' });
  }
  let supabaseUser;
  try { supabaseUser = clienteUsuario(event, accessToken); }
  catch (e) { return json(500, { error: e.message }); }
  const { data: idAviso, error } = await supabaseUser.rpc(rpc);
  if (error) return json(400, { error: error.message });
  if (idAviso) await notificarNuevoTurno(supabaseAdmin, idAviso);
  return json(200, { ok: true, avisada: !!idAviso });
}

module.exports = { notificarNuevoTurno, accionMochila };
