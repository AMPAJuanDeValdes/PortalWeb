// Avisos en el móvil y el ordenador (notificaciones push).
// Cada adulto los activa en sus dispositivos; la Junta avisa desde Eventos
// cuando hay una actividad nueva a la que pueden apuntarse sus hijos/as.
//   montarAvisos(contenedor)        → bloque para Mis datos
//   montarAvisoInicio(contenedor)   → invitación breve en Inicio (se puede cerrar)
// En iPhone/iPad solo funciona con la web añadida a la pantalla de inicio
// (iOS 16.4 o posterior).

const AVISOS = (() => {
  const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ua = navigator.userAgent || '';
  const esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const dispositivo = esIOS ? (/iPad/.test(ua) || navigator.maxTouchPoints > 1 && !/iPhone/.test(ua) ? 'iPad' : 'iPhone')
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Otro';
  return { soporta, esIOS, instalada, dispositivo };
})();

function _b64uABytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

async function _registroAvisos() {
  if (!AVISOS.soporta) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch (e) { return null; }
}

// 'activo' | 'disponible' | 'bloqueado' | 'instalar' (iPhone sin añadir) | 'no'
async function estadoAvisos() {
  if (!AVISOS.soporta) return AVISOS.esIOS && !AVISOS.instalada ? 'instalar' : 'no';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activo' : 'disponible';
}

async function activarAvisos() {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error(permiso === 'denied'
    ? 'Has bloqueado los avisos. Para activarlos, permite las notificaciones de esta web en los ajustes del navegador.'
    : 'No se han activado los avisos.');
  const r = await fetch('/.netlify/functions/push-clave');
  const { clave, error } = await r.json().catch(() => ({}));
  if (!r.ok || !clave) throw new Error(error || 'Los avisos todavía no están disponibles.');
  const reg = await _registroAvisos();
  if (!reg) throw new Error('Este navegador no permite avisos.');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Si se cambiaron las claves, la suscripción vieja ya no sirve
  if (sub && sub.options && sub.options.applicationServerKey) {
    const actual = new Uint8Array(sub.options.applicationServerKey), nueva = _b64uABytes(clave);
    if (actual.length !== nueva.length || actual.some((v, i) => v !== nueva[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64uABytes(clave) });
  await _guardarSuscripcion(sub);
}

async function _guardarSuscripcion(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('push_guardar_suscripcion', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: AVISOS.dispositivo
  });
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

async function desactivarAvisos() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  await sb.rpc('push_quitar_suscripcion', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// Si el dispositivo ya tenía los avisos activados, se vuelven a guardar a
// nombre de quien ha iniciado sesión (p. ej. un ordenador compartido)
async function refrescarAvisos() {
  try {
    if (!AVISOS.soporta || Notification.permission !== 'granted') return;
    const reg = await _registroAvisos();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await _guardarSuscripcion(sub);
  } catch (e) { /* no es importante */ }
}

const TEXTO_INSTALAR = 'En iPhone y iPad, primero añade esta web a la pantalla de inicio: pulsa el botón Compartir (el cuadrado con la flecha) y elige «Añadir a pantalla de inicio». Después ábrela desde ese icono, entra en Mis datos y activa los avisos.';

async function montarAvisos(cont) {
  const estado = await estadoAvisos();
  const texto = {
    activo: '<b>✓ Los avisos están activados en este dispositivo.</b> Os avisaremos cuando haya una actividad nueva a la que puedan apuntarse vuestros hijos/as.',
    disponible: 'Recibe un aviso en este móvil u ordenador cuando haya una actividad nueva a la que puedan apuntarse vuestros hijos/as.',
    bloqueado: 'Los avisos están bloqueados en este navegador. Para activarlos, permite las notificaciones de esta web en los ajustes del navegador y vuelve aquí.',
    instalar: TEXTO_INSTALAR,
    no: 'Este navegador no permite avisos. Prueba con Chrome, Edge, Firefox o Safari actualizados.'
  }[estado];
  cont.innerHTML = `<p style="margin:0;">${texto}</p>
    ${estado === 'disponible' ? '<button type="button" class="btn btn-primary avisosBtn" style="margin-top:12px;">Activar avisos en este dispositivo</button>' : ''}
    ${estado === 'activo' ? '<button type="button" class="btn btn-outline avisosBtn" style="margin-top:12px;">Desactivar en este dispositivo</button>' : ''}
    <p class="msg-error avisosMsg" hidden style="margin-top:10px;"></p>`;
  const btn = cont.querySelector('.avisosBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const msg = cont.querySelector('.avisosMsg'); msg.hidden = true;
    btn.disabled = true;
    try { if (estado === 'activo') await desactivarAvisos(); else await activarAvisos(); montarAvisos(cont); }
    catch (e) { msg.textContent = e.message; msg.hidden = false; btn.disabled = false; }
  });
}

// «Ahora no»: no se vuelve a preguntar en este dispositivo durante un mes.
// «No volver a preguntarme»: no se pregunta nunca más (queda el botón de la
// cabecera y Mis datos para activarlos cuando se quiera).
const AVISOS_PAUSA_DIAS = 30;
function avisosEnPausa() {
  try {
    if (localStorage.getItem('ampa-avisos-nunca') === '1') return true;
    const v = localStorage.getItem('ampa-avisos-ahora-no');
    return !!v && Date.now() - Number(v) < AVISOS_PAUSA_DIAS * 864e5;
  } catch (e) { return false; }
}
function pausarAvisos(nunca = false) {
  try {
    localStorage.setItem('ampa-avisos-ahora-no', String(Date.now()));
    if (nunca) localStorage.setItem('ampa-avisos-nunca', '1');
  } catch (e) {}
}

// Al entrar en la web (la primera vez que se abre Inicio en esta sesión del
// navegador): una pantalla breve para activar los avisos con un toque.
// El permiso del navegador solo puede pedirse al pulsar un botón.
async function preguntarAvisosAlEntrar() {
  let yaPreguntado = false;
  try { yaPreguntado = sessionStorage.getItem('ampa-avisos-preguntado') === '1'; sessionStorage.setItem('ampa-avisos-preguntado', '1'); } catch (e) {}
  if (yaPreguntado || avisosEnPausa()) return false;
  const estado = await estadoAvisos();
  if (!['disponible', 'instalar'].includes(estado)) return false;
  const d = document.createElement('dialog');
  d.className = 'dialogo-avisos';
  d.innerHTML = `<h2>¿Te avisamos de las actividades para tus hijos/as?</h2>
    <p>${estado === 'instalar' ? TEXTO_INSTALAR : 'Te llegará un aviso a este móvil u ordenador cuando haya una actividad nueva a la que puedan apuntarse. Puedes desactivarlo cuando quieras en Mis datos.'}</p>
    <p class="msg-error avisosMsg" hidden></p>
    <div class="avisos-botones">${estado === 'disponible' ? '<button type="button" class="btn btn-primary avisosSi">Sí, avisadme</button>' : '<button type="button" class="btn btn-primary avisosNo">Entendido</button>'}
      ${estado === 'disponible' ? '<button type="button" class="linklike avisosNo">Ahora no</button>' : ''}</div>
    <label class="avisos-nunca"><input type="checkbox" class="avisosNunca"> No volver a preguntarme</label>
    <p class="avisos-pie">Siempre puedes activarlos con el botón de la campana, arriba.</p>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  const nunca = () => d.querySelector('.avisosNunca') && d.querySelector('.avisosNunca').checked;
  d.addEventListener('cancel', () => pausarAvisos(nunca()));   // tecla Esc = «Ahora no»
  d.querySelector('.avisosNo').addEventListener('click', () => { pausarAvisos(nunca()); cerrar(); });
  const si = d.querySelector('.avisosSi');
  if (si) si.addEventListener('click', async () => {
    si.disabled = true;
    try {
      await activarAvisos();
      d.innerHTML = '<h2>✓ Avisos activados</h2><p>Te avisaremos de las actividades nuevas. Puedes desactivarlos cuando quieras en Mis datos.</p><div class="avisos-botones"><button type="button" class="btn btn-primary">Vale</button></div>';
      d.querySelector('button').addEventListener('click', cerrar);
    } catch (e) {
      const m = d.querySelector('.avisosMsg'); m.textContent = e.message; m.hidden = false; si.disabled = false;
    }
  });
  d.showModal();
  return true;
}

// En Inicio: solo si se pueden activar y no se ha dicho «Ahora no» este mes
async function montarAvisoInicio(cont) {
  const estado = await estadoAvisos();
  if (avisosEnPausa() || !['disponible', 'instalar'].includes(estado)) { cont.hidden = true; return; }
  cont.hidden = false;
  cont.innerHTML = `<div><b>¿Quieres que te avisemos de las actividades nuevas?</b>
      <p style="margin:4px 0 0;">${estado === 'instalar' ? TEXTO_INSTALAR : 'Te llegará un aviso al móvil o al ordenador cuando haya una actividad a la que puedan apuntarse tus hijos/as.'}</p>
      <p class="msg-error avisosMsg" hidden style="margin:8px 0 0;"></p></div>
    <div class="avisos-botones">${estado === 'disponible' ? '<button type="button" class="btn btn-primary avisosSi">Activar avisos</button>' : ''}
      <button type="button" class="linklike avisosNo">Ahora no</button></div>`;
  cont.querySelector('.avisosNo').addEventListener('click', () => { pausarAvisos(); cont.hidden = true; });
  const si = cont.querySelector('.avisosSi');
  if (si) si.addEventListener('click', async () => {
    si.disabled = true;
    try { await activarAvisos(); cont.innerHTML = '<p style="margin:0;"><b>✓ Avisos activados.</b> Puedes desactivarlos cuando quieras en Mis datos.</p>'; }
    catch (e) { const m = cont.querySelector('.avisosMsg'); m.textContent = e.message; m.hidden = false; si.disabled = false; }
  });
}

/* ---------- Botón de la campana en la cabecera (como el del sonido) ---------- */
const ICONO_AVISOS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path class="off" d="M3 3l18 18"/></svg>';

function avisoBreve(texto) {
  let t = document.querySelector('.avisos-toast');
  if (!t) { t = document.createElement('div'); t.className = 'avisos-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = texto; t.classList.add('visible');
  clearTimeout(avisoBreve.reloj); avisoBreve.reloj = setTimeout(() => t.classList.remove('visible'), 4500);
}

async function montarBotonAvisos(cont) {
  if (!cont || cont.querySelector('.avisos-btn')) return;
  const estado = await estadoAvisos();
  if (estado === 'no') return;   // navegador sin avisos: no se muestra
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'barra-btn avisos-btn';
  b.innerHTML = ICONO_AVISOS + '<span class="vh">Avisos</span>';
  const pintar = (st) => {
    b.setAttribute('aria-pressed', String(st === 'activo'));
    b.title = st === 'activo' ? 'Avisos activados en este dispositivo (pulsa para desactivarlos)' : 'Activar los avisos de actividades nuevas';
  };
  pintar(estado);
  b.addEventListener('click', async () => {
    const st = await estadoAvisos();
    if (st === 'instalar') { avisoBreve(TEXTO_INSTALAR); return; }
    if (st === 'bloqueado') { avisoBreve('Los avisos están bloqueados en este navegador. Permite las notificaciones de esta web en los ajustes del navegador.'); return; }
    b.disabled = true;
    try {
      if (st === 'activo') { await desactivarAvisos(); avisoBreve('Avisos desactivados en este dispositivo.'); }
      else { await activarAvisos(); avisoBreve('✓ Avisos activados. Te avisaremos de las actividades nuevas.'); }
    } catch (e) { avisoBreve(e.message); }
    b.disabled = false;
    pintar(await estadoAvisos());
    // Si en la página está el bloque de Mis datos o la invitación de Inicio, se actualizan
    const zona = document.getElementById('avisosZona'); if (zona) montarAvisos(zona);
    const inv = document.getElementById('avisoAvisos'); if (inv && await estadoAvisos() === 'activo') inv.hidden = true;
  });
  // Antes del botón de cerrar sesión
  cont.insertBefore(b, cont.querySelector('.barra-salir') || null);
}
