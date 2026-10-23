// Después de «Recibir mochila» (Panel → Mochila): manda a la familia que la
// acaba de devolver el enlace a la encuesta sobre los juegos
// (mochila-encuesta.html?t=<token>, ver migracion-mochila-encuesta.sql).
//   POST { historialId }  (con la sesión de alguien de la Junta)
//   → { ok, enviada, a: [emails] }

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaMochilaEncuesta } = require('./_lib/email');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Falta token de sesión' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede hacer esto.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const { data: enc } = await sb.from('mochila_encuestas').select('*').eq('historial_id', String(p.historialId || '')).maybeSingle();
  if (!enc) return json(404, { error: 'No hay encuesta para esa devolución.' });
  if (enc.enviada_en) return json(200, { ok: true, enviada: false, yaEnviada: true });

  let destinos = [];
  if (enc.socio_id) {
    const { data: ad } = await sb.from('adultos').select('nombre, email').eq('socio_id', enc.socio_id).order('created_at');
    destinos = (ad || []).filter(a => a.email).map(a => ({ email: a.email, nombre: a.nombre }));
  } else if (enc.email_contacto) {
    destinos = [{ email: enc.email_contacto, nombre: enc.nombre_familia }];
  }
  if (!destinos.length) return json(200, { ok: true, enviada: false, error: 'La familia no tiene email.' });

  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const url = `${web}/mochila-encuesta.html?t=${enc.token}`;
  try {
    const pl = plantillaMochilaEncuesta({ nombre: destinos.length === 1 ? destinos[0].nombre : '', url });
    await enviarEmail({ to: destinos.map(d => d.email).join(', '), subject: pl.subject, text: pl.text });
  } catch (e) {
    return json(200, { ok: true, enviada: false, error: 'No se pudo enviar el email: ' + (e.message || e) });
  }
  await sb.from('mochila_encuestas').update({ enviada_en: new Date().toISOString() }).eq('id', enc.id);
  return json(200, { ok: true, enviada: true, a: destinos.map(d => d.email) });
};
