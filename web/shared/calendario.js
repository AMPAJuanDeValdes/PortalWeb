// Calendario del AMPA: un mes con los días que tienen eventos y, al lado,
// la lista de ese mes. Lo usan «Mi perfil» (todos los eventos) y la página
// de Lotería (solo los días de venta).
//   pintarCalendarioAMPA(cont, eventos, opciones)
//   eventos: [{ id, titulo, fecha, plantilla }]
//   opciones: { href(e) (null: sin enlace), detalle(e) → texto tras la hora, tituloLista(mes) }
// Los que ya han pasado (finEvento: a su hora de fin o 3 horas después de
// empezar) salen en gris y al final de la lista.
//   eventos: pueden traer fecha_fin (hora de fin).

const COLOR_TIPO_EVENTO = { warhammer: 'morado', chocolatada: 'rosa', cabalgata: 'cielo', juegos: 'amarillo', taller: 'amarillo', barbacoa: 'verde', comedor: 'morado', concurso: 'rosa', informativo: 'morado', loteria: 'verde' };
function colorEvento(e) {
  if (COLOR_TIPO_EVENTO[e.plantilla]) return COLOR_TIPO_EVENTO[e.plantilla];
  const paleta = ['verde', 'rosa', 'amarillo', 'cielo', 'morado'];
  return paleta[[...String(e.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % paleta.length];
}

function pintarCalendarioAMPA(cont, lista, opciones = {}) {
  const escCal = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const href = opciones.href === null ? null : (opciones.href || ((e) => 'eventos.html#ev-' + e.id));
  const detalle = opciones.detalle || (() => '');
  const tituloLista = opciones.tituloLista || ((mes) => 'Eventos de ' + mes);
  const vacioMes = opciones.vacioMes || 'Este mes no hay eventos';
  const eventos = lista.filter(e => e.fecha).map(e => ({ ...e, f: new Date(e.fecha) })).sort((a, b) => a.f - b.f);
  const claveDia = (d) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  const yaPasado = (e) => finEvento(e) < new Date();
  const flecha = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  cont.innerHTML = `<div class="calendario">
      <div>
        <div class="cal-cab">
          <button type="button" class="cal-ant" aria-label="Mes anterior">${flecha('M15 6l-6 6 6 6')}</button>
          <h3 class="cal-mes" aria-live="polite"></h3>
          <button type="button" class="cal-sig" aria-label="Mes siguiente">${flecha('M9 6l6 6-6 6')}</button>
        </div>
        <div class="cal-grid"></div>
      </div>
      <div class="cal-lista"><h3 class="cal-lista-tit"></h3><div class="cal-lista-cont"></div></div>
    </div>`;
  const $c = (s) => cont.querySelector(s);

  // Empieza en este mes si tiene eventos; si no, en el del próximo
  const hoy = new Date();
  const proximo = eventos.find(e => e.f >= new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  const hayEsteMes = eventos.some(e => e.f.getFullYear() === hoy.getFullYear() && e.f.getMonth() === hoy.getMonth());
  const inicio = hayEsteMes || !proximo ? hoy : proximo.f;
  let anio = inicio.getFullYear(), mes = inicio.getMonth();
  let diaMarcado = null;

  function pintar() {
    const primero = new Date(anio, mes, 1);
    const nombreMes = primero.toLocaleDateString('es-ES', { month: 'long' });
    $c('.cal-mes').textContent = nombreMes[0].toUpperCase() + nombreMes.slice(1) + ' ' + anio;
    const delMes = eventos.filter(e => e.f.getFullYear() === anio && e.f.getMonth() === mes);
    const porDia = {};
    delMes.forEach(e => (porDia[e.f.getDate()] = porDia[e.f.getDate()] || []).push(e));

    let html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span class="dsem" aria-hidden="true">${d}</span>`).join('');
    const hueco = (primero.getDay() + 6) % 7;
    for (let i = 0; i < hueco; i++) html += '<span class="cal-dia vacio"></span>';
    const dias = new Date(anio, mes + 1, 0).getDate();
    for (let d = 1; d <= dias; d++) {
      const evs = porDia[d];
      const esHoy = claveDia(new Date(anio, mes, d)) === claveDia(hoy) ? ' hoy' : '';
      if (evs) {
        const activos = evs.filter(e => !yaPasado(e));
        const pasado = activos.length ? '' : ' pasado';
        const etiqueta = `${d}: ${evs.map(e => e.titulo).join(', ')}${pasado ? ' (ya pasado)' : ''}`;
        html += `<button type="button" class="cal-dia con-evento d-${colorEvento(activos[0] || evs[0])}${pasado}${esHoy}" data-dia="${d}" aria-pressed="${diaMarcado === d}" aria-label="${escCal(etiqueta)}">${d}<span class="puntos">${evs.slice(0, 3).map(() => '<i></i>').join('')}</span></button>`;
      } else {
        html += `<span class="cal-dia${esHoy}">${d}</span>`;
      }
    }
    const grid = $c('.cal-grid');
    grid.innerHTML = html;
    grid.querySelectorAll('.con-evento').forEach(b => b.addEventListener('click', () => {
      const d = Number(b.dataset.dia);
      diaMarcado = diaMarcado === d ? null : d;
      pintar();
      const el = cont.querySelector(`.cal-ev[data-dia="${d}"]`);
      if (el && diaMarcado) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));

    $c('.cal-lista-tit').textContent = delMes.length ? tituloLista(nombreMes) : vacioMes;
    // Primero los que están por venir; los que ya han pasado, al final y en gris
    const fila = (e) => {
      const extra = detalle(e);
      return `
      <${href ? 'a' : 'div'} class="cal-ev d-${colorEvento(e)}${yaPasado(e) ? ' pasado' : ''}${diaMarcado === e.f.getDate() ? ' marcado' : ''}${href ? '' : ' sin-enlace'}" data-dia="${e.f.getDate()}"${href ? ` href="${escCal(href(e))}"` : ''}>
        <span class="chip"><b>${e.f.getDate()}</b><span>${e.f.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span></span>
        <span class="txt"><b>${escCal(e.titulo)}</b><span>${e.fecha_fin ? horarioEvento(e).replace(/^de /, '').replace(' a ', '–') : e.f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${yaPasado(e) ? ' · Ya pasado' : extra ? ' · ' + escCal(extra) : ''}</span></span>
      </${href ? 'a' : 'div'}>`;
    };
    const proximos = delMes.filter(e => !yaPasado(e)), pasados = delMes.filter(yaPasado).reverse();
    $c('.cal-lista-cont').innerHTML = delMes.length
      ? proximos.map(fila).join('') + (pasados.length ? `<p class="cal-pasados">${proximos.length ? 'Ya pasados' : 'Ya han pasado todos'}</p>` + pasados.map(fila).join('') : '')
      : '<p class="cal-nada">Usa las flechas para ver otros meses.</p>';
  }
  $c('.cal-ant').onclick = () => { mes--; if (mes < 0) { mes = 11; anio--; } diaMarcado = null; pintar(); };
  $c('.cal-sig').onclick = () => { mes++; if (mes > 11) { mes = 0; anio++; } diaMarcado = null; pintar(); };
  pintar();
}
