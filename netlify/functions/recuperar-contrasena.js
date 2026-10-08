// "¿Has olvidado tu contraseña?" de login.html.
//
// Sustituye a la llamada directa sb.auth.resetPasswordForEmail() que
// hacía el navegador, que tenía tres problemas:
//   1. Mandaba el enlace a CUALQUIER email (también a cuentas dadas de
//      baja: la persona cambiaba la contraseña y entraba a un Inicio vacío).
//   2. Se podía pulsar infinitas veces (un correo por pulsación).
//   3. Dependía de configurar el SMTP y la plantilla dentro de Supabase.
//
// Ahora: solo se envía si el email pertenece a una cuenta ACTIVA, como
// mucho una vez cada 15 minutos por email, y el correo sale de nuestro
// propio buzón (variables SMTP_* de Netlify) con nuestra plantilla.
// El enlace se genera con auth.admin.generateLink (de un solo uso).

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaRecuperarPassword } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MINUTOS_ENTRE_PETICIONES = 15;

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return json(400, { error: 'JSON no válido' }); }
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json(400, { error: 'Escribe un email válido.' });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data } = await supabaseAdmin
    .from('adultos')
    .select('id, socios(estado)')
    .ilike('email', email)
    .limit(1);
  const estado = data && data[0] && data[0].socios ? data[0].socios.estado : null;

  // Mismo mensaje si el email no existe o la cuenta no está activa, para
  // no revelar qué emails están registrados.
  if (estado !== 'activa') {
    return json(403, {
      codigo: 'no_activa',
      error: 'No hay ninguna cuenta activa con este email. Solo las cuentas activas pueden recuperar la contraseña.'
    });
  }

  // Límite: una petición cada 15 minutos por email
  const desde = new Date(Date.now() - MINUTOS_ENTRE_PETICIONES * 60000).toISOString();
  const { data: recientes } = await supabaseAdmin
    .from('recuperaciones_password')
    .select('created_at')
    .ilike('email', email)
    .gte('created_at', desde)
    .limit(1);
  if (recientes && recientes.length) {
    return json(429, {
      codigo: 'demasiado_pronto',
      error: `Ya te enviamos un correo hace menos de ${MINUTOS_ENTRE_PETICIONES} minutos. Revisa tu bandeja de entrada y la carpeta de spam. Si no ha llegado, podrás pedir otro pasado ese tiempo.`
    });
  }

  const origen = (process.env.SITE_URL || event.headers.origin || '').replace(/\/$/, '');
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: origen + '/cambiar-clave.html' }
  });
  if (linkError || !link?.properties?.action_link) {
    return json(500, { error: 'No se pudo generar el enlace de recuperación. Inténtalo más tarde.' });
  }

  const { subject, text, html } = plantillaRecuperarPassword({ enlace: link.properties.action_link });
  try {
    await enviarEmail({ to: email, subject, text, html });
  } catch (e) {
    return json(500, { error: 'No se pudo enviar el correo. Inténtalo más tarde.' });
  }

  await supabaseAdmin.from('recuperaciones_password').insert({ email });
  return json(200, { ok: true });
};
