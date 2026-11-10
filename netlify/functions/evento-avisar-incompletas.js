// Panel → Eventos: avisa a las familias con la inscripción sin terminar (les
// falta firmar algún documento, p. ej. en la Cabalgata) por email y con un
// aviso en el móvil. Sin los documentos firmados no entran en el sorteo.
//   POST { eventoId, vista: true }  → { ok, vista: [{ familia, a, asunto, html }] } (no envía nada)
//   POST { eventoId, envioId, inicio } → envía por tandas (Netlify corta a los 10 s):
//        la pantalla llama con inicio = 0, TANDA, 2·TANDA… hasta que «siguiente» es null.
//        El aviso al móvil sale en la primera tanda. Cada familia enviada queda en
//        avisos_enviados (envioId): repetir una tanda no la vuelve a enviar.
//        → { ok, total, siguiente, enviados, fallos: [emails], moviles }

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, conFirma, plantillaInscripcionIncompleta } = require('./_lib/email');
const { avisarFamilias, registrarDifusion } = require('./_lib/avisos');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const ZONA = { timeZone: 'Europe/Madrid' };
const TANDA = 2;   // familias por llamada (cada email, con su copia en Enviados, tarda 2–4 s)

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

  // Las inscripciones sin terminar (la misma regla que el sorteo y que el aviso al entrar)
  const { data: incompletas, error } = await sb.rpc('evento_inscripciones_incompletas', { p_evento: ev.id });
  if (error) return json(500, { error: error.message + (/evento_inscripciones_incompletas/.test(error.message) ? ' ¿Has ejecutado supabase/pendientes/migracion-inscripcion-completa.sql?' : '') });
  const porFamilia = new Map();
  (incompletas || []).forEach(x => { if (x.socio_id) porFamilia.set(x.socio_id, [...(porFamilia.get(x.socio_id) || []), ...(x.faltan || [])]); });
  // Evento de prueba: solo a las familias que están probando
  if (ev.solo_pruebas) {
    const { data: prueba } = await sb.from('adultos').select('socio_id').ilike('email', '%ampa-prueba-%');
    const { data: reales } = await sb.from('pruebas_familias').select('socio_id');
    const ok = new Set([...(prueba || []), ...(reales || [])].map(a => a.socio_id));
    [...porFamilia.keys()].forEach(s => { if (!ok.has(s)) porFamilia.delete(s); });
  }
  const socios = [...porFamilia.keys()].sort();   // orden fijo: las tandas no cambian
  if (!socios.length) return json(400, { error: 'No hay ninguna inscripción sin terminar.' });
  const { data: adultos } = await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at');

  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const url = `${web}/eventos.html#ev-${ev.id}`;
  const sorteo = ev.metodo_asignacion === 'sorteo' && !ev.sorteo_realizado;
  const cierre = ev.fecha_cierre_inscripcion
    ? new Date(ev.fecha_cierre_inscripcion).toLocaleString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(',', '')
    : null;
  const mensajes = [];
  for (const sid of socios) {
    const ads = (adultos || []).filter(a => a.socio_id === sid && a.email);
    if (!ads.length) continue;
    const faltan = [...new Set(porFamilia.get(sid))];
    const pl = plantillaInscripcionIncompleta({ nombre: ads.length === 1 ? ads[0].nombre : '', evento: ev.titulo, faltan, cierre, sorteo, url });
    mensajes.push({ socio: sid, familia: ads.map(a => a.nombre).join(' y '), a: ads.map(a => a.email).join(', '), ...pl });
  }
  if (!mensajes.length) return json(400, { error: 'Las familias con la inscripción sin terminar no tienen email.' });

  if (p.vista) {
    return json(200, { ok: true, vista: mensajes.map(m => ({
      familia: m.familia, a: m.a, asunto: m.subject,
      html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`)
    })) });
  }

  const envioId = String(p.envioId || '');
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) return json(400, { error: 'Falta el identificador del envío.' });
  const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);

  const tanda = mensajes.slice(inicio, inicio + TANDA);
  const { data: ya } = await sb.from('avisos_enviados').select('socio_id').eq('envio_id', envioId);
  const hechos = new Set((ya || []).map(x => x.socio_id));
  // El aviso en el móvil, una vez y a todas (es rápido)
  let moviles = null;
  if (inicio === 0 && !hechos.size) {   // al reintentar no se repite
    try {
      const avisos = new Map(socios.map(s => [s, { title: 'Falta terminar la inscripción', body: `${ev.titulo}: falta firmar algún documento en la web.`, url: '/eventos.html#ev-' + ev.id, tag: 'incompleta-' + ev.id }]));
      moviles = (await avisarFamilias(sb, avisos)).familiasConAviso;
    } catch (e) { moviles = 0; }   // sin claves de avisos: siguen los emails
  }

  let enviados = 0; const fallos = [];
  for (const m of tanda) {
    if (hechos.has(m.socio)) { enviados++; continue; }
    try {
      await enviarEmail({ to: m.a, subject: m.subject, text: m.text });
      await sb.from('avisos_enviados').insert({ envio_id: envioId, ref_id: ev.id, socio_id: m.socio });
      enviados++;
    } catch (e) { fallos.push(m.a); }
  }
  const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
  if (siguiente === null) {
    const { count } = await sb.from('avisos_enviados').select('socio_id', { count: 'exact', head: true }).eq('envio_id', envioId);
    if (count) await registrarDifusion(sb, { tipo: 'evento', refId: ev.id, canal: 'incompletas', familias: count, adultoId: u.user.id });
  }
  return json(200, { ok: true, total: mensajes.length, siguiente, enviados, fallos, moviles });
};
