// La Junta rechaza un justificante de pago no válido de una inscripción a un
// evento (personas no socias, apuntadas por una familia socia o desde la web
// pública): se anula la inscripción de esas personas (y sus actividades), se
// borra el archivo del justificante y se avisa por email a quien la hizo.
//   POST { comprobanteIds: [uuid, …], motivo }  (con la sesión de alguien de la Junta)
//   → { ok, anuladas, avisados: [emails], avisoError }

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaJustificanteRechazado } = require('./_lib/email');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const nombreDe = (i) => i.tipo_miembro === 'invitado'
  ? [i.nombre_invitado, i.apellidos_invitado].filter(Boolean).join(' ')
  : [i.alumno_nombre, i.alumno_apellidos].filter(Boolean).join(' ') || i.nombre_contacto || '';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Falta token de sesión' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede rechazar justificantes.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const ids = Array.isArray(p.comprobanteIds) ? p.comprobanteIds.map(String).slice(0, 100) : [];
  const motivo = String(p.motivo || '').trim().slice(0, 500);
  if (!ids.length) return json(400, { error: 'No se ha indicado ningún justificante.' });

  const { data: comps, error } = await sb.from('comprobantes_pago')
    .select('id, tipo, verificado, archivo_url, evento_inscripcion_id, evento_inscripciones(id, evento_id, tipo_miembro, socio_id, grupo_id, nombre_invitado, apellidos_invitado, alumno_nombre, alumno_apellidos, nombre_contacto, email_contacto, eventos(titulo))')
    .in('id', ids);
  if (error) return json(500, { error: error.message });
  if (!comps || comps.length !== ids.length) return json(404, { error: 'Algún justificante ya no existe. Recarga la página.' });
  if (comps.some(c => c.tipo !== 'invitado_evento')) return json(400, { error: 'Solo se pueden rechazar aquí justificantes de inscripciones a eventos.' });
  if (comps.some(c => c.verificado)) return json(400, { error: 'Ese justificante ya está verificado.' });

  const inscripciones = comps.map(c => c.evento_inscripciones).filter(Boolean);
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');

  // A quién se avisa: la persona de contacto (web pública) o los adultos de la familia socia
  const avisos = new Map();   // email → { nombre, evento, eventoId, personas, publico }
  const sociosIds = [...new Set(inscripciones.filter(i => i.socio_id).map(i => i.socio_id))];
  const { data: adultos } = sociosIds.length
    ? await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', sociosIds).order('created_at')
    : { data: [] };
  for (const i of inscripciones) {
    const destinos = i.socio_id
      ? (adultos || []).filter(a => a.socio_id === i.socio_id && a.email).map(a => ({ email: a.email, nombre: a.nombre }))
      : (i.email_contacto ? [{ email: i.email_contacto, nombre: i.nombre_contacto }] : []);
    for (const d of destinos) {
      const clave = d.email.trim().toLowerCase() + '|' + i.evento_id;
      if (!avisos.has(clave)) avisos.set(clave, { email: d.email.trim(), nombre: d.nombre || '', evento: i.eventos?.titulo || 'el evento', eventoId: i.evento_id, personas: [], publico: !i.socio_id });
      const n = nombreDe(i);
      if (n && !avisos.get(clave).personas.includes(n)) avisos.get(clave).personas.push(n);
    }
  }

  // Anular las inscripciones (el justificante se borra con ellas) y el archivo
  const insIds = inscripciones.map(i => i.id);
  const { error: delErr } = await sb.from('evento_inscripciones').delete().in('id', insIds);
  if (delErr) return json(500, { error: 'No se pudo anular la inscripción: ' + delErr.message });
  // Web pública: todo lo que se apuntó en esa misma inscripción (actividades incluidas)
  const grupos = [...new Set(inscripciones.filter(i => i.tipo_miembro === 'publico' && i.grupo_id).map(i => i.grupo_id))];
  if (grupos.length) await sb.from('evento_inscripciones').delete().in('grupo_id', grupos);
  const archivos = [...new Set(comps.map(c => c.archivo_url).filter(Boolean))];
  if (archivos.length) {
    const { data: siguen } = await sb.from('comprobantes_pago').select('archivo_url').in('archivo_url', archivos);
    const libres = archivos.filter(a => !(siguen || []).some(s => s.archivo_url === a));
    if (libres.length) await sb.storage.from('comprobantes').remove(libres);
  }

  const avisados = []; let avisoError = null;
  for (const a of avisos.values()) {
    try {
      const pl = plantillaJustificanteRechazado({
        nombre: a.nombre, evento: a.evento, personas: a.personas, motivo,
        urlEvento: web ? `${web}/${a.publico ? 'publico' : 'eventos'}.html#ev-${a.eventoId}` : ''
      });
      await enviarEmail({ to: a.email, subject: pl.subject, text: pl.text });
      avisados.push(a.email);
    } catch (e) {
      avisoError = 'No se pudo enviar el email a ' + a.email + ': ' + (e.message || e);
    }
  }
  return json(200, { ok: true, anuladas: insIds.length, avisados, avisoError });
};
