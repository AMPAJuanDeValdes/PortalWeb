// Botones «Avisar a las familias» (aviso en el móvil) y «Enviar circular»
// (email en Borradores del buzón del AMPA) para las convocatorias del Banco
// de Uniformes y del Banco de Libros.
//   montarDifusion(cont, { tipo: 'uniformes' | 'libros', convocatoria })
// Junto a cada botón se ve cuántas veces se ha hecho y cuándo fue la última
// (tabla difusiones); al pasar el ratón, la lista completa.

// Historial de avisos y circulares: Map ref_id → filas (la más reciente primero)
async function cargarDifusiones(tipo, ids) {
  const mapa = new Map();
  let q = sb.from('difusiones').select('ref_id, canal, familias, creado_por_nombre, created_at').eq('tipo', tipo).order('created_at', { ascending: false });
  if (ids && ids.length === 1) q = q.eq('ref_id', ids[0]);
  const { data } = await q;
  (data || []).forEach(d => { if (!mapa.has(d.ref_id)) mapa.set(d.ref_id, []); mapa.get(d.ref_id).push(d); });
  return mapa;
}
// { texto: «2 veces · la última, 18/10/26 21:30», titulo: lista completa } o null si nunca
function resumenDifusion(lista, canal) {
  const filas = (lista || []).filter(d => d.canal === canal);
  if (!filas.length) return null;
  const f = (x) => new Date(x).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const veces = filas.length === 1 ? '1 vez' : filas.length + ' veces';
  return {
    texto: `${canal === 'aviso' ? 'Avisado' : 'Circular preparada'} ${veces} · la última, ${f(filas[0].created_at)}`,
    titulo: filas.map(d => `${f(d.created_at)}${d.familias != null ? ` · ${d.familias} familias` : ''}${d.creado_por_nombre ? ` · ${d.creado_por_nombre}` : ''}`).join('\n')
  };
}
// Pone el resumen junto al botón (y la lista completa como tooltip)
function pintarResumenDifusion(boton, info, lista, canal) {
  if (!boton) return;
  const r = resumenDifusion(lista, canal);
  boton.title = r ? r.titulo : (canal === 'aviso' ? 'Todavía no se ha avisado' : 'Todavía no se ha preparado ninguna circular');
  if (info) { info.textContent = r ? r.texto : ''; info.title = r ? r.titulo : ''; info.hidden = !r; }
}

function montarDifusion(cont, { tipo, convocatoria }) {
  const c = convocatoria;
  if (!cont || !c) return;
  const abierta = c.estado === 'abierta' && new Date(c.fecha_cierre) > new Date();
  const fecha = (f) => new Date(f).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  cont.innerHTML = `<div class="difusion">
      ${abierta ? '<span class="difusion-par"><button type="button" class="btn btn-outline" data-d="avisar">Avisar a las familias</button><small class="difusion-info" data-i="aviso" hidden></small></span>' : ''}
      <span class="difusion-par"><button type="button" class="btn btn-outline" data-d="circular">Enviar circular</button><small class="difusion-info" data-i="circular" hidden></small></span>
    </div>
    <p class="difusion-msg" hidden></p>`;
  let historial = [];
  const refrescar = async () => {
    historial = (await cargarDifusiones(tipo, [c.id])).get(c.id) || [];
    pintarResumenDifusion(cont.querySelector('[data-d=avisar]'), cont.querySelector('[data-i=aviso]'), historial, 'aviso');
    pintarResumenDifusion(cont.querySelector('[data-d=circular]'), cont.querySelector('[data-i=circular]'), historial, 'circular');
  };
  refrescar();
  const msg = cont.querySelector('.difusion-msg');
  const mostrar = (texto, ok) => { msg.hidden = false; msg.className = 'difusion-msg ' + (ok ? 'msg-ok' : 'msg-error'); msg.textContent = texto; };
  const llamar = async (funcion, cuerpo) => {
    const session = await getSession();
    const resp = await fetch('/.netlify/functions/' + funcion, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify(cuerpo)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'No se pudo hacer.');
    return data;
  };
  const nombre = tipo === 'libros' ? 'Banco de Libros' : 'Banco de Uniformes';

  cont.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    msg.hidden = true;
    const texto = b.textContent;
    b.disabled = true; b.textContent = 'Un momento...';
    try {
      if (b.dataset.d === 'avisar') {
        const cuenta = await llamar('push-avisar-convocatoria', { tipo, convocatoriaId: c.id, soloContar: true });
        if (!cuenta.dispositivos) { mostrar(`Hay ${cuenta.familias} familias a las que les interesa, pero ninguna tiene los avisos activados todavía.`, false); return; }
        const previos = resumenDifusion(historial, 'aviso');
        const ya = previos ? `\n\nOjo: ${previos.texto.toLowerCase()}; les llegará otra vez.` : '';
        if (!confirm(`Se avisará en el móvil de la convocatoria del ${nombre} a ${cuenta.familiasConAviso} familias (${cuenta.dispositivos} dispositivos).${ya}\n\n¿Enviar?`)) return;
        const r = await llamar('push-avisar-convocatoria', { tipo, convocatoriaId: c.id });
        mostrar(`Avisadas ${r.familiasConAviso} familias (${r.enviados} dispositivos${r.fallidos ? `, ${r.fallidos} no se pudieron avisar` : ''}).`, !r.fallidos);
      } else {
        if (!confirm(`Se va a preparar un email con la convocatoria del ${nombre} y se dejará en Borradores del correo del AMPA para que lo reviséis y lo enviéis desde allí. ¿Seguir?`)) return;
        const r = await llamar('circular-borrador', { tipo, convocatoriaId: c.id });
        mostrar(`Circular «${r.asunto}» guardada en «${r.carpeta}» del correo del AMPA. Ábrela allí, revísala, pon los destinatarios y envíala.`, true);
      }
    } catch (err) {
      mostrar(err.message, false);
    } finally {
      b.disabled = false; b.textContent = texto;
      refrescar();
    }
  });
}
