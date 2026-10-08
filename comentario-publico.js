// Formulario de contacto de la web pública. No requiere sesión — cualquiera
// puede escribir. Guarda copia en la tabla `comentarios` y envía un email
// al buzón del AMPA con Reply-To puesto al email que la persona escribió,
// para poder contestarle directamente.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaComentario } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function esEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const nombre = String(payload.nombre || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const mensaje = String(payload.mensaje || '').trim();

  if (!email || !esEmailValido(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Escribe un email válido.' }) };
  }
  if (!mensaje) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Escribe un mensaje.' }) };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: insertError } = await supabaseAdmin.from('comentarios').insert({
    origen: 'publico',
    nombre_contacto: nombre || null,
    email_contacto: email,
    mensaje
  });
  if (insertError) {
    return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };
  }

  try {
    const { subject, text } = plantillaComentario({ origen: 'publico', nombre, mensaje });
    await enviarEmail({ to: process.env.SMTP_USER, replyTo: email, subject, text });
  } catch (err) {
    // El comentario ya quedó guardado en la base de datos aunque falle el email.
    return { statusCode: 200, body: JSON.stringify({ ok: true, avisoEmail: 'Guardado, pero no se pudo enviar el email de aviso.' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
