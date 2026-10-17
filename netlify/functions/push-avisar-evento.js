// La Junta avisa de una actividad a las familias (notificación push en el
// móvil o el ordenador de los adultos que han activado los avisos).
// Solo a familias socias activas con algún alumno/a que puede apuntarse por
// curso o edad (o a todas, si la actividad es para toda la familia o para
// adultos).
//   POST { eventoId, soloContar }  (con la sesión de un admin)
//   soloContar → { familias, dispositivos } sin enviar nada
//   si no      → envía y devuelve { familias, dispositivos, enviados, fallidos }

const { createClient } = require('@supabase/supabase-js');
const { enviarPush, clavesEntorno } = require('./_lib/webpush');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });

function edadEn(fechaNacimiento, fechaRef) {
  if (!fechaNacimiento) return null;
  const ref = fechaRef ? new Date(fechaRef) : new Date();
  const n = new Date(fechaNacimiento + 'T12:00:00');
  let e = ref.getFullYear() - n.getFullYear();
  if (ref.getMonth() < n.getMonth() || (ref.getMonth() === n.getMonth() && ref.getDate() < n.getDate())) e--;
  return e;
}

// Las mismas reglas que eventos.html (miembrosElegiblesEvento)
function alumnoPuede(ev, al) {
  if (ev.elegibilidad_modo === 'edad') {
    const e = edadEn(al.fecha_nacimiento, ev.fecha);
    return e !== null && (ev.edad_min == null || e >= ev.edad_min) && (ev.edad_max == null || e <= ev.edad_max);
  }
  if (ev.tipo_elegibilidad === 'toda_familia') return true;
  const cursos = Array.isArray(ev.cursos_permitidos) ? ev.cursos_permitidos : [];
  return cursos.some(c => c.etapa === al.etapa && c.curso === al.curso);
}

const listaNombres = (n) => n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || '';

function mensajeDe(ev, nombres) {
  const apertura = ev.fecha_apertura_socios && new Date(ev.fecha_apertura_socios) > new Date()
    ? new Date(ev.fecha_apertura_socios).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;
  let body;
  if (ev.sin_inscripcion || ev.usa_concurso_texto) body = 'Mira los detalles en la web del AMPA.';
  else if (nombres.length) body = `${listaNombres(nombres)} ${nombres.length > 1 ? 'pueden' : 'puede'} apuntarse.`;
  else body = 'Ya podéis apuntaros en la web del AMPA.';
  if (apertura && !ev.sin_inscripcion) body += ` La inscripción se abre el ${apertura}.`;
  return { title: 'Nueva actividad: ' + ev.titulo, body, url: '/eventos.html#ev-' + ev.id, tag: 'evento-' + ev.id };
}

async function todas(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) return filas;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return json(401, { error: 'Falta token de sesión' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede avisar a las familias.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const { data: ev } = await sb.from('eventos').select('*').eq('id', String(p.eventoId || '')).single();
  if (!ev) return json(404, { error: 'El evento no existe.' });
  if (!ev.activo) return json(400, { error: 'El evento no está publicado: actívalo antes de avisar.' });

  try {
    const socios = await todas(() => sb.from('socios').select('id').eq('estado', 'activa'));
    const activos = new Set(socios.map(s => s.id));
    const alumnos = (await todas(() => sb.from('alumnos').select('socio_id, nombre, etapa, curso, fecha_nacimiento')))
      .filter(a => activos.has(a.socio_id));

    // Familia → nombres de sus alumnos/as que pueden apuntarse
    const familias = new Map();
    if (ev.tipo_elegibilidad === 'adultos' || ev.sin_inscripcion || (ev.tipo_elegibilidad === 'toda_familia' && ev.elegibilidad_modo !== 'edad')) {
      socios.forEach(s => familias.set(s.id, []));
      if (ev.tipo_elegibilidad === 'toda_familia') alumnos.forEach(a => familias.get(a.socio_id)?.push(a.nombre));
    } else {
      alumnos.filter(a => alumnoPuede(ev, a)).forEach(a => {
        if (!familias.has(a.socio_id)) familias.set(a.socio_id, []);
        familias.get(a.socio_id).push(a.nombre);
      });
    }

    const subs = (await todas(() => sb.from('push_suscripciones').select('endpoint, p256dh, auth, socio_id')))
      .filter(s => familias.has(s.socio_id));
    const familiasConAviso = new Set(subs.map(s => s.socio_id)).size;
    const base = { familias: familias.size, familiasConAviso, dispositivos: subs.length };
    if (p.soloContar) return json(200, base);

    const claves = clavesEntorno();
    if (!claves) return json(500, { error: 'Faltan las claves de los avisos (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY) en Netlify. Mira el README.' });

    let enviados = 0, fallidos = 0;
    const caducadas = [];
    // De 20 en 20 para no pasarse del tiempo de la función
    for (let i = 0; i < subs.length; i += 20) {
      await Promise.all(subs.slice(i, i + 20).map(async (s) => {
        try {
          const r = await enviarPush(s, mensajeDe(ev, familias.get(s.socio_id) || []), claves);
          if (r.ok) enviados++; else { fallidos++; if (r.caducada) caducadas.push(s.endpoint); }
        } catch (e) { fallidos++; }
      }));
    }
    // Dispositivos que ya no existen (desinstalada la web, permisos quitados...)
    if (caducadas.length) await sb.from('push_suscripciones').delete().in('endpoint', caducadas);
    await sb.from('eventos').update({ aviso_push_en: new Date().toISOString(), aviso_push_familias: familiasConAviso }).eq('id', ev.id);
    return json(200, { ...base, enviados, fallidos, caducadas: caducadas.length });
  } catch (e) {
    return json(500, { error: e.message || 'No se pudo avisar.' });
  }
};

module.exports.alumnoPuede = alumnoPuede;
module.exports.mensajeDe = mensajeDe;
