// Envío de avisos en el móvil a familias (lo usan push-avisar-evento.js y
// push-avisar-convocatoria.js).
//   familias: Map socio_id → mensaje ({ title, body, url, tag })
//   → { familias, familiasConAviso, dispositivos } y, si se envía, { enviados, fallidos, caducadas }

const { enviarPush, clavesEntorno } = require('./webpush');

// Todas las filas de una consulta, de 1000 en 1000
async function todas(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) return filas;
  }
}

// Familias socias activas y sus alumnos/as
async function familiasActivas(sb) {
  const socios = await todas(() => sb.from('socios').select('id').eq('estado', 'activa'));
  const activos = new Set(socios.map(s => s.id));
  const alumnos = (await todas(() => sb.from('alumnos').select('socio_id, nombre, etapa, curso, fecha_nacimiento')))
    .filter(a => activos.has(a.socio_id));
  return { socios, alumnos };
}

async function avisarFamilias(sb, familias, { soloContar } = {}) {
  const subs = (await todas(() => sb.from('push_suscripciones').select('endpoint, p256dh, auth, socio_id')))
    .filter(s => familias.has(s.socio_id));
  const base = { familias: familias.size, familiasConAviso: new Set(subs.map(s => s.socio_id)).size, dispositivos: subs.length };
  if (soloContar) return base;

  const claves = clavesEntorno();
  if (!claves) { const e = new Error('Faltan las claves de los avisos (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY) en Netlify. Mira el README.'); e.status = 500; throw e; }
  let enviados = 0, fallidos = 0;
  const caducadas = [];
  // De 20 en 20 para no pasarse del tiempo de la función
  for (let i = 0; i < subs.length; i += 20) {
    await Promise.all(subs.slice(i, i + 20).map(async (s) => {
      try {
        const r = await enviarPush(s, familias.get(s.socio_id), claves);
        if (r.ok) enviados++; else { fallidos++; if (r.caducada) caducadas.push(s.endpoint); }
      } catch (e) { fallidos++; }
    }));
  }
  // Dispositivos que ya no existen (desinstalada la web, permisos quitados...)
  if (caducadas.length) await sb.from('push_suscripciones').delete().in('endpoint', caducadas);
  return { ...base, enviados, fallidos, caducadas: caducadas.length };
}

// Solo alguien de la Junta: devuelve el cliente con la clave de servicio o una respuesta de error
async function comoJunta(event, createClient) {
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) } };
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) return { error: { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) } };
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return { error: { statusCode: 403, body: JSON.stringify({ error: 'Solo la Junta puede hacer esto.' }) } };
  return { sb, adultoId: u.user.id };
}

// Apunta un aviso o una circular en el historial (tabla difusiones). Nunca
// rompe lo que ya se ha hecho: si falla, se ignora.
async function registrarDifusion(sb, { tipo, refId, canal, familias = null, adultoId }) {
  try {
    let nombre = null;
    if (adultoId) {
      const { data } = await sb.from('adultos').select('nombre, apellidos').eq('id', adultoId).maybeSingle();
      if (data) nombre = `${data.nombre} ${data.apellidos || ''}`.trim();
    }
    await sb.from('difusiones').insert({ tipo, ref_id: refId, canal, familias, creado_por_nombre: nombre });
  } catch (e) { /* el historial no es imprescindible */ }
}

module.exports = { todas, familiasActivas, avisarFamilias, comoJunta, registrarDifusion };
