// Gestión de la Cabalgata después del sorteo (lo usan cabalgata-responder,
// cabalgata-admin, cabalgata-caducar y evento-sortear).
//
//  · Suplentes: las parejas que no salieron (con la inscripción completa) y
//    los postulados a un puesto que no salieron quedan ordenados al azar
//    (suplente_orden: 1 = primer suplente).
//  · Los elegidos confirman si van. Si dicen que no o se les pasa el plazo,
//    pierden la plaza y pasa sola al primer suplente que quepa, que tiene
//    su propio plazo (el de la Junta o, si ya ha pasado, las horas que diga
//    eventos.gestion_horas_suplente) y recibe un email y un aviso al móvil.
//
// Siempre con el cliente de la SERVICE ROLE KEY.

const { enviarEmail } = require('./email');
const { avisarFamilias } = require('./avisos');

const ZONA = { timeZone: 'Europe/Madrid' };
const NOMBRE_PUESTO = { responsable: 'Responsable', baltasar: 'Rey Baltasar', gaspar: 'Rey Gaspar', melchor: 'Rey Melchor', paje: 'Paje Real' };
const PLAZAS_PUESTO = (p) => (p === 'paje' ? 2 : 1);

function mezclar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const fechaLarga = (f) => new Date(f).toLocaleString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(',', '');

async function comprobar({ error }, que) {
  if (error) throw new Error(`${que}: ${error.message}`);
}

// Inscripciones del evento (sin subactividades ni voluntarios) agrupadas por pareja
async function cargar(sb, eventoId) {
  const { data: ev, error } = await sb.from('eventos').select('*').eq('id', eventoId).maybeSingle();
  if (error) throw error;
  if (!ev) throw new Error('El evento no existe.');
  const { data: filas, error: e2 } = await sb.from('evento_inscripciones')
    .select('id, socio_id, grupo_id, tipo_miembro, estado, asignada_a_mano, suplente_orden, asistencia, confirmar_hasta, alumno_id, adulto_id, nombre_invitado, apellidos_invitado, alumnos(nombre, apellidos), adultos(nombre, apellidos)')
    .eq('evento_id', eventoId).is('actividad_id', null).eq('es_voluntario', false);
  if (e2) throw e2;
  const grupos = new Map();
  for (const f of filas || []) {
    const g = f.grupo_id || f.id;
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(f);
  }
  const { data: posts, error: e3 } = await sb.from('evento_postulaciones')
    .select('id, socio_id, adulto_id, puesto, estado, suplente_orden, asistencia, confirmar_hasta, adultos(nombre, apellidos)')
    .eq('evento_id', eventoId);
  if (e3) throw e3;
  return { ev, grupos, posts: posts || [] };
}

const alumnosDe = (filas) => filas.filter(f => f.tipo_miembro === 'alumno');
const nombreFila = (f) => f.alumnos ? `${f.alumnos.nombre} ${f.alumnos.apellidos || ''}`.trim()
  : f.adultos ? `${f.adultos.nombre} ${f.adultos.apellidos || ''}`.trim()
  : `${f.nombre_invitado || ''} ${f.apellidos_invitado || ''}`.trim();

// Ordena al azar a los suplentes que todavía no tienen número (se puede
// repetir: los que ya tienen número se quedan como están)
async function ordenarSuplentes(sb, eventoId) {
  const { ev, grupos, posts } = await cargar(sb, eventoId);
  const { data: incompletas, error } = await sb.rpc('evento_inscripciones_incompletas', { p_evento: eventoId });
  if (error) throw error;
  const sinTerminar = new Set((incompletas || []).map(x => x.grupo));

  let siguiente = 1 + Math.max(0, ...[...grupos.values()].flat().map(f => f.suplente_orden || 0));
  const nuevos = mezclar([...grupos.entries()].filter(([g, filas]) =>
    alumnosDe(filas).length && filas.every(f => f.estado === 'no_ganador' && f.suplente_orden == null && !f.asistencia) && !sinTerminar.has(g)));
  for (const [, filas] of nuevos) {
    await comprobar(await sb.from('evento_inscripciones').update({ suplente_orden: siguiente++ }).in('id', filas.map(f => f.id)), 'Suplentes');
  }
  let puestos = 0;
  for (const puesto of ev.puestos || []) {
    const de = posts.filter(p => p.puesto === puesto);
    let n = 1 + Math.max(0, ...de.map(p => p.suplente_orden || 0));
    for (const p of mezclar(de.filter(p => p.estado === 'no_elegido' && p.suplente_orden == null && !p.asistencia))) {
      await comprobar(await sb.from('evento_postulaciones').update({ suplente_orden: n++ }).eq('id', p.id), 'Suplentes de los puestos');
      puestos++;
    }
  }
  return { parejas: nuevos.length, puestos };
}

// Plazo para quien entra de suplente
function plazoSuplente(ev) {
  const junta = ev.gestion_confirmar_hasta ? new Date(ev.gestion_confirmar_hasta).getTime() : 0;
  const horas = Date.now() + (ev.gestion_horas_suplente || 48) * 3600 * 1000;
  return new Date(Math.max(junta, horas)).toISOString();
}

// Llena las plazas libres con los suplentes, en orden. Devuelve a quién ha entrado.
// excluir: grupos o postulaciones que no pueden entrar ahora (quien acaba de decir que no)
async function promover(sb, eventoId, excluir = new Set()) {
  const { ev, grupos, posts } = await cargar(sb, eventoId);
  if (!ev.gestion_confirmar_hasta) return [];   // la gestión no ha empezado
  const entran = [];
  const ahora = new Date().toISOString();

  if (ev.aforo_total != null) {
    const todas = [...grupos.values()].flat();
    const ganadores = todas.filter(f => f.tipo_miembro === 'alumno' && f.estado === 'ganador').length;
    const aMano = todas.filter(f => f.tipo_miembro === 'alumno' && f.estado === 'ganador' && f.asignada_a_mano).length;
    // Las reservadas que la Junta todavía no ha dado siguen siendo suyas
    let libres = ev.aforo_total - ganadores - Math.max(0, (ev.plazas_reservadas || 0) - aMano);
    const suplentes = [...grupos.entries()]
      .filter(([g, filas]) => !excluir.has(g) && alumnosDe(filas).length && filas.every(f => f.estado === 'no_ganador') && filas.some(f => f.suplente_orden != null))
      .sort((a, b) => Math.min(...a[1].map(f => f.suplente_orden ?? 1e9)) - Math.min(...b[1].map(f => f.suplente_orden ?? 1e9)));
    for (const [grupo, filas] of suplentes) {
      if (libres <= 0) break;
      const n = alumnosDe(filas).length;
      if (n > libres) continue;
      await comprobar(await sb.from('evento_inscripciones').update({
        estado: 'ganador', suplente_orden: null, asistencia: null, asistencia_en: null, promovido_en: ahora, confirmar_hasta: plazoSuplente(ev)
      }).in('id', filas.map(f => f.id)), 'Dar la plaza al suplente');
      libres -= n;
      entran.push({ tipo: 'pareja', grupo, socio_id: filas[0].socio_id, quien: alumnosDe(filas).map(nombreFila), con: filas.filter(f => f.tipo_miembro !== 'alumno').map(nombreFila) });
    }
  }

  for (const puesto of ev.puestos || []) {
    const de = posts.filter(p => p.puesto === puesto);
    const elegidos = de.filter(p => p.estado === 'elegido').length;
    const reservados = puesto === 'paje' ? (ev.pajes_reservados || 0) : 0;
    let libres = PLAZAS_PUESTO(puesto) - Math.max(reservados, elegidos);
    for (const p of de.filter(p => !excluir.has(p.id) && p.estado === 'no_elegido' && p.suplente_orden != null).sort((a, b) => a.suplente_orden - b.suplente_orden)) {
      if (libres <= 0) break;
      await comprobar(await sb.from('evento_postulaciones').update({
        estado: 'elegido', suplente_orden: null, asistencia: null, asistencia_en: null, promovido_en: ahora, confirmar_hasta: plazoSuplente(ev)
      }).eq('id', p.id), 'Dar el puesto al suplente');
      libres--;
      entran.push({ tipo: 'puesto', id: p.id, socio_id: p.socio_id, quien: [`${p.adultos?.nombre || ''} ${p.adultos?.apellidos || ''}`.trim()], puesto });
    }
  }
  return entran;
}

// Quita la plaza. Si dice que no puede ir, pasa a ser el último suplente
// (si luego quedan plazas libres, le puede volver a tocar); si se le pasó
// el plazo, queda fuera.
async function renunciarPareja(sb, eventoId, filas, motivo) {
  let orden = null;
  if (motivo === 'no') {
    const { data } = await sb.from('evento_inscripciones').select('suplente_orden').eq('evento_id', eventoId).not('suplente_orden', 'is', null).order('suplente_orden', { ascending: false }).limit(1);
    orden = ((data && data[0] && data[0].suplente_orden) || 0) + 1;
  }
  await comprobar(await sb.from('evento_inscripciones').update({
    estado: 'no_ganador', asistencia: motivo, asistencia_en: new Date().toISOString(), suplente_orden: orden
  }).in('id', filas.map(f => f.id)), 'Quitar la plaza');
}
async function renunciarPuesto(sb, eventoId, post, motivo) {
  let orden = null;
  if (motivo === 'no') {
    const { data } = await sb.from('evento_postulaciones').select('suplente_orden').eq('evento_id', eventoId).eq('puesto', post.puesto).not('suplente_orden', 'is', null).order('suplente_orden', { ascending: false }).limit(1);
    orden = ((data && data[0] && data[0].suplente_orden) || 0) + 1;
  }
  await comprobar(await sb.from('evento_postulaciones').update({
    estado: 'no_elegido', asistencia: motivo, asistencia_en: new Date().toISOString(), suplente_orden: orden
  }).eq('id', post.id), 'Quitar el puesto');
}

// Qué ha salido, dicho con nombre: «Leo López (con Ana López)» o «Ana López, como Paje Real»
function textoPlaza(x) {
  return x.tipo === 'puesto' ? `${x.quien.join(', ')}, como ${NOMBRE_PUESTO[x.puesto]}`
    : x.quien.join(' y ') + (x.con && x.con.length ? ` (con ${x.con.join(' y ')})` : '');
}

// Email y aviso al móvil a quien entra de suplente: uno por cada plaza
// (si en una familia entra más de una, cada una lleva su nombre)
async function avisarPromovidos(sb, ev, entran) {
  if (!entran.length) return;
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const url = `${web}/cabalgata.html?evento=${ev.id}`;
  const socios = [...new Set(entran.map(e => e.socio_id))];
  const { data: adultos } = await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at');
  const plazo = fechaLarga(plazoSuplente(ev));
  for (const e of entran) {
    const que = textoPlaza(e);
    const ads = (adultos || []).filter(a => a.socio_id === e.socio_id && a.email);
    if (ads.length) {
      try {
        await enviarEmail({   // enviarEmail le pone la firma del AMPA
          to: ads.map(a => a.email).join(', '),
          subject: `${ev.titulo}: plaza para ${e.quien.join(' y ')}`,
          text: `Hola ${ads.map(a => a.nombre).join(' y ')},\n\n` +
            `Ha quedado libre una plaza en «${ev.titulo}» y le toca, como suplente, a ${que}.\n\n` +
            `Confirmad si va antes del ${plazo}, en la web:\n${url}\n\n` +
            `Si no lo confirmáis antes de esa fecha, la plaza pasa al siguiente suplente.\n`
        });
      } catch (err) { console.error('Cabalgata: no se pudo enviar el email al suplente:', err.message); }
    }
    try {
      await avisarFamilias(sb, new Map([[e.socio_id, { title: `${ev.titulo}: plaza para ${e.quien.join(' y ')}`, body: `Confirmad si va antes del ${plazo}.`, url: `/cabalgata.html?evento=${ev.id}`, tag: `cabalgata-${ev.id}-${e.grupo || e.id}` }]]));
    } catch (err) { console.error('Cabalgata: no se pudo mandar el aviso al móvil:', err.message); }
  }
}

// Plazos vencidos: pierden la plaza y entra el siguiente suplente
async function caducar(sb, eventoId) {
  const { ev, grupos, posts } = await cargar(sb, eventoId);
  if (!ev.gestion_confirmar_hasta) return [];
  const ahora = Date.now();
  const vencido = (x) => new Date(x.confirmar_hasta || ev.gestion_confirmar_hasta).getTime() < ahora;
  for (const [, filas] of grupos) {
    const al = alumnosDe(filas);
    if (al.length && al.every(f => f.estado === 'ganador' && !f.asistencia) && vencido(al[0])) await renunciarPareja(sb, eventoId, filas, 'caducada');
  }
  for (const p of posts) {
    if (p.estado === 'elegido' && !p.asistencia && vencido(p)) await renunciarPuesto(sb, eventoId, p, 'caducada');
  }
  const entran = await promover(sb, eventoId);
  await avisarPromovidos(sb, ev, entran);
  return entran;
}

module.exports = { NOMBRE_PUESTO, textoPlaza, cargar, alumnosDe, nombreFila, ordenarSuplentes, promover, renunciarPareja, renunciarPuesto, avisarPromovidos, caducar, fechaLarga };
