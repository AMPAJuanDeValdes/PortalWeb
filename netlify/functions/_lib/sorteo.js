// Sorteos de los eventos (menos la Cabalgata, que tiene su propia gestión en
// _lib/cabalgata.js): suplentes, plazas que quedan libres y el email con el
// resultado. Cada inscripción (fila) cuenta como una plaza, igual que en el sorteo.
//
//  · Suplentes: estado 'no_ganador' con suplente_orden 1, 2, 3…
//  · Si hay menos plazas ocupadas que el aforo (alguien se ha desapuntado o
//    la Junta le ha quitado la plaza), entra solo el primer suplente y le
//    llega un email (función programada evento-suplentes y al cambiar resultados).
//
// Siempre con el cliente de la SERVICE ROLE KEY.

const { enviarEmail } = require('./email');

const ZONA = { timeZone: 'Europe/Madrid' };
const fechaLarga = (f) => new Date(f).toLocaleString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(',', '');

function mezclar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
async function comprobar({ error }, que) { if (error) throw new Error(`${que}: ${error.message}`); }

// Las inscripciones que entran en el sorteo, con el nombre de cada persona
async function cargar(sb, eventoId) {
  const { data: ev, error } = await sb.from('eventos').select('*').eq('id', eventoId).maybeSingle();
  if (error) throw error;
  if (!ev) throw new Error('El evento no existe.');
  const { data: filas, error: e2 } = await sb.from('evento_inscripciones')
    .select('id, socio_id, grupo_id, tipo_miembro, estado, suplente_orden, promovido_en, asignada_a_mano, nombre_invitado, apellidos_invitado, nombre_contacto, email_contacto, created_at, alumnos!alumno_id(nombre, apellidos), adultos!adulto_id(nombre, apellidos)')
    .eq('evento_id', eventoId).is('actividad_id', null).eq('es_voluntario', false)
    .order('created_at');
  if (e2) throw e2;
  return { ev, filas: filas || [] };
}
const nombre = (f) => f.alumnos ? `${f.alumnos.nombre} ${f.alumnos.apellidos || ''}`.trim()
  : f.adultos ? `${f.adultos.nombre} ${f.adultos.apellidos || ''}`.trim()
  : `${f.nombre_invitado || ''} ${f.apellidos_invitado || ''}`.trim() || f.nombre_contacto || 'Sin nombre';
const suplentesDe = (filas) => filas.filter(f => f.estado === 'no_ganador' && f.suplente_orden != null).sort((a, b) => a.suplente_orden - b.suplente_orden);

// Vuelve a numerar a los suplentes 1, 2, 3… sin huecos, en el orden que tienen
async function renumerar(sb, filas) {
  let n = 1;
  for (const f of suplentesDe(filas)) {
    if (f.suplente_orden !== n) await comprobar(await sb.from('evento_inscripciones').update({ suplente_orden: n }).eq('id', f.id), 'Ordenar suplentes');
    f.suplente_orden = n++;
  }
}

// Saca al azar los suplentes que faltan hasta llegar a ev.num_suplentes
// (para sorteos hechos antes de que hubiera suplentes, o si se sube el número).
// Solo entre las inscripciones completas (con los documentos firmados).
async function sacarSuplentes(sb, eventoId) {
  const { ev, filas } = await cargar(sb, eventoId);
  const { data: incompletas, error } = await sb.rpc('evento_inscripciones_incompletas', { p_evento: eventoId });
  if (error) throw error;
  const sinTerminar = new Set((incompletas || []).map(x => x.grupo));
  const ya = suplentesDe(filas);
  const faltan = Math.max(0, (ev.num_suplentes || 0) - ya.length);
  const candidatos = mezclar(filas.filter(f => f.estado === 'no_ganador' && f.suplente_orden == null && !sinTerminar.has(f.grupo_id || f.id)));
  let n = ya.length ? ya[ya.length - 1].suplente_orden + 1 : 1;
  const salen = candidatos.slice(0, faltan);
  for (const f of salen) await comprobar(await sb.from('evento_inscripciones').update({ suplente_orden: n++ }).eq('id', f.id), 'Sacar suplentes');
  return salen.length;
}

// Plazas libres → entra el primer suplente. Devuelve quién ha entrado.
async function promover(sb, eventoId) {
  const { ev, filas } = await cargar(sb, eventoId);
  if (ev.requiere_pareja_adulto_alumno || ev.metodo_asignacion !== 'sorteo' || !ev.sorteo_realizado || ev.aforo_total == null) return [];
  if (ev.fecha && new Date(ev.fecha) < new Date()) return [];   // ya ha pasado
  let libres = ev.aforo_total - filas.filter(f => f.estado === 'ganador').length;
  const entran = [];
  for (const f of suplentesDe(filas)) {
    if (libres <= 0) break;
    await comprobar(await sb.from('evento_inscripciones').update({ estado: 'ganador', suplente_orden: null, promovido_en: new Date().toISOString() }).eq('id', f.id), 'Dar la plaza al suplente');
    entran.push({ ...f, era: f.suplente_orden });
    f.estado = 'ganador'; f.suplente_orden = null;
    libres--;
  }
  if (entran.length) await renumerar(sb, filas);
  await avisarEntran(sb, ev, entran);
  return entran;
}

// A quién se escribe: los adultos con email de la familia socia o el email de contacto
async function destinatarios(sb, filas) {
  const socios = [...new Set(filas.filter(f => f.socio_id).map(f => f.socio_id))];
  const { data: adultos } = socios.length
    ? await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at')
    : { data: [] };
  const grupos = new Map();   // clave → { socio, nombre, a, filas }
  for (const f of filas) {
    let clave, dest;
    if (f.socio_id) {
      const ads = (adultos || []).filter(a => a.socio_id === f.socio_id && a.email);
      if (!ads.length) continue;
      clave = 's:' + f.socio_id;
      dest = { socio: f.socio_id, nombre: ads.map(a => a.nombre).join(' y '), a: ads.map(a => a.email).join(', ') };
    } else if (f.email_contacto) {
      clave = 'e:' + f.email_contacto.trim().toLowerCase();
      dest = { socio: null, nombre: f.nombre_contacto || '', a: f.email_contacto.trim() };
    } else continue;
    if (!grupos.has(clave)) grupos.set(clave, { ...dest, filas: [] });
    grupos.get(clave).filas.push(f);
  }
  return [...grupos.values()];
}

async function avisarEntran(sb, ev, entran) {
  if (!entran.length) return;
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  for (const d of await destinatarios(sb, entran)) {
    const quien = d.filas.map(nombre);
    try {
      await enviarEmail({   // enviarEmail le pone la firma del AMPA
        to: d.a,
        subject: `${ev.titulo}: plaza para ${quien.join(' y ')}`,
        text: `Hola${d.nombre ? ' ' + d.nombre : ''},\n\n` +
          `Ha quedado libre una plaza en «${ev.titulo}» y, como ${d.filas.length === 1 ? 'era suplente' : 'eran suplentes'}, ${d.filas.length === 1 ? 'le toca' : 'les toca'} a ${quien.join(' y ')}. Ya ${d.filas.length === 1 ? 'tiene' : 'tienen'} plaza.\n\n` +
          (ev.fecha ? `Fecha: ${fechaLarga(ev.fecha)}\n\n` : '') +
          `Puedes verlo en la web:\n${web}/eventos.html#ev-${ev.id}\n`
      });
    } catch (e) { console.error('Sorteo: no se pudo enviar el email al suplente:', e.message); }
  }
}

// El email con el resultado del sorteo, uno por familia (o por email de contacto)
function resultadoDe(f) {
  if (f.estado === 'ganador') return 'tiene plaza';
  if (f.estado === 'no_ganador' && f.suplente_orden != null) return `suplente nº ${f.suplente_orden}`;
  if (f.estado === 'no_ganador') return 'no ha salido en el sorteo';
  return 'pendiente del sorteo';
}
async function mensajesResultado(sb, ev, filas) {
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const lista = await destinatarios(sb, filas.filter(f => f.estado === 'ganador' || f.estado === 'no_ganador'));
  return lista.map(d => {
    const haySuplente = d.filas.some(f => f.estado === 'no_ganador' && f.suplente_orden != null);
    const text = `Hola${d.nombre ? ' ' + d.nombre : ''},\n\n` +
      `Ya se ha hecho el sorteo de «${ev.titulo}». Este es el resultado:\n\n` +
      d.filas.map(f => `- ${nombre(f)}: ${resultadoDe(f)}.`).join('\n') + '\n\n' +
      (haySuplente ? 'Si queda libre una plaza, entra el siguiente suplente y le llega un email.\n\n' : '') +
      (ev.fecha ? `Fecha: ${fechaLarga(ev.fecha)}\n\n` : '') +
      `Puedes verlo en la web:\n${web}/eventos.html#ev-${ev.id}\n`;
    return { socio: d.socio, familia: d.nombre || d.a, a: d.a, subject: `${ev.titulo}: resultado del sorteo`, text,
      resumen: d.filas.map(f => `${nombre(f)}: ${resultadoDe(f)}`) };
  });
}

module.exports = { cargar, nombre, suplentesDe, renumerar, sacarSuplentes, promover, avisarEntran, mensajesResultado, mezclar, fechaLarga };
