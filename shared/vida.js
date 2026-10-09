// Vida en todas las páginas.
// · Al cambiar de página: una nube de polvo de colores que tapa la pantalla
//   y, en la página nueva, se disipa desde el centro hacia fuera.
// · Al pulsar en cualquier sitio: una explosión de polvo y figuras de colores,
//   como en la portada.
// · Títulos que entran palabra a palabra y tarjetas que aparecen al llegar.
// Con el botón «Movimiento» de la portada apagado, todo queda quieto.
(function () {
  const html = document.documentElement;
  try { if (localStorage.getItem('ampa-movimiento') === '0') html.classList.add('quieto'); } catch (e) { /* sin almacenamiento */ }
  const quieto = () => html.classList.contains('quieto');
  const esPortada = !!document.querySelector('script[src*="portada-vida.js"]');
  const COLORES = ['#FF4D8D', '#FF7A1A', '#FFC21A', '#3FB54A', '#00A3E0', '#8A5CC2'];
  const FIGURAS = ['circulo', 'triangulo', 'pentagono', 'rombo', 'hexagono', 'estrella'];
  const azar = (a) => a[Math.floor(Math.random() * a.length)];

  /* ---------- Cambio de página: nube de polvo de colores ---------- */
  function telon(x, y, saliendo) {
    const t = document.createElement('div');
    t.className = 'telon' + (saliendo ? ' telon-fuera' : '');
    t.setAttribute('aria-hidden', 'true');
    const W = innerWidth, H = innerHeight, cols = W < 700 ? 4 : 7, filas = Math.ceil(H / (W / cols)) + 1;
    const lado = W / cols, maxD = Math.hypot(W, H);
    let k = 0, frag = '';
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
      const cx = (c + .5) * lado + (f % 2 ? lado / 2 : 0), cy = (f + .5) * lado;
      const d = Math.hypot(cx - x, cy - y) / maxD;          // las cercanas al dedo, primero
      frag += `<i style="left:${cx}px;top:${cy}px;width:${lado * 3}px;height:${lado * 3}px;--c:${azar(COLORES)};--d:${Math.round(d * 130)}ms"></i>`;
      k++;
    }
    t.innerHTML = frag;
    document.body.appendChild(t);
    return t;
  }
  let llegada = null;
  try { llegada = JSON.parse(sessionStorage.getItem('ampa-telon') || 'null'); sessionStorage.removeItem('ampa-telon'); } catch (e) { /* sin almacenamiento */ }
  if (llegada && !quieto() && Date.now() - llegada < 4000) {
    const t = telon(innerWidth / 2, innerHeight / 2, true);
    setTimeout(() => t.remove(), 400);
  }
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || quieto()) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.sinOla !== undefined) return;
    const crudo = a.getAttribute('href') || '';
    if (crudo.startsWith('#') || /^(javascript|mailto|tel):/i.test(crudo)) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.hash) return;
    e.preventDefault();
    telon(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2, false);
    try { sessionStorage.setItem('ampa-telon', JSON.stringify(Date.now())); } catch (er) { /* sin almacenamiento */ }
    setTimeout(() => { location.href = url.href; }, 150);
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) document.querySelectorAll('.telon').forEach(t => t.remove()); });

  /* ---------- Al pulsar: polvo y figuras de colores ---------- */
  function explosion(x, y) {
    const capa = document.createElement('div');
    capa.className = 'chispas'; capa.setAttribute('aria-hidden', 'true');
    let frag = '';
    for (let i = 0; i < 28; i++) {
      const ang = Math.random() * Math.PI * 2, d = 70 + Math.random() * 150;
      const polvo = i < 8;                        // nubecitas difuminadas, como el polvo del logo
      const t = polvo ? 34 + Math.random() * 40 : 12 + Math.random() * 16;
      frag += `<i class="${polvo ? 'polvo' : 'f-' + azar(FIGURAS)}" style="left:${x}px;top:${y}px;width:${t}px;height:${t}px;background:${azar(COLORES)};--x:${(Math.cos(ang) * d).toFixed(0)}px;--y:${(Math.sin(ang) * d - 20).toFixed(0)}px;--r:${Math.round(Math.random() * 540 - 270)}deg"></i>`;
    }
    capa.innerHTML = frag;
    document.body.appendChild(capa);
    setTimeout(() => capa.remove(), 950);
    if (window.AmpaSonido) window.AmpaSonido.puff(0.5);
  }
  if (!esPortada) {
    document.addEventListener('pointerdown', (e) => {
      if (quieto() || e.button !== 0) return;
      if (e.target.closest && e.target.closest('input, textarea, select, label, [contenteditable], .firma-pad, canvas')) return;
      explosion(e.clientX, e.clientY);
    });
  }

  if (esPortada) return;   // lo demás, la portada ya lo tiene a su manera
  html.classList.add('con-vida');

  /* ---------- Título que entra palabra a palabra ---------- */
  function animarTitulos() {
    document.querySelectorAll('.cab-servicio h1, .wrap > h1, .con-polvo h1').forEach(h => {
      if (h.dataset.vida || h.children.length) return;
      h.dataset.vida = '1';
      const pal = h.textContent.trim().split(/\s+/);
      h.setAttribute('aria-label', h.textContent.trim());
      h.innerHTML = pal.map((p, i) => `<span class="vida-pal" aria-hidden="true" style="--i:${i}">${p}</span>`).join(' ');
    });
  }

  /* ---------- Tarjetas que aparecen al llegar ---------- */
  const SEL = '.card, .evento-card, .hijo-card, .juego, .servicio, .redes > a, .don, .stock-fila, .pasos > li, .cal, .junta-tile, .es-donacion';
  const obs = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('vida-visto'); obs.unobserve(e.target);
  }), { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }) : null;
  let orden = 0, reloj = null;
  function preparar(raiz) {
    if (!obs || quieto()) return;
    (raiz.matches && raiz.matches(SEL) ? [raiz] : []).concat([...(raiz.querySelectorAll ? raiz.querySelectorAll(SEL) : [])]).forEach(el => {
      if (el.classList.contains('vida-entra') || el.closest('.dock, .barra, dialog')) return;
      el.style.setProperty('--d', Math.min(orden++, 8) * 70 + 'ms');
      el.classList.add('vida-entra');
      obs.observe(el);
    });
    clearTimeout(reloj); reloj = setTimeout(() => { orden = 0; }, 400);
  }

  function iniciar() {
    animarTitulos();
    preparar(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && !n.classList.contains('chispas') && !n.classList.contains('telon')) { preparar(n); if ((n.matches && n.matches('h1')) || (n.querySelector && n.querySelector('h1'))) animarTitulos(); } })))
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
