// Sonido de toda la web (sintetizado en el navegador, sin archivos).
// Se activa con el botón «Sonido» y se recuerda al cambiar de página.
// Los navegadores no dejan sonar una página hasta que la persona la toca
// (clic, tecla o dedo): en cada página nueva, el primer toque lo reactiva.
// Va en todas las páginas: en la portada lo usa además shared/portada-vida.js.
(function () {
  const PENTA = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
  let guardado = false;
  try { guardado = localStorage.getItem('ampa-sonido') === '1'; } catch (e) { /* sin almacenamiento */ }

  const S = {
    PENTA,
    activo: guardado,   // lo que ha elegido la persona
    ctx: null, salida: null,
    get on() { return this.activo && !!this.ctx && this.ctx.state === 'running'; },
    preparar() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.salida = this.ctx.createGain(); this.salida.gain.value = 0.5;
        const comp = this.ctx.createDynamicsCompressor();
        this.salida.connect(comp); comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    ruidoBuffer() {
      if (this._ruido) return this._ruido;
      const n = this.ctx.sampleRate * 0.6, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return (this._ruido = b);
    },
    // Nota de marimba: seno + armónico corto
    nota(frec, cuando = 0, vol = 0.22, dur = 0.9) {
      if (!this.on) return;
      const t = this.ctx.currentTime + cuando;
      [[1, vol], [4, vol * 0.18]].forEach(([m, v]) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = frec * m;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (m === 1 ? dur : 0.15));
        o.connect(g); g.connect(this.salida); o.start(t); o.stop(t + dur + 0.05);
      });
    },
    ruido(tipo, frec, vol, dur, frecFin) {
      if (!this.on) return;
      const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.ruidoBuffer(); f.type = tipo; f.Q.value = 0.9;
      f.frequency.setValueAtTime(frec, t);
      if (frecFin) f.frequency.exponentialRampToValueAtTime(frecFin, t + dur * 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.salida); s.start(t); s.stop(t + dur + 0.05);
    },
    // Soplido de polvo de colores
    puff(fuerza = 1) { this.ruido('bandpass', 500 + Math.random() * 900, 0.5 * fuerza, 0.4, 180); this.nota(PENTA[Math.floor(Math.random() * PENTA.length)] * 2, 0.02, 0.07, 0.5); },
    papel() { this.ruido('highpass', 2500, 0.18, 0.12); },
    tic() { this.nota(1320, 0, 0.05, 0.12); },
    pulsar() { this.nota(PENTA[4] * 2, 0, 0.12, 0.35); this.nota(PENTA[6] * 2, 0.06, 0.08, 0.4); },
    acorde() { [0, 2, 4].forEach((k, i) => this.nota(PENTA[k] * 2, i * 0.09, 0.16, 1.2)); },
    letras(n) { for (let i = 0; i < n; i++) this.nota(PENTA[i % PENTA.length] * (i < 5 ? 2 : 4), i * 0.055, 0.1, 0.6); },
    // Al llegar a una página con el sonido puesto: dos notas suaves
    llegada() { this.nota(PENTA[2] * 2, 0, 0.09, 0.6); this.nota(PENTA[4] * 2, 0.1, 0.07, 0.7); }
  };

  /* ---------- Botón «Sonido» ---------- */
  const ICONO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4z"/><path class="on" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/><path class="off" d="M22 9l-6 6M16 9l6 6"/></svg>';
  function pintar(btn) { btn.setAttribute('aria-pressed', String(S.activo)); }
  function enlazar(btn) {
    if (!btn || btn.dataset.sonido) return;
    btn.dataset.sonido = '1';
    pintar(btn);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.activo = !S.activo;
      try { localStorage.setItem('ampa-sonido', S.activo ? '1' : '0'); } catch (er) { /* sin almacenamiento */ }
      document.querySelectorAll('[data-sonido]').forEach(pintar);
      if (S.activo) { S.preparar(); setTimeout(() => S.acorde(), 30); }
    });
  }
  // Crea el botón dentro de un contenedor (cabeceras de las páginas)
  function botonEn(cont) {
    if (!cont || cont.querySelector('[data-sonido], #sonidoBtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sonido'; b.setAttribute('aria-label', 'Sonido'); b.title = 'Sonido'; b.innerHTML = ICONO + '<span class="sonido-txt">Sonido</span>';
    cont.insertBefore(b, cont.lastElementChild);
    enlazar(b);
  }
  S.botonEn = botonEn;

  /* ---------- Reactivar con el primer toque de cada página ---------- */
  let primera = true;
  const despertar = () => {
    if (!S.activo) return;
    S.preparar();
    if (primera && S.ctx) { primera = false; const t = () => S.llegada(); S.ctx.state === 'running' ? t() : S.ctx.resume().then(t); }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, despertar, { capture: true, passive: true }));
  // Si el navegador ya lo permite sin tocar (p. ej. tras haber usado la web), suena al llegar
  if (S.activo) { try { S.preparar(); if (S.ctx && S.ctx.state === 'running') { primera = false; setTimeout(() => S.llegada(), 200); } } catch (e) { /* bloqueado hasta el primer toque */ } }

  /* ---------- Sonidos al pasar y pulsar ---------- */
  const SEL = 'a.btn, button.btn, .pill, .pub-links a, .barra-btn, .dock-btn, .menu a, .evento, .servicio, .car-botones button, .filtros button, .tipos label, [data-add]';
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest(SEL);
    if (!el || e.pointerType !== 'mouse' || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    S.tic();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('button, a.btn, .pill');
    if (el && !el.classList.contains('sonido')) S.pulsar();
  });

  /* ---------- Colocar el botón en cada página ---------- */
  // De paso: marcar en la cabecera pública la página en la que se está
  function marcarActual() {
    const aqui = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.pub-links a').forEach(a => { if (a.getAttribute('href') === aqui) a.setAttribute('aria-current', 'page'); });
  }
  function colocar() {
    marcarActual();
    document.querySelectorAll('#sonidoBtn, .sonido:not(#movBtn)').forEach(enlazar);
    botonEn(document.querySelector('.pub-links'));
    botonEn(document.querySelector('.barra-botones'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', colocar); else colocar();
  // La barra superior del portal la pinta nav.js después de comprobar la sesión
  const obs = new MutationObserver(() => {
    // Algunas páginas rehacen su cabecera al saber si hay sesión: se vuelve a poner
    const sin = (sel) => { const c = document.querySelector(sel); return c && !c.querySelector('[data-sonido], #sonidoBtn'); };
    if (sin('.barra-botones') || sin('.pub-links')) colocar();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 15000);

  window.AmpaSonido = S;
})();
