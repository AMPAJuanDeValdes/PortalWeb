// Página de la Cabalgata (cabalgata.html): la familia dice si va o no.
//   POST { eventoId, grupo, va }        → una pareja (alumno/a + adulto)
//   POST { eventoId, postulacion, va }  → un puesto (Responsable, Rey, Paje)
// Si dice que no, pierde la plaza y entra el primer suplente (con email y
// aviso al móvil). Con la clave de servicio, porque cambia la plaza de otra familia.

const { createClient } = require('@supabase/supabase-js');
const { cargar, alumnosDe, renunciarPareja, renunciarPuesto, promover, avisarPromovidos } = require('./_lib/cabalgata');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Falta token de sesión' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: yo } = await sb.from('adultos').select('socio_id').eq('id', u.user.id).maybeSingle();
  if (!yo || !yo.socio_id) return json(403, { error: 'No se encuentra tu familia.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const va = p.va === true;
  try {
    const { ev, grupos, posts } = await cargar(sb, String(p.eventoId || ''));
    if (!ev.gestion_confirmar_hasta) return json(400, { error: 'Todavía no se puede confirmar.' });
    const ahora = Date.now();
    const vencido = (x) => new Date(x.confirmar_hasta || ev.gestion_confirmar_hasta).getTime() < ahora;

    if (p.grupo) {
      const filas = grupos.get(String(p.grupo));
      if (!filas || filas[0].socio_id !== yo.socio_id) return json(403, { error: 'Esa inscripción no es de tu familia.' });
      const al = alumnosDe(filas);
      if (!al.length || al.some(f => f.estado !== 'ganador')) return json(400, { error: 'Esta pareja no tiene plaza.' });
      if (va) {
        if (!al[0].asistencia && vencido(al[0])) return json(400, { error: 'El plazo para confirmar ya ha terminado.' });
        const { error } = await sb.from('evento_inscripciones').update({ asistencia: 'si', asistencia_en: new Date().toISOString() }).in('id', filas.map(f => f.id));
        if (error) throw error;
      } else {
        await renunciarPareja(sb, ev.id, filas, 'no');
      }
    } else if (p.postulacion) {
      const post = posts.find(x => x.id === String(p.postulacion));
      if (!post || post.socio_id !== yo.socio_id) return json(403, { error: 'Ese puesto no es de tu familia.' });
      if (post.estado !== 'elegido') return json(400, { error: 'Este puesto no lo tenéis.' });
      if (va) {
        if (!post.asistencia && vencido(post)) return json(400, { error: 'El plazo para confirmar ya ha terminado.' });
        const { error } = await sb.from('evento_postulaciones').update({ asistencia: 'si', asistencia_en: new Date().toISOString() }).eq('id', post.id);
        if (error) throw error;
      } else {
        await renunciarPuesto(sb, ev.id, post, 'no');
      }
    } else {
      return json(400, { error: 'Falta qué confirmar.' });
    }
    // Su plaza pasa al primer suplente; a él no le puede volver a tocar en este momento
    if (!va) await avisarPromovidos(sb, ev, await promover(sb, ev.id, new Set([String(p.grupo || p.postulacion)])));
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
