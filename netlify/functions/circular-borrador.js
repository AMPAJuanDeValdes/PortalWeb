// «Enviar circular» de un evento (panel de la Junta → Eventos): prepara un
// email con la información del evento y lo deja en la carpeta de Borradores
// del buzón del AMPA. La Junta lo abre en su correo, lo revisa, pone los
// destinatarios y lo envía desde allí.
//   POST { eventoId }  (con la sesión de alguien de la Junta)
//   POST { tipo: 'uniformes' | 'libros', convocatoriaId }  → circular de la
//        convocatoria del Banco de Uniformes o del Banco de Libros
//   → { ok, carpeta, asunto }

const { createClient } = require('@supabase/supabase-js');
const { componerBorrador } = require('./_lib/email');
const { guardarBorrador } = require('./_lib/imap');
const { BANCOS } = require('./_lib/bancos');
const { registrarDifusion } = require('./_lib/avisos');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const ZONA = { timeZone: 'Europe/Madrid' };
const dia = (f) => new Date(f).toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' });
const hora = (f) => new Date(f).toLocaleTimeString('es-ES', { ...ZONA, hour: '2-digit', minute: '2-digit' });
const fechaHora = (f) => `${dia(f)} a las ${hora(f)}`;
const lista = (n) => n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || '';
const euros = (n) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

// «Alumnos y alumnas de 3º, 4º y 5º de Primaria y 1º de ESO»
function paraQuien(ev) {
  if (ev.tipo_elegibilidad === 'adultos') return 'Adultos de las familias socias.';
  if (ev.elegibilidad_modo === 'edad' && (ev.edad_min != null || ev.edad_max != null)) {
    const r = ev.edad_min != null && ev.edad_max != null ? `de ${ev.edad_min} a ${ev.edad_max} años`
      : ev.edad_min != null ? `de ${ev.edad_min} años en adelante` : `hasta ${ev.edad_max} años`;
    return (ev.tipo_elegibilidad === 'toda_familia' ? 'Toda la familia; alumnos y alumnas ' : 'Alumnos y alumnas ') + r + '.';
  }
  if (ev.tipo_elegibilidad === 'toda_familia') return 'Toda la familia.';
  const cursos = Array.isArray(ev.cursos_permitidos) ? ev.cursos_permitidos : [];
  if (!cursos.length) return null;
  const porEtapa = [];
  cursos.forEach(c => { let e = porEtapa.find(x => x.etapa === c.etapa); if (!e) porEtapa.push(e = { etapa: c.etapa, cursos: [] }); e.cursos.push(c.curso); });
  return 'Alumnos y alumnas de ' + lista(porEtapa.map(e => `${lista(e.cursos)} de ${e.etapa}`)) + '.';
}

function textoCircular(ev, sesiones, web) {
  const l = ['Hola, familias:', ''];
  if (ev.descripcion) l.push(ev.descripcion.trim(), '');
  const datos = [];
  if (sesiones.length) {
    datos.push('Sesiones:');
    sesiones.forEach(s => datos.push(`  - Sesión ${s.numero}: ${s.fecha ? fechaHora(s.fecha) : 'fecha por publicar'}`));
  } else if (ev.fecha) {
    datos.push(`Cuándo: ${dia(ev.fecha)}, ${ev.fecha_fin ? `de ${hora(ev.fecha)} a ${hora(ev.fecha_fin)}` : `a las ${hora(ev.fecha)}`}.`);
  }
  if (ev.lugar) datos.push(`Dónde: ${ev.lugar}.`);
  const quien = paraQuien(ev);
  if (quien && !ev.sin_inscripcion) datos.push(`Para quién: ${quien}`);
  if (!ev.sin_inscripcion && ev.aforo_total) datos.push(`Plazas: ${ev.aforo_total}${ev.metodo_asignacion === 'sorteo' ? ', por sorteo entre los inscritos' : ', por orden de inscripción'}.`);
  if (!ev.sin_inscripcion && ev.abierto_no_socios && Number(ev.precio_invitado) > 0) datos.push(`Precio para familias no socias: ${euros(ev.precio_invitado)}.`);
  if (!ev.sin_inscripcion && ev.fecha_apertura_socios && new Date(ev.fecha_apertura_socios) > new Date()) datos.push(`La inscripción se abre el ${fechaHora(ev.fecha_apertura_socios)}.`);
  if (!ev.sin_inscripcion && ev.fecha_cierre_inscripcion) datos.push(`Se puede apuntar hasta el ${fechaHora(ev.fecha_cierre_inscripcion)}.`);
  if (datos.length) l.push(...datos, '');
  if (ev.sin_inscripcion) {
    l.push('No hace falta apuntarse.', '', `Más información en la web del AMPA:\n${web}/eventos.html#ev-${ev.id}`);
  } else {
    l.push(`Para apuntaros, entrad en la web del AMPA:\n${web}/eventos.html#ev-${ev.id}`);
    if (ev.abierto_no_socios) l.push('', `Las familias no socias pueden apuntarse en:\n${web}/publico.html`);
  }
  return l.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Falta token de sesión' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede preparar circulares.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  let asunto, texto, tipoRef, refId;
  if (p.tipo) {
    // Convocatoria del Banco de Uniformes o del Banco de Libros
    const b = BANCOS[p.tipo];
    if (!b) return json(400, { error: 'Tipo de convocatoria no válido.' });
    const { data: conv } = await sb.from(b.tabla).select('*').eq('id', String(p.convocatoriaId || '')).single();
    if (!conv) return json(404, { error: 'La convocatoria no existe.' });
    asunto = b.asunto; texto = b.texto(conv, web); tipoRef = p.tipo; refId = conv.id;
  } else {
    const { data: ev } = await sb.from('eventos').select('*').eq('id', String(p.eventoId || '')).single();
    if (!ev) return json(404, { error: 'El evento no existe.' });
    const { data: ses } = await sb.from('evento_sesiones').select('numero, fecha').eq('evento_id', ev.id).order('numero');
    asunto = ev.titulo; texto = textoCircular(ev, ses || [], web); tipoRef = 'evento'; refId = ev.id;
  }
  try {
    const mensaje = await componerBorrador({ subject: asunto, text: texto });
    const carpeta = await guardarBorrador(mensaje);
    await registrarDifusion(sb, { tipo: tipoRef, refId, canal: 'circular', adultoId: u.user.id });
    return json(200, { ok: true, carpeta, asunto });
  } catch (e) {
    return json(500, { error: e.message || 'No se pudo guardar el borrador.' });
  }
};

module.exports.textoCircular = textoCircular;
module.exports.paraQuien = paraQuien;
