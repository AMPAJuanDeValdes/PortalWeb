// Mochila Jugona Exploradora: lo comparten Inicio (dashboard.html) y mochila.html.
// Necesita sb, getSession y SUPABASE_ANON_KEY (shared/supabaseClient.js).

async function mochilaEstado() {
  const { data, error } = await sb.rpc('mochila_mi_estado');
  if (error) throw error;
  return data;
}

// Acciones que pueden mandar el email de turno a otra familia: van por Netlify
async function mochilaNetlify(endpoint) {
  const session = await getSession();
  const resp = await fetch('/.netlify/functions/' + endpoint, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + session.access_token, 'x-supabase-anon-key': SUPABASE_ANON_KEY }
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
