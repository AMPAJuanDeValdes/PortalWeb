// Panel → Eventos → Sesiones (curso de Warhammer): avisa por email a los
// inscritos de las fechas que se acaban de poner o cambiar.
//   POST { eventoId, sesiones: [id], vista: true } → { ok, vista: [{ familia, a, asunto, html }] } (no envía nada)
//   POST { eventoId, sesiones: [id], envioId, inicio } → envía por tandas (Netlify corta a los 10 s);
//        la pantalla llama con inicio = 0, TANDA, 2·TANDA… hasta que «siguiente» es null.
//        Cada familia socia enviada queda en avisos_enviados (envioId): repetir una tanda no la vuelve a enviar.
//        → { ok, total, siguiente, enviados, fallos: [emails] }

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, conFirma } = require('./_lib/email');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const ZONA = { timeZone: 'Europe/Madrid' };
const TANDA = 2;
const fechaLarga = (f) => {
  const d = new Date(f);
  return d.toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' }) +
    ' a las ' + d.toLocaleTimeString('es-ES', { ...ZONA, hour: '2-digit', minute: '2-digit' });
};

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
  const { data: ev } = await sb.from('eventos').select('*').eq('id', String(p.eventoId || '')).maybeSingle();
  if (!ev) return json(404, { error: 'El evento no existe.' });
  const ids = Array.isArray(p.sesiones) ? p.sesiones.map(String) : [];
  if (!ids.length) return json(400, { error: 'Elige al menos una sesión.' });
  const { data: sesiones } = await sb.from('evento_sesiones').select('id, numero, titulo, contenido, fecha').eq('evento_id', ev.id).in('id', ids).order('numero');
  const conFecha = (sesiones || []).filter(s => s.fecha);
  if (!conFecha.length) return json(400, { error: 'Esas sesiones no tienen fecha.' });

  // Inscritos: los que no se han quedado fuera
  const { data: ins, error } = await sb.from('evento_inscripciones')
    .select('socio_id, nombre_contacto, email_contacto, estado, actividad_id, es_voluntario')
    .eq('evento_id', ev.id);
  if (error) return json(500, { error: error.message });
  const validas = (ins || []).filter(i => !i.actividad_id && !i.es_voluntario && i.estado !== 'no_ganador');
  let socios = [...new Set(validas.filter(i => i.socio_id).map(i => i.socio_id))];
  // Evento de prueba: solo a las familias que están probando
  if (ev.solo_pruebas) {
    const { data: prueba } = await sb.from('adultos').select('socio_id').ilike('email', '%ampa-prueba-%');
    const { data: reales } = await sb.from('pruebas_familias').select('socio_id');
    const ok = new Set([...(prueba || []), ...(reales || [])].map(a => a.socio_id));
    socios = socios.filter(s => ok.has(s));
  }
  socios.sort();
  const { data: adultos } = socios.length
    ? await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at')
    : { data: [] };

  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const url = `${web}/eventos.html#ev-${ev.id}`;
  const lista = conFecha.map(s => `Sesión ${s.numero}: ${s.titulo}\nFecha: ${fechaLarga(s.fecha)}` + (s.contenido ? `\n\n${s.contenido}` : '')).join('\n\n');
  const asunto = conFecha.length === 1
    ? `${ev.titulo}: sesión ${conFecha[0].numero}, ${fechaLarga(conFecha[0].fecha)}`
    : `${ev.titulo}: fechas de las sesiones`;
  const texto = (nombre) => `Hola${nombre ? ' ' + nombre : ''},\n\n` +
    (conFecha.length === 1 ? `Ya tiene fecha esta sesión del curso «${ev.titulo}»:` : `Ya tienen fecha estas sesiones del curso «${ev.titulo}»:`) +
    `\n\n${lista}\n\nPuedes ver todas las sesiones en la web:\n${url}\n`;

  const mensajes = [];
  for (const sid of socios) {
    const ads = (adultos || []).filter(a => a.socio_id === sid && a.email);
    if (!ads.length) continue;
    const nombre = ads.map(a => a.nombre).join(' y ');
    mensajes.push({ socio: sid, familia: nombre, a: ads.map(a => a.email).join(', '), subject: asunto, text: texto(nombre) });
  }
  // Inscritos que no son socios: al email de contacto
  if (!ev.solo_pruebas) {
    const vistos = new Set();
    validas.filter(i => !i.socio_id && i.email_contacto).forEach(i => {
      const e = i.email_contacto.trim().toLowerCase();
      if (vistos.has(e)) return; vistos.add(e);
      mensajes.push({ socio: null, familia: i.nombre_contacto || e, a: i.email_contacto.trim(), subject: asunto, text: texto(i.nombre_contacto || '') });
    });
  }
  if (!mensajes.length) return json(400, { error: 'No hay inscritos con email.' });

  if (p.vista) {
    return json(200, { ok: true, vista: mensajes.map(m => ({
      familia: m.familia, a: m.a, asunto: m.subject,
      html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`)
    })) });
  }

  const envioId = String(p.envioId || '');
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) return json(400, { error: 'Falta el identificador del envío.' });
  const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);
  const { data: ya } = await sb.from('avisos_enviados').select('socio_id').eq('envio_id', envioId);
  const hechos = new Set((ya || []).map(x => x.socio_id));
  let enviados = 0; const fallos = [];
  for (const m of mensajes.slice(inicio, inicio + TANDA)) {
    if (m.socio && hechos.has(m.socio)) { enviados++; continue; }
    try {
      await enviarEmail({ to: m.a, subject: m.subject, text: m.text });
      if (m.socio) await sb.from('avisos_enviados').insert({ envio_id: envioId, ref_id: ev.id, socio_id: m.socio });
      enviados++;
    } catch (e) { fallos.push(m.a); }
  }
  const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
  return json(200, { ok: true, total: mensajes.length, siguiente, enviados, fallos });
};
