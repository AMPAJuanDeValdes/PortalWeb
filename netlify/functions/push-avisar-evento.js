// La Junta avisa de una actividad a las familias (notificación push en el
// móvil o el ordenador de los adultos que han activado los avisos).
// Solo a familias socias activas con algún alumno/a que puede apuntarse por
// curso o edad (o a todas, si la actividad es para toda la familia o para
// adultos).
//   POST { eventoId, soloContar }  (con la sesión de un admin)
//   soloContar → { familias, dispositivos } sin enviar nada
//   si no      → envía y devuelve { familias, dispositivos, enviados, fallidos }

const { createClient } = require('@supabase/supabase-js');
const { familiasActivas, avisarFamilias, registrarDifusion } = require('./_lib/avisos');

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
    const { socios, alumnos } = await familiasActivas(sb);
    // Familia → nombres de sus alumnos/as que pueden apuntarse
    const nombres = new Map();
    if (ev.tipo_elegibilidad === 'adultos' || ev.sin_inscripcion || (ev.tipo_elegibilidad === 'toda_familia' && ev.elegibilidad_modo !== 'edad')) {
      socios.forEach(s => nombres.set(s.id, []));
      if (ev.tipo_elegibilidad === 'toda_familia') alumnos.forEach(a => nombres.get(a.socio_id)?.push(a.nombre));
    } else {
      alumnos.filter(a => alumnoPuede(ev, a)).forEach(a => {
        if (!nombres.has(a.socio_id)) nombres.set(a.socio_id, []);
        nombres.get(a.socio_id).push(a.nombre);
      });
    }
    const familias = new Map([...nombres].map(([id, n]) => [id, mensajeDe(ev, n)]));
    const r = await avisarFamilias(sb, familias, { soloContar: !!p.soloContar });
    if (!p.soloContar) {
      await sb.from('eventos').update({ aviso_push_en: new Date().toISOString(), aviso_push_familias: r.familiasConAviso }).eq('id', ev.id);
      await registrarDifusion(sb, { tipo: 'evento', refId: ev.id, canal: 'aviso', familias: r.familiasConAviso, adultoId: u.user.id });
    }
    return json(200, r);
  } catch (e) {
    return json(e.status || 500, { error: e.message || 'No se pudo avisar.' });
  }
};

module.exports.alumnoPuede = alumnoPuede;
module.exports.mensajeDe = mensajeDe;
