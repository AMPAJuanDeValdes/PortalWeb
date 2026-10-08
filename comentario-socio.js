// Formulario de contacto para un socio ya logueado: no pide email, se
// usa la sesión para saber quién escribe. Si la familia tiene 2 adultos,
// ambos quedan en el Reply-To, así que "Responder" desde la cuenta del
// AMPA les contesta a los dos a la vez.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaComentario } = require('./_lib/email');

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

  const { data: adultoActual } = await supabaseAdmin
    .from('adultos').select('socio_id, nombre, apellidos').eq('id', userData.user.id).single();
  if (!adultoActual) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No se encontró tu ficha de adulto' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const mensaje = String(payload.mensaje || '').trim();
  if (!mensaje) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Escribe un mensaje.' }) };
  }

  const { data: adultosFamilia } = await supabaseAdmin
    .from('adultos').select('email').eq('socio_id', adultoActual.socio_id);
  const emailsFamilia = (adultosFamilia || []).map(a => a.email).filter(Boolean);
  const nombre = `${adultoActual.nombre} ${adultoActual.apellidos}`;

  const { error: insertError } = await supabaseAdmin.from('comentarios').insert({
    origen: 'socio',
    socio_id: adultoActual.socio_id,
    nombre_contacto: nombre,
    email_contacto: emailsFamilia[0] || null,
    mensaje
  });
  if (insertError) {
    return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
  }

  try {
    const { subject, text } = plantillaComentario({ origen: 'socio', nombre, mensaje });
    await enviarEmail({ to: process.env.SMTP_USER, replyTo: emailsFamilia.join(', '), subject, text });
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, avisoEmail: 'Guardado, pero no se pudo enviar el email de aviso.' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
