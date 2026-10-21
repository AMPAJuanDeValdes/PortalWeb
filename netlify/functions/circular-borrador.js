// «Enviar circular» de un evento (panel de la Junta → Eventos): prepara el
// email como los mandaba la Junta (nota al colegio para que lo reenvíe a los
// cursos que tocan + mensaje a las familias) con la circular en PDF adjunta
// (_lib/circular.js, _lib/pdf-circular.js), y lo deja en la carpeta de Borradores
// del buzón del AMPA. La Junta lo abre en su correo, lo revisa, pone los
// destinatarios y lo envía desde allí.
//   POST { eventoId }  (con la sesión de alguien de la Junta)
//   POST { tipo: 'uniformes' | 'libros', convocatoriaId }  → circular de la
//        convocatoria del Banco de Uniformes o del Banco de Libros
//   → { ok, carpeta, asunto }

const { createClient } = require('@supabase/supabase-js');
const { componerBorrador, rutaAsset } = require('./_lib/email');
const { correoCircular } = require('./_lib/circular');
const { pdfCircular } = require('./_lib/pdf-circular');
const { AMPA_IBAN } = require('../../web/shared/datos-ampa.js');
const { guardarBorrador } = require('./_lib/imap');
const { BANCOS } = require('./_lib/bancos');
const { registrarDifusion } = require('./_lib/avisos');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const ZONA = { timeZone: 'Europe/Madrid' };
const dia = (f) => new Date(f).toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' });
const diaAnio = (f) => new Date(f).toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fechaLarga = (f) => new Date(f).toLocaleDateString('es-ES', { ...ZONA, day: 'numeric', month: 'long', year: 'numeric' });
const hora = (f) => new Date(f).toLocaleTimeString('es-ES', { ...ZONA, hour: '2-digit', minute: '2-digit' });
const fechaHora = (f) => `${dia(f)} a las ${hora(f)}`;
const lista = (n) => n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || '';
const euros = (n) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
const mayus = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;

// Talleres con recogida de alumnos (como shared/recogida.js) y el Curso de Warhammer
const PLANTILLAS_TALLER = ['juegos', 'taller', 'warhammer'];
const ES_CURSO = (ev) => ev.plantilla === 'warhammer';

// Orden de los cursos de cada etapa, para escribir «1º a 6º de Primaria»
const ORDEN_CURSOS = {
  Infantil: ['3 años', '4 años', '5 años'],
  Primaria: ['1º', '2º', '3º', '4º', '5º', '6º'],
  ESO: ['1º', '2º', '3º', '4º'],
  Bachillerato: ['1º', '2º']
};
function cursosDeEtapa(etapa, cursos) {
  const orden = ORDEN_CURSOS[etapa] || [];
  const pos = cursos.map(c => orden.indexOf(c));
  const seguidos = cursos.length >= 3 && pos.every(i => i >= 0) && pos.every((p, i) => i === 0 || p === pos[i - 1] + 1);
  return (seguidos ? `${cursos[0]} a ${cursos[cursos.length - 1]}` : lista(cursos)) + ' de ' + etapa;
}
// «1º a 6º de Primaria», «de 6 a 12 años»… (de un evento o de una actividad)
function cursosTexto(x) {
  if (x.elegibilidad_modo === 'edad' && (x.edad_min != null || x.edad_max != null)) {
    return x.edad_min != null && x.edad_max != null ? `de ${x.edad_min} a ${x.edad_max} años`
      : x.edad_min != null ? `de ${x.edad_min} años en adelante` : `hasta ${x.edad_max} años`;
  }
  const cursos = Array.isArray(x.cursos_permitidos) ? x.cursos_permitidos : [];
  if (!cursos.length) return '';
  const porEtapa = [];
  cursos.forEach(c => { let e = porEtapa.find(y => y.etapa === c.etapa); if (!e) porEtapa.push(e = { etapa: c.etapa, cursos: [] }); e.cursos.push(c.curso); });
  porEtapa.forEach(e => { const o = ORDEN_CURSOS[e.etapa] || []; e.cursos.sort((a, b) => o.indexOf(a) - o.indexOf(b)); });
  return lista(porEtapa.map(e => cursosDeEtapa(e.etapa, e.cursos)));
}

// «Alumnos y alumnas de 1º a 6º de Primaria.»
function paraQuien(ev) {
  if (ev.tipo_elegibilidad === 'adultos') return 'Adultos de las familias.';
  const c = cursosTexto(ev);
  if (ev.tipo_elegibilidad === 'toda_familia') return c ? `Toda la familia; alumnos y alumnas ${c}.` : 'Toda la familia.';
  return c ? `Alumnos y alumnas ${ev.elegibilidad_modo === 'edad' ? '' : 'de '}${c}.` : null;
}

function cuando(ev, sesiones) {
  if (ES_CURSO(ev) && sesiones.length) return null;
  if (!ev.fecha) return null;
  return `el ${diaAnio(ev.fecha).replace(',', '')}, ${ev.fecha_fin ? `de ${hora(ev.fecha)} a ${hora(ev.fecha_fin)}` : `a las ${hora(ev.fecha)}`}`;
}

// A quién tiene que reenviar el colegio la circular: «los alumnos y alumnas
// de Primaria (1º a 6º) y ESO (1º y 2º)» (cursos del evento y de sus actividades)
function destinatariosEvento(ev, actividades) {
  if (ev.tipo_elegibilidad === 'adultos') return 'todas las familias';
  const conCursos = [ev, ...actividades];
  const edad = conCursos.find(x => x.elegibilidad_modo === 'edad' && (x.edad_min != null || x.edad_max != null));
  const cursos = conCursos.flatMap(x => x.elegibilidad_modo === 'edad' ? [] : (Array.isArray(x.cursos_permitidos) ? x.cursos_permitidos : []));
  if (!cursos.length) return edad ? `las familias con alumnos y alumnas ${cursosTexto(edad)}` : 'todas las familias';
  const etapas = Object.keys(ORDEN_CURSOS).filter(e => cursos.some(c => c.etapa === e)).map(e => {
    const o = ORDEN_CURSOS[e];
    const lc = [...new Set(cursos.filter(c => c.etapa === e).map(c => c.curso))].sort((a, b) => o.indexOf(a) - o.indexOf(b));
    return `${e} (${cursosDeEtapa(e, lc).replace(/ de [^ ]+$/, '')})`;
  });
  return 'los alumnos y alumnas de ' + lista(etapas);
}

// «jueves 8 de octubre» (y la hora si no es al final del día)
function diaLimite(f) {
  const h = hora(f);
  return dia(f).replace(',', '') + (h === '23:59' || h === '00:00' ? '' : ` a las ${h}`);
}

// Los enlaces de la circular (inscripción…), para ponerlos también en el email
const enlacesCircular = (c) => (c.apartados || []).flatMap(a => (a.puntos || []).filter(p => p && p.enlace).map(p => ({ texto: p.texto, url: p.enlace })));

// La circular de un evento (formato de _lib/circular.js) con sus datos de la web
function circularEvento(ev, sesiones, actividades, web) {
  const fechas = sesiones.filter(s => s.fecha);
  const c = { titulo: ev.titulo, apartados: [] };
  if (ES_CURSO(ev) && fechas.length) c.subtitulo = fechas.length > 1 ? `Desde el ${fechaLarga(fechas[0].fecha)}` : fechaLarga(fechas[0].fecha);
  else if (ev.fecha) c.subtitulo = fechaLarga(ev.fecha);

  const entrada = [];
  const cu = cuando(ev, sesiones);
  if (cu) entrada.push(`${mayus(cu)}${ev.lugar ? `, en ${ev.lugar}` : ''}.`);
  else if (ev.lugar) entrada.push(`Lugar: ${ev.lugar}.`);
  if (ev.descripcion) entrada.push(...ev.descripcion.trim().split(/\n{2,}/));
  c.entrada = entrada;

  if (sesiones.length) {
    c.apartados.push({ titulo: 'Sesiones', puntos: sesiones.map(s => `Sesión ${s.numero}: ${s.fecha ? fechaHora(s.fecha) : 'fecha por publicar'}`) });
  }

  if (!ev.sin_inscripcion) {
    // Plazas disponibles: por actividad o del evento
    const plazas = [];
    if (actividades.length) {
      actividades.forEach(a => {
        const quien = cursosTexto(a);
        const partes = [a.aforo ? `${a.aforo} plazas` : '', quien ? `(${quien})` : '', a.horario ? `· ${a.horario}` : ''].filter(Boolean).join(' ');
        plazas.push({ etiqueta: a.nombre + (partes ? ':' : ''), texto: partes });
      });
    } else {
      const quien = paraQuien(ev);
      const cursos = ev.tipo_elegibilidad === 'adultos' ? '' : cursosTexto(ev);
      if (ev.aforo_total) plazas.push(`${ev.aforo_total} plazas${cursos ? ` (${cursos})` : ''}`);
      else if (quien) plazas.push(quien);
    }
    if (ev.metodo_asignacion === 'sorteo') plazas.push('Las plazas se sortean entre las inscripciones recibidas.');
    else if (ev.aforo_total || actividades.some(a => a.aforo)) plazas.push('Por orden de inscripción, hasta completar las plazas.');
    if (plazas.length) c.apartados.push({ titulo: 'Plazas disponibles', puntos: plazas });

    // Coste
    const coste = [];
    const pAlumno = Number(ev.precio_alumno) || 0, pAdulto = Number(ev.precio_adulto) || 0, pNoSocio = Number(ev.precio_invitado) || 0;
    if (ES_CURSO(ev) || ev.tipo_elegibilidad !== 'adultos') {
      coste.push(pAlumno && !ES_CURSO(ev) ? { etiqueta: 'Alumnos socios:', texto: euros(pAlumno) } : { etiqueta: 'Socios del AMPA:', texto: 'gratuito' });
    }
    if (pAdulto && !ES_CURSO(ev)) coste.push(ev.tipo_elegibilidad === 'alumnos'
      ? `Los adultos no se apuntan: pagan ${euros(pAdulto)} en la entrada.`
      : { etiqueta: 'Adultos socios:', texto: `${euros(pAdulto)}, se paga en el evento.` });
    if (ev.abierto_no_socios) {
      coste.push(pNoSocio
        ? { etiqueta: 'No socios:', texto: `${euros(pNoSocio)}${ES_CURSO(ev) ? ' el curso completo' : ''} por transferencia a ${AMPA_IBAN}`, sub: ['Se sube el justificante al apuntarse en la web.'] }
        : { etiqueta: 'No socios:', texto: 'gratuito' });
    } else if (ev.permite_invitados && pNoSocio) {
      coste.push({ etiqueta: 'Personas no socias:', texto: `${euros(pNoSocio)} cada una.` });
    }
    if (coste.length) c.apartados.push({ titulo: 'Coste', puntos: coste });

    // Inscripción: enlaces a la web
    const ins = [{ texto: ev.abierto_no_socios ? 'Inscripción de socios en la web del AMPA' : 'Inscripción en la web del AMPA', enlace: `${web}/eventos.html#ev-${ev.id}` }];
    if (ev.abierto_no_socios) ins.push({ texto: 'Inscripción de no socios en la web del AMPA', enlace: `${web}/publico.html#ev-${ev.id}` });
    const ahora = new Date();
    if (ev.fecha_apertura_socios && new Date(ev.fecha_apertura_socios) > ahora) {
      const noSocios = ev.abierto_no_socios && ev.fecha_apertura_no_socios && ev.fecha_apertura_no_socios !== ev.fecha_apertura_socios;
      ins.push({ etiqueta: noSocios ? 'Se abre para socios:' : 'Se abre:', texto: fechaHora(ev.fecha_apertura_socios) });
    }
    if (ev.abierto_no_socios && ev.fecha_apertura_no_socios && ev.fecha_apertura_no_socios !== ev.fecha_apertura_socios && new Date(ev.fecha_apertura_no_socios) > ahora) {
      ins.push({ etiqueta: 'Se abre para no socios:', texto: fechaHora(ev.fecha_apertura_no_socios) });
    }
    if (ev.fecha_cierre_inscripcion) ins.push({ etiqueta: 'Fecha límite:', texto: fechaHora(ev.fecha_cierre_inscripcion) });
    if (ev.pide_instrucciones) ins.push('Al apuntar podéis dejar instrucciones especiales (sale antes, llega tarde…).');
    c.apartados.push({ titulo: 'Inscripción', puntos: ins });
  } else {
    c.apartados.push({ titulo: 'Inscripción', puntos: ['No hace falta apuntarse.', { texto: 'Más información en la web del AMPA', enlace: `${web}/eventos.html#ev-${ev.id}` }] });
  }

  // Talleres con alumnos: organización, recogida e información importante
  if (PLANTILLAS_TALLER.includes(ev.plantilla)) {
    const sitio = ev.lugar || '';
    // «a la biblioteca», «al aula de música»
    const aSitio = sitio ? (/^el\s/i.test(sitio) ? ' al ' + sitio.replace(/^el\s+/i, '') : ' a ' + sitio) : '';
    c.apartados.push({ titulo: 'Organización', puntos: [
      `Los alumnos y alumnas inscritos serán llevados directamente${aSitio} por docentes al salir de clase.`,
      'Permanecerán bajo la supervisión de padres y madres voluntarios del AMPA.'
    ] });
    if (ev.fecha_fin) {
      c.apartados.push({ titulo: 'Recogida', parrafos: [
        `${hora(ev.fecha_fin)} h${sitio ? ' en ' + sitio : ''}.`,
        'Si la persona autorizada no está presente, el alumno o alumna será llevado a permanencias del colegio.'
      ] });
    } else {
      c.apartados.push({ titulo: 'Recogida', parrafos: ['Si la persona autorizada no está presente, el alumno o alumna será llevado a permanencias del colegio.'] });
    }
    const imp = ['Los alumnos y alumnas solo podrán salir con las personas indicadas en la inscripción.'];
    if (ev.plantilla === 'warhammer') imp.push('Podrán salir solos si así lo indica su familia en la inscripción.');
    c.apartados.push({ titulo: 'Importante', parrafos: [
      'El AMPA es una entidad externa al colegio.',
      'Por la LOPD, el colegio no puede informar sobre personas autorizadas:'
    ], puntos: imp });
  }
  return c;
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
  let asunto, circular, correo, tipoRef, refId;
  if (p.tipo) {
    // Convocatoria del Banco de Uniformes o del Banco de Libros
    const b = BANCOS[p.tipo];
    if (!b) return json(400, { error: 'Tipo de convocatoria no válido.' });
    const { data: conv } = await sb.from(b.tabla).select('*').eq('id', String(p.convocatoriaId || '')).single();
    if (!conv) return json(404, { error: 'La convocatoria no existe.' });
    asunto = b.asunto; circular = b.circular(conv, web); tipoRef = p.tipo; refId = conv.id;
    correo = { destinatarios: 'todas las familias', limite: diaLimite(conv.fecha_cierre), etiquetaLimite: 'Fecha límite para pedir:' };
  } else {
    const { data: ev } = await sb.from('eventos').select('*').eq('id', String(p.eventoId || '')).single();
    if (!ev) return json(404, { error: 'El evento no existe.' });
    const [{ data: ses }, { data: acts }] = await Promise.all([
      sb.from('evento_sesiones').select('numero, fecha').eq('evento_id', ev.id).order('numero'),
      sb.from('evento_actividades').select('nombre, horario, aforo, elegibilidad_modo, cursos_permitidos, edad_min, edad_max, created_at').eq('evento_id', ev.id).order('created_at')
    ]);
    asunto = ev.titulo; circular = circularEvento(ev, ses || [], acts || [], web); tipoRef = 'evento'; refId = ev.id;
    correo = { destinatarios: destinatariosEvento(ev, acts || []), limite: !ev.sin_inscripcion && ev.fecha_cierre_inscripcion ? diaLimite(ev.fecha_cierre_inscripcion) : null };
  }
  try {
    // Como se mandaban: email corto (nota al colegio + mensaje a las familias) y la circular en PDF adjunta
    const pdf = pdfCircular(circular, { logo: rutaAsset('logo-ampa-circular.png') });
    const nombrePdf = [circular.titulo, circular.subtitulo].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
    const { texto, html } = correoCircular({ ...correo, entrada: circular.entrada, circular, enlaces: enlacesCircular(circular) });
    const mensaje = await componerBorrador({
      subject: asunto, text: texto, html,
      adjuntos: [{ filename: nombrePdf, content: pdf, contentType: 'application/pdf' }]
    });
    const carpeta = await guardarBorrador(mensaje);
    await registrarDifusion(sb, { tipo: tipoRef, refId, canal: 'circular', adultoId: u.user.id });
    return json(200, { ok: true, carpeta, asunto });
  } catch (e) {
    return json(500, { error: e.message || 'No se pudo guardar el borrador.' });
  }
};

module.exports.circularEvento = circularEvento;
module.exports.destinatariosEvento = destinatariosEvento;
module.exports.paraQuien = paraQuien;
