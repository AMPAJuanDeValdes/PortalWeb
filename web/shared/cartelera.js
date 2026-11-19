/* Cartelera de eventos (eventos.html y publico.html)
   Los eventos se ven como una cartelera de cine: cada uno es un cartel con
   su título y su fecha. Al pulsarlo se abre el evento entero en una ventana.
   La tarjeta de siempre (.evento-card) no cambia: se le añade arriba el cartel
   (.ev-tile) y, al abrirla, se mueve a la ventana y luego vuelve a su sitio.
   El cartel sale de card.dataset.cartel (eventos.cartel_url); si el evento no
   tiene, se pinta uno con el color y el icono del evento. */
(function () {
  let dialogo = null, hueco = null, abierta = null;

  const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fechaDe(card) {
    const p = card.querySelector('.ev-hora, .evento-fecha');
    if (!p) return '';
    // Solo el día y la hora: el lugar se ve al abrir el evento
    return p.textContent.split('. Lugar:')[0].trim();
  }

  function prepararTarjeta(card) {
    if (!card.classList || !card.classList.contains('evento-card') || card.querySelector(':scope > .ev-tile')) return;
    const titulo = (card.querySelector('h2') || {}).textContent || '';
    const fecha = fechaDe(card);
    const url = card.dataset.cartel;
    // Nombre que se pone sobre el cartel (eventos.cartel_nombre); si no hay, el título
    const nombre = card.dataset.cartelNombre || titulo;
    if (![...card.classList].some(c => c.startsWith('t-'))) {
      const PALETA = [['#E6F2D8', '#3F6E12'], ['#FBE3EE', '#A3245E'], ['#FCF1CC', '#7A5A00'], ['#DDF0F8', '#0F5F7F'], ['#ECE4F7', '#5B3A8E']];
      const h = [...card.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      card.style.setProperty('--t-bg', PALETA[h % PALETA.length][0]);
      card.style.setProperty('--t', PALETA[h % PALETA.length][1]);
    }
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ev-tile';
    tile.setAttribute('aria-haspopup', 'dialog');
    let cartel;
    if (url) {
      cartel = `<span class="ev-poster"><img src="${escHtml(url)}" alt="" loading="lazy"><span class="ev-poster-overlay">${escHtml(nombre)}</span></span>`;
    } else {
      // Sin cartel: el color y el icono del evento, con el nombre bien grande y la fecha
      const f = card.dataset.fecha ? new Date(card.dataset.fecha) : null;
      const icono = card.querySelector('.ev-icono');
      cartel = `<span class="ev-poster ev-poster-vacio">
          ${icono ? icono.outerHTML : ''}
          <span class="ev-poster-titulo">${escHtml(nombre)}</span>
          ${f && !isNaN(f) ? `<span class="ev-poster-dia">${escHtml(f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>` : ''}
        </span>`;
    }
    tile.innerHTML = `${cartel}<span class="ev-tile-tit">${escHtml(titulo)}</span>${fecha ? `<span class="ev-tile-fecha">${escHtml(fecha)}</span>` : ''}`;
    tile.addEventListener('click', () => abrir(card));
    card.prepend(tile);
    // Dentro de la ventana, el cartel se ve grande debajo de la cabecera
    if (url && !card.querySelector('.ev-cartel-grande')) {
      const grande = document.createElement('a');
      grande.className = 'ev-cartel-grande';
      grande.href = url; grande.target = '_blank'; grande.rel = 'noopener';
      grande.innerHTML = `<img src="${escHtml(url)}" alt="Cartel de ${escHtml(titulo)}" loading="lazy">`;
      const tras = card.querySelector(':scope > .ev-cab, :scope > h2');
      if (tras) tras.after(grande); else card.append(grande);
    }
  }

  function crearDialogo() {
    dialogo = document.createElement('dialog');
    dialogo.className = 'ev-dialogo';
    dialogo.innerHTML = '<button type="button" class="ev-cerrar" aria-label="Cerrar">×</button><div class="ev-dialogo-cuerpo"></div>';
    dialogo.querySelector('.ev-cerrar').addEventListener('click', () => dialogo.close());
    // Pulsar fuera de la ventana también la cierra
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
    // (si ya se ha abierto otro evento, el «close» atrasado no lo devuelve)
    dialogo.addEventListener('close', () => { if (!dialogo.open) devolver(); });
    document.body.appendChild(dialogo);
    // Si la tarjeta se repinta con la ventana abierta, la nueva también lleva el cartel grande
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => prepararTarjeta(n))))
      .observe(dialogo.querySelector('.ev-dialogo-cuerpo'), { childList: true });
  }

  // La tarjeta vuelve a la cartelera (si se ha repintado dentro, vuelve la nueva)
  function devolver() {
    if (!hueco) return; // ya devuelta
    const cuerpo = dialogo.querySelector('.ev-dialogo-cuerpo');
    const card = cuerpo.querySelector('.evento-card') || abierta;
    if (hueco && card) { hueco.replaceWith(card); prepararTarjeta(card); }
    hueco = null; abierta = null;
    document.documentElement.classList.remove('dialogo-abierto');
    if (/^#ev-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  function abrir(card) {
    if (!card) return;
    if (!dialogo) crearDialogo();
    if (dialogo.open) { devolver(); dialogo.close(); } // abre otro evento desde dentro de uno
    hueco = document.createComment('evento');
    card.replaceWith(hueco);
    abierta = card;
    const cuerpo = dialogo.querySelector('.ev-dialogo-cuerpo');
    cuerpo.innerHTML = '';
    cuerpo.appendChild(card);
    document.documentElement.classList.add('dialogo-abierto');
    dialogo.showModal();
    cuerpo.scrollTop = 0; dialogo.scrollTop = 0;
    if (card.id) history.replaceState(null, '', '#' + card.id);
  }

  function montarCartelera(cont) {
    cont.classList.add('cartelera');
    cont.querySelectorAll(':scope > .evento-card').forEach(prepararTarjeta);
    // Las tarjetas que se repintan (al apuntarse, etc.) vuelven a tener su cartel
    if (!cont._observador) {
      cont._observador = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => prepararTarjeta(n))));
      cont._observador.observe(cont, { childList: true });
    }
  }

  window.montarCartelera = montarCartelera;
  window.abrirEventoCartelera = abrir;
})();
