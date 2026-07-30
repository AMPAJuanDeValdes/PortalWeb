// Envía un email a una lista de destinatarios usando BCC (un solo envío
// SMTP, evita problemas de límite de tiempo/volumen). Solo un admin puede
// ejecutarlo.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail } = require('./_lib/email');

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

  if (destinatarios.length === 0) return { statusCode: 400, body: JSON.stringify({ error: 'No hay destinatarios' }) };
  if (!asunto || !cuerpo) return { statusCode: 400, body: JSON.stringify({ error: 'Falta el asunto o el cuerpo del mensaje' }) };

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
