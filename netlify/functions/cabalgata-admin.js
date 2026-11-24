// Panel → Gestión de la Cabalgata (admin-cabalgata.html)
//   POST { eventoId, accion: 'ordenar' }                 → ordena al azar a los suplentes sin número (solo superadmin)
//   POST { eventoId, accion: 'avisar', vista: true }     → a quién se avisa y el primer email (no envía nada)
//   POST { eventoId, accion: 'avisar', inicio }          → email + aviso al móvil a los elegidos que no han
//        confirmado, por tandas (Netlify corta a los 10 s): la pantalla llama con inicio = 0, 2, 4…
//        hasta que «siguiente» es null. El aviso al móvil sale en la primera tanda.
//   POST { eventoId, accion: 'mover', grupo | postulacion, sube } → cambia a mano el orden de un suplente (solo superadmin)
//   POST { eventoId, accion: 'situacion', vista | inicio } → un email por familia socia con todos sus
//        inscritos y la situación de cada uno (igual: vista previa y luego por tandas)

const { createClient } = require('@supabase/supabase-js');
const { esSuperadmin, SOLO_SUPERADMIN } = require('./_lib/superadmin');
const { conFirma, enviarEmail, numeroSocioBonito } = require('./_lib/email');
const { avisarFamilias, registrarDifusion } = require('./_lib/avisos');
const { cargar, alumnosDe, nombreFila, ordenarSuplentes, NOMBRE_PUESTO, fechaLarga } = require('./_lib/cabalgata');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const TANDA = 2;

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
  try {
    if (p.accion === 'ordenar') {
      if (!(await esSuperadmin(sb, u.user.id))) return json(403, { error: SOLO_SUPERADMIN });
      return json(200, { ok: true, ...(await ordenarSuplentes(sb, String(p.eventoId || ''))) });
    }
    if (p.accion === 'mover') {
      if (!(await esSuperadmin(sb, u.user.id))) return json(403, { error: SOLO_SUPERADMIN });
      return json(200, await moverSuplente(sb, p));
    }
    if (p.accion === 'situacion') return json(200, await situacion(sb, p, u.user.id));
    if (p.accion !== 'avisar') return json(400, { error: 'Acción desconocida.' });

    const { ev, grupos, posts } = await cargar(sb, String(p.eventoId || ''));
    if (!ev.gestion_confirmar_hasta) return json(400, { error: 'Pon antes la fecha límite para confirmar.' });
    // Cada plaza sin contestar (un alumno/a con su adulto, o un puesto): un email por plaza, con su nombre
    const plazas = [];
    for (const [g, filas] of grupos) {
      const al = alumnosDe(filas);
      if (al.length && al.every(f => f.estado === 'ganador' && !f.asistencia))
        plazas.push({ clave: g, socio_id: filas[0].socio_id, tipo: 'pareja', quien: al.map(nombreFila), con: filas.filter(f => f.tipo_miembro !== 'alumno').map(nombreFila), plazo: al[0].confirmar_hasta || ev.gestion_confirmar_hasta });
    }
    for (const x of posts) {
      if (x.estado === 'elegido' && !x.asistencia)
        plazas.push({ clave: x.id, socio_id: x.socio_id, tipo: 'puesto', puesto: x.puesto, quien: [`${x.adultos?.nombre || ''} ${x.adultos?.apellidos || ''}`.trim()], plazo: x.confirmar_hasta || ev.gestion_confirmar_hasta });
    }
    if (!plazas.length) return json(400, { error: 'Todos los elegidos han contestado ya.' });
    plazas.sort((a, b) => String(a.clave).localeCompare(String(b.clave)));   // orden fijo: las tandas no cambian
    const { data: adultos } = await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', [...new Set(plazas.map(x => x.socio_id))]).order('created_at');
    const web = (process.env.SITE_URL || '').replace(/\/$/, '');
    const url = `${web}/cabalgata.html?evento=${ev.id}`;
    const mensajes = [];
    for (const x of plazas) {
      const ads = (adultos || []).filter(a => a.socio_id === x.socio_id && a.email);
      if (!ads.length) continue;
      const salio = x.tipo === 'puesto' ? `${x.quien[0]} ha salido sorteado/a como ${NOMBRE_PUESTO[x.puesto]}` : `${x.quien.join(' y ')} ha salido sorteado/a${x.con.length ? ` (con ${x.con.join(' y ')})` : ''}`;
      mensajes.push({
        socio: x.socio_id, clave: x.clave, familia: ads.map(a => a.nombre).join(' y '), a: ads.map(a => a.email).join(', '), plazo: x.plazo,
        movil: `${x.quien.join(' y ')}: confirmad si va`,
        subject: `${ev.titulo}: confirmad si va ${x.quien.join(' y ')}`,
        text: `Hola ${ads.map(a => a.nombre).join(' y ')},\n\n` +
          `${salio} en el sorteo de «${ev.titulo}».\n\n` +
          `Confirmad si va antes del ${fechaLarga(x.plazo)}, en la web:\n${url}\n\n` +
          `Si no lo confirmáis antes de esa fecha, la plaza pasa al primer suplente.\n`
      });
    }
    if (!mensajes.length) return json(400, { error: 'Las familias de los que faltan por confirmar no tienen email.' });

    if (p.vista) {
      return json(200, { ok: true, vista: mensajes.map(m => ({
        familia: m.familia, a: m.a, asunto: m.subject,
        html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`)
      })) });
    }
    const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);
    let moviles = null;
    if (inicio === 0) {
      // Un aviso por familia, nombrando a cada uno que tiene que confirmar
      const avisos = new Map();
      for (const m of mensajes) {
        const x = avisos.get(m.socio) || { nombres: [], plazo: m.plazo };
        x.nombres.push(m.movil.replace(/: confirmad si va$/, ''));
        if (new Date(m.plazo) < new Date(x.plazo)) x.plazo = m.plazo;
        avisos.set(m.socio, x);
      }
      try {
        moviles = (await avisarFamilias(sb, new Map([...avisos].map(([sid, x]) => [sid, {
          title: `${ev.titulo}: confirmad si ${x.nombres.length > 1 ? 'van' : 'va'} ${x.nombres.join(' y ')}`,
          body: `Hasta el ${fechaLarga(x.plazo)}.`, url: `/cabalgata.html?evento=${ev.id}`, tag: `cabalgata-${ev.id}` }])))).familiasConAviso;
      } catch (e) { moviles = 0; }   // sin claves de avisos: siguen los emails
    }
    let enviados = 0; const fallos = [];
    for (const m of mensajes.slice(inicio, inicio + TANDA)) {
      try { await enviarEmail({ to: m.a, subject: m.subject, text: m.text }); enviados++; }
      catch (e) { fallos.push(m.a); }
    }
    const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
    if (siguiente === null) await registrarDifusion(sb, { tipo: 'evento', refId: ev.id, canal: 'cabalgata-confirmar', familias: mensajes.length, adultoId: u.user.id });
    return json(200, { ok: true, total: mensajes.length, siguiente, enviados, fallos, moviles });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

// Un email por familia socia con cada inscrito/a y su situación
async function situacion(sb, p, adultoId) {
  const { ev, grupos, posts } = await cargar(sb, String(p.eventoId || ''));
  const { data: incompletas } = await sb.rpc('evento_inscripciones_incompletas', { p_evento: ev.id });
  const sinTerminar = new Set((incompletas || []).map(x => x.grupo));
  const plazoDe = (x) => fechaLarga(x.confirmar_hasta || ev.gestion_confirmar_hasta);

  // Puesto de suplente contado entre los que siguen esperando (1 = primer suplente)
  const supParejas = [...grupos.entries()].filter(([, f]) => alumnosDe(f).length && f.every(x => x.estado === 'no_ganador') && f.some(x => x.suplente_orden != null))
    .sort((a, b) => Math.min(...a[1].map(x => x.suplente_orden ?? 1e9)) - Math.min(...b[1].map(x => x.suplente_orden ?? 1e9))).map(([g]) => g);
  const supPuesto = (x) => posts.filter(q => q.puesto === x.puesto && q.estado === 'no_elegido' && q.suplente_orden != null && q.suplente_orden <= x.suplente_orden).length;

  const situacionDe = (x, tiene, suplente, terminada) => {
    if (tiene) {
      if (x.asistencia === 'si') return 'ha salido sorteado/a y habéis confirmado que va.';
      return ev.gestion_confirmar_hasta ? `ha salido sorteado/a. Tenéis que confirmar en la web si va antes del ${plazoDe(x)}; si no, la plaza pasa al primer suplente.` : 'ha salido sorteado/a.';
    }
    if (x.asistencia === 'no' && suplente) return `dijisteis que no podía ir: su plaza pasó a otra persona y ahora es el ${suplente}.º suplente.`;
    if (x.asistencia === 'no') return 'dijisteis que no podía ir: la plaza ha pasado a otra persona.';
    if (x.asistencia === 'caducada') return 'no confirmasteis a tiempo si iba: la plaza ha pasado a otra persona.';
    if (suplente) return `no ha salido en el sorteo y es el ${suplente}.º suplente: si queda libre una plaza, os avisaremos.`;
    if (!terminada) return 'no entró en el sorteo porque la inscripción no estaba terminada (faltaba firmar algún documento).';
    return 'no ha salido en el sorteo.';
  };

  const lineas = new Map();   // socio_id → [texto]
  const anotar = (sid, t) => { if (sid) lineas.set(sid, [...(lineas.get(sid) || []), t]); };
  for (const [g, filas] of grupos) {
    const al = alumnosDe(filas);
    const ad = filas.filter(f => f.tipo_miembro !== 'alumno');
    if (!al.length) {   // adulto que va solo
      ad.forEach(f => anotar(f.socio_id, `${nombreFila(f)} (adulto sin alumno ni alumna): ${f.estado === 'ganador' ? 'va.' : 'no va.'}`));
      continue;
    }
    const pos = supParejas.indexOf(g);
    anotar(filas[0].socio_id, `${al.map(nombreFila).join(' y ')}${ad.length ? ` (con ${ad.map(nombreFila).join(' y ')})` : ''}: ` +
      situacionDe(al[0], al.every(f => f.estado === 'ganador'), pos >= 0 ? pos + 1 : null, !sinTerminar.has(g)));
  }
  for (const x of posts) {
    const nom = `${x.adultos?.nombre || ''} ${x.adultos?.apellidos || ''}`.trim();
    const suplente = x.estado === 'no_elegido' && x.suplente_orden != null ? supPuesto(x) : null;
    anotar(x.socio_id, `${nom}, postulado/a como ${NOMBRE_PUESTO[x.puesto]}: ` +
      (x.estado === 'postulado' ? 'el sorteo de los puestos todavía no se ha hecho.' : situacionDe(x, x.estado === 'elegido', suplente, true)));
  }
  const socios = [...lineas.keys()].sort();   // orden fijo: las tandas no cambian
  if (!socios.length) throw new Error('No hay ninguna familia socia inscrita.');
  const [{ data: adultos }, { data: numeros }] = await Promise.all([
    sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at'),
    sb.from('socios').select('id, numero_socio_completo').in('id', socios)
  ]);
  const web = (process.env.SITE_URL || '').replace(/\/$/, '');
  const url = `${web}/cabalgata.html?evento=${ev.id}`;
  const mensajes = [];
  for (const sid of socios) {
    const ads = (adultos || []).filter(a => a.socio_id === sid && a.email);
    if (!ads.length) continue;
    const num = numeroSocioBonito((numeros || []).find(n => n.id === sid)?.numero_socio_completo);
    mensajes.push({
      socio: sid, familia: ads.map(a => a.nombre).join(' y ') + (num ? ` (socio nº ${num})` : ''), a: ads.map(a => a.email).join(', '),
      subject: `${ev.titulo}: situación de vuestra inscripción`,
      text: `Hola ${ads.map(a => a.nombre).join(' y ')},\n\n` +
        `Esta es la situación de vuestra familia${num ? ` (socio nº ${num})` : ''} en «${ev.titulo}»:\n\n` +
        lineas.get(sid).map(t => '- ' + t).join('\n') + '\n\n' +
        (ev.gestion_confirmar_hasta ? `En la web podéis confirmar y ver lo que hay que preparar:\n${url}\n` : '')
    });
  }
  if (!mensajes.length) throw new Error('Las familias inscritas no tienen email.');
  if (p.vista) {
    return { ok: true, vista: mensajes.map(m => ({ familia: m.familia, a: m.a, asunto: m.subject,
      html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`) })) };
  }
  const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);
  let enviados = 0; const fallos = [];
  for (const m of mensajes.slice(inicio, inicio + TANDA)) {
    try { await enviarEmail({ to: m.a, subject: m.subject, text: m.text }); enviados++; }
    catch (e) { fallos.push(m.a); }
  }
  const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
  if (siguiente === null) await registrarDifusion(sb, { tipo: 'evento', refId: ev.id, canal: 'cabalgata-situacion', familias: mensajes.length, adultoId });
  return { ok: true, total: mensajes.length, siguiente, enviados, fallos };
}

// Sube o baja un puesto a un suplente (intercambia el número con el de al lado)
async function moverSuplente(sb, p) {
  const { grupos, posts } = await cargar(sb, String(p.eventoId || ''));
  const sube = p.sube === true;
  if (p.grupo) {
    const lista = [...grupos.entries()].filter(([, f]) => alumnosDe(f).length && f.every(x => x.estado === 'no_ganador') && f.some(x => x.suplente_orden != null))
      .map(([g, f]) => ({ g, f, orden: Math.min(...f.map(x => x.suplente_orden ?? 1e9)) })).sort((a, b) => a.orden - b.orden);
    const i = lista.findIndex(x => x.g === String(p.grupo));
    if (i < 0) throw new Error('Esa pareja no está en la lista de suplentes.');
    const j = sube ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return { ok: true };
    for (const [x, orden] of [[lista[i], lista[j].orden], [lista[j], lista[i].orden]]) {
      const { error } = await sb.from('evento_inscripciones').update({ suplente_orden: orden }).in('id', x.f.map(f => f.id));
      if (error) throw error;
    }
    return { ok: true };
  }
  const yo = posts.find(x => x.id === String(p.postulacion || ''));
  if (!yo || yo.estado !== 'no_elegido' || yo.suplente_orden == null) throw new Error('Ese postulado no está en la lista de suplentes.');
  const lista = posts.filter(x => x.puesto === yo.puesto && x.estado === 'no_elegido' && x.suplente_orden != null).sort((a, b) => a.suplente_orden - b.suplente_orden);
  const i = lista.indexOf(yo), j = sube ? i - 1 : i + 1;
  if (j < 0 || j >= lista.length) return { ok: true };
  for (const [x, orden] of [[lista[i], lista[j].suplente_orden], [lista[j], lista[i].suplente_orden]]) {
    const { error } = await sb.from('evento_postulaciones').update({ suplente_orden: orden }).eq('id', x.id);
    if (error) throw error;
  }
  return { ok: true };
}
