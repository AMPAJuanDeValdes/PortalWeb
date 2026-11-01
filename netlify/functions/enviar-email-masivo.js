// Envía un email a una lista de destinatarios usando BCC (un solo envío
// SMTP, evita problemas de límite de tiempo/volumen). Solo un admin puede
// ejecutarlo.
//   POST { destinatarios, asunto, cuerpo }          → lo envía
//   POST { vista: true, asunto, cuerpo }             → { asunto, html } tal como saldrá (con la firma), sin enviar
//   POST { prueba: true, asunto, cuerpo }            → lo envía solo a quien lo está escribiendo
//   POST { adultoId, asunto, cuerpo }                → a una sola persona (Socios → ficha), en «Para»
//   POST { mochilaColaId, asunto, cuerpo }           → a la familia de la Mochila (sus adultos, o el
//                                                      contacto si no es socia), en «Para»
//   Con adultoId o mochilaColaId, la vista previa devuelve también «para»

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, conFirma } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) };
  const accessToken = authHeader.replace('Bearer ', '');
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) };

  const { data: adminAdulto } = await supabaseAdmin.from('adultos').select('role').eq('id', userData.user.id).single();
  if (adminAdulto?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Solo un administrador puede enviar email masivo' }) };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const destinatarios = Array.isArray(payload.destinatarios) ? payload.destinatarios.filter(Boolean) : [];
  const asunto = String(payload.asunto || '').trim();
  const cuerpo = String(payload.cuerpo || '').trim();

  if (!asunto || !cuerpo) return { statusCode: 400, body: JSON.stringify({ error: 'Falta el asunto o el cuerpo del mensaje' }) };

  // Destinatarios concretos (adulto o familia de la Mochila): salen de la base de datos
  async function destinatariosConcretos() {
    if (payload.adultoId) {
      const { data: ad } = await supabaseAdmin.from('adultos').select('nombre, apellidos, email').eq('id', String(payload.adultoId)).maybeSingle();
      return ad && ad.email ? [{ nombre: `${ad.nombre} ${ad.apellidos}`, email: ad.email }] : [];
    }
    if (payload.mochilaColaId) {
      const { data: e } = await supabaseAdmin.from('mochila_cola').select('tipo, socio_id, nombre_contacto, email_contacto').eq('id', String(payload.mochilaColaId)).maybeSingle();
      if (!e) return [];
      if (e.tipo !== 'socio') return e.email_contacto ? [{ nombre: e.nombre_contacto || '', email: e.email_contacto }] : [];
      const { data: ads } = await supabaseAdmin.from('adultos').select('nombre, apellidos, email').eq('socio_id', e.socio_id).order('created_at');
      return (ads || []).filter(a => a.email).map(a => ({ nombre: `${a.nombre} ${a.apellidos}`, email: a.email }));
    }
    return null;
  }
  const concretos = await destinatariosConcretos();
  if (concretos && !concretos.length) return { statusCode: 404, body: JSON.stringify({ error: 'No tiene email.' }) };
  const paraTexto = (concretos || []).map(d => d.nombre ? `"${d.nombre.replace(/"/g, '')}" <${d.email}>` : d.email).join(', ');

  // Vista previa: el mismo email que se envía (firma y logo incluidos); el logo, desde la web
  if (payload.vista) {
    const m = conFirma({ subject: asunto, text: cuerpo });
    const web = (process.env.SITE_URL || '').replace(/\/$/, '');
    const html = m.html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, asunto: m.subject, html, para: concretos ? concretos.map(d => d.email).join(', ') : null }) };
  }
  // Prueba: solo a quien lo está escribiendo
  if (payload.prueba) {
    const email = userData.user.email;
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Tu cuenta no tiene email.' }) };
    try {
      await enviarEmail({ to: process.env.SMTP_USER, bcc: email, subject: '[PRUEBA] ' + asunto, text: cuerpo });
      return { statusCode: 200, body: JSON.stringify({ ok: true, enviados: 1, a: email }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error al enviar' }) };
    }
  }

  // A una persona o a una familia concreta, en «Para»
  if (concretos) {
    try {
      await enviarEmail({ to: paraTexto, subject: asunto, text: cuerpo });
      return { statusCode: 200, body: JSON.stringify({ ok: true, enviados: concretos.length, a: concretos.map(d => d.email).join(', ') }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error al enviar' }) };
    }
  }

  if (destinatarios.length === 0) return { statusCode: 400, body: JSON.stringify({ error: 'No hay destinatarios' }) };

  // Se envían en tandas de 80 (límite prudente para hosting compartido)
  const TAMANO_TANDA = 80;
  try {
    for (let i = 0; i < destinatarios.length; i += TAMANO_TANDA) {
      const tanda = destinatarios.slice(i, i + TAMANO_TANDA);
      await enviarEmail({
        to: process.env.SMTP_USER,
        bcc: tanda.join(','),
        subject: asunto,
        text: cuerpo
      });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, enviados: destinatarios.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error al enviar' }) };
  }
};
