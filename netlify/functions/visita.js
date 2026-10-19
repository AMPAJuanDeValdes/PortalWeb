// Apunta una visita a una página (estadísticas propias, sin cookies).
// La llama shared/visitas.js al abrir cada página.
//   POST { pagina }  (con la sesión del socio si la hay)
// No se guarda ni la IP ni el navegador ni quién es: solo un código
// anónimo (ver supabase/pendientes/migracion-visitas.sql).

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ok = { statusCode: 204, body: '' };
const ROBOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|playwright|puppeteer/i;

// Secreto para los códigos: VISITAS_SECRETO, o si no existe, uno derivado de la clave de servicio
function secreto() {
  return process.env.VISITAS_SECRETO || crypto.createHash('sha256').update('visitas:' + (process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest('hex');
}
const codigo = (...partes) => crypto.createHmac('sha256', secreto()).update(partes.join('|')).digest('base64url').slice(0, 22);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const h = event.headers || {};
  const ua = String(h['user-agent'] || '');
  if (!ua || ROBOT.test(ua)) return ok;

  let p = {};
  try { p = JSON.parse(event.body || '{}'); } catch { return ok; }
  let pagina = String(p.pagina || '').split(/[?#]/)[0].split('/').pop() || 'index.html';
  if (!/^[a-z0-9-]+\.html$/i.test(pagina)) return ok;
  pagina = pagina.toLowerCase();

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const dia = hoyMadrid();
  let tipo = 'visitante', persona;
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const { data: u } = await sb.auth.getUser(token);
      if (u && u.user) {
        const { data: ad } = await sb.from('adultos').select('role, email').eq('id', u.user.id).maybeSingle();
        // Cuentas ficticias de las pruebas automáticas (pruebas/ayudantes/datos.js): no cuentan
        if (ad && /ampa-prueba-/i.test(ad.email || '')) return ok;
        if (ad) { tipo = ad.role === 'admin' ? 'junta' : 'socio'; persona = codigo('adulto', u.user.id); }
      }
    } catch (e) { /* sesión no válida: cuenta como visitante */ }
  }
  if (!persona) {
    const ip = String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
    persona = codigo('visitante', dia, ip, ua);
  }

  try {
    // La misma persona en la misma página en menos de 30 minutos: una sola visita
    const hace30 = new Date(Date.now() - 30 * 60e3).toISOString();
    const { count } = await sb.from('visitas').select('id', { count: 'exact', head: true })
      .eq('persona', persona).eq('pagina', pagina).gte('creado', hace30);
    if (!count) {
      await sb.from('visitas').insert({ dia, pagina, tipo, persona, movil: /Mobi|Android|iPhone|iPad/i.test(ua) });
      if (Math.random() < 0.01) await sb.rpc('visitas_limpiar');
    }
  } catch (e) { /* las estadísticas nunca rompen nada */ }
  return ok;
};
