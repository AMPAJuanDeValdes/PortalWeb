// Mochila Jugona Exploradora: lo comparten Inicio (dashboard.html) y mochila.html.
// Necesita sb, getSession y SUPABASE_ANON_KEY (shared/supabaseClient.js).

// Horarios de la Mochila Jugona Exploradora (los viernes). Los cambia la Junta
// (mochila_config); mientras se leen, o si no se pueden leer, valen estos.
let MOCHILA_HORA_RECOGIDA = 'de 17:30 a 18:00';
let MOCHILA_HORA_DEVOLUCION = 'de 16:00 a 16:30';
const mochilaHora = (t) => String(t || '').slice(0, 5);
const mochilaTramo = (desde, hasta) => `de ${mochilaHora(desde)} a ${mochilaHora(hasta)}`;
let mochilaHorarioCargado = null;
// Lee el horario una vez y lo pone también en los textos fijos de la página
// (elementos con data-mochila-hora="recogida" o "devolucion")
function mochilaHorario() {
  if (!mochilaHorarioCargado) mochilaHorarioCargado = (async () => {
    const { data } = await sb.from('mochila_config').select('recogida_desde, recogida_hasta, devolucion_desde, devolucion_hasta').eq('id', 1).maybeSingle();
    if (data && data.recogida_desde) {
      MOCHILA_HORA_RECOGIDA = mochilaTramo(data.recogida_desde, data.recogida_hasta);
      MOCHILA_HORA_DEVOLUCION = mochilaTramo(data.devolucion_desde, data.devolucion_hasta);
    }
    document.querySelectorAll('[data-mochila-hora]').forEach(el => {
      el.textContent = el.dataset.mochilaHora === 'recogida' ? MOCHILA_HORA_RECOGIDA : MOCHILA_HORA_DEVOLUCION;
    });
  })().catch(() => {});
  return mochilaHorarioCargado;
}

async function mochilaEstado() {
  await mochilaHorario();
  const { data, error } = await sb.rpc('mochila_mi_estado');
  if (error) throw error;
  return data;
}

// Acciones que pueden mandar el email de turno a otra familia: van por Netlify
async function mochilaNetlify(endpoint, cuerpo) {
  const session = await getSession();
  const resp = await fetch('/.netlify/functions/' + endpoint, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + session.access_token, 'x-supabase-anon-key': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo || {})
  });
  let data = {};
  try { data = await resp.json(); } catch (e) { /* respuesta no JSON */ }
  if (!resp.ok) throw new Error(data.error || 'No se pudo completar la acción (error ' + resp.status + '). Inténtalo de nuevo en unos minutos.');
  return data;
}

async function mochilaApuntarse() {
  const { error } = await sb.from('mochila_cola').insert({ tipo: 'socio', socio_id: ctxGlobal.socio.id });
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Ya estáis en la lista.' : error.message);
}
async function mochilaConfirmar() {
  const { error } = await sb.rpc('mochila_confirmar');
  if (error) throw new Error(error.message);
}
const mochilaEsperarSemana = () => mochilaNetlify('mochila-posponer');
async function mochilaDesapuntarse() {
  if (!confirm('¿Seguro que queréis salir de la lista de la Mochila Jugona Exploradora? Si volvéis a apuntaros, entraréis al final.')) return false;
  await mochilaNetlify('mochila-desapuntarse');
  return true;
}

function mochilaLimite(est) {
  if (!est.notificado_en) return '';
  const fin = new Date(new Date(est.notificado_en).getTime() + 24 * 3600 * 1000);
  return fin.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + ' a las ' +
    fin.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function mochilaFecha(f) {
  return new Date(f + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}
function mochilaFamilias(n) { return n === 1 ? 'familia' : 'familias'; }

// Botones del turno: «La queremos» y, si hay alguien detrás, «Esperar una semana más»
function mochilaBotonesTurno(cont, est, alTerminar) {
  cont.innerHTML = `<div class="mochila-acciones">
      <button type="button" class="btn btn-cta" data-a="si">La queremos</button>
      ${est.hay_detras ? '<button type="button" class="btn btn-outline" data-a="esperar">Esperar una semana más</button>' : ''}
    </div>
    <p class="msg-error" hidden></p>`;
  const err = cont.querySelector('.msg-error');
  cont.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    cont.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
      if (b.dataset.a === 'si') await mochilaConfirmar(); else await mochilaEsperarSemana();
      alTerminar();
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      cont.querySelectorAll('button').forEach(x => x.disabled = false);
    }
  }));
}
