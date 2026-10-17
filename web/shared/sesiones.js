// Cursos por sesiones (p. ej. el Curso de Warhammer 40,000): un alumno/a se
// apunta una vez y va a todas las sesiones, aunque se apunte con el curso
// empezado. Las fechas de las sesiones las publica la Junta poco a poco.

const ES_CURSO = (ev) => ev && ev.plantilla === 'warhammer';

// { eventoId: [sesiones ordenadas por número] }
async function cargarSesiones(eventoIds) {
  const porEvento = {};
  if (!eventoIds.length) return porEvento;
  const { data } = await sb.from('evento_sesiones').select('*').in('evento_id', eventoIds).order('numero');
  (data || []).forEach(s => (porEvento[s.evento_id] = porEvento[s.evento_id] || []).push(s));
  return porEvento;
}

// La siguiente sesión con fecha (de hoy en adelante), o null
function proximaSesion(sesiones) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return (sesiones || []).filter(s => s.fecha && new Date(s.fecha) >= hoy)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0] || null;
}

// Terminado: todas las sesiones tienen fecha y ya han pasado
function cursoTerminado(sesiones) {
  return !!(sesiones && sesiones.length) && sesiones.every(s => s.fecha) && !proximaSesion(sesiones);
}

// Para listados por fecha: la de la próxima sesión (o null si aún no hay fechas)
function fechaVisibleCurso(ev, sesiones) {
  const p = proximaSesion(sesiones);
  return p ? p.fecha : null;
}

// coincide: { sesion_id: 'texto' } con los talleres que son a la misma hora
function htmlSesiones(sesiones, coincide = {}) {
  if (!sesiones || !sesiones.length) return '';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const prox = proximaSesion(sesiones);
  return `<ol class="sesiones">${sesiones.map(s => {
    const f = s.fecha ? new Date(s.fecha) : null;
    const cuando = f ? f.toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Fecha por publicar';
    const estado = prox && s.id === prox.id ? ' proxima' : f && f < hoy ? ' pasada' : '';
    return `<li class="sesion${estado}"><details><summary><span class="s-num">${s.numero}</span>
      <span class="s-tit">${esc(s.titulo)}<small>${esc(cuando)}${estado === ' proxima' ? ' · próxima sesión' : ''}${coincide[s.id] ? ' · coincide con ' + esc(coincide[s.id]) : ''}</small></span></summary>
      ${s.contenido ? `<p class="s-cont">${esc(s.contenido)}</p>` : ''}</details></li>`;
  }).join('')}</ol>`;
}
