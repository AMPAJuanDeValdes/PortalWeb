// Movimiento y sonido de la portada (index.html).
// El polvo de colores del logo cobra vida: partículas que reaccionan al ratón
// y al dedo, una cinta arcoíris que se dibuja al bajar, fotos que pasan solas
// y sonidos suaves (solo si la persona activa «Sonido»).
// Con «reducir movimiento» del sistema todo queda quieto y legible.
(function () {
  const calma = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORES = ['#FF4D8D', '#FF7A1A', '#FFC21A', '#3FB54A', '#00A3E0', '#8A5CC2'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ================= Sonido (sintetizado, sin archivos) ================= */
  const sonido = {
    ctx: null, on: false, salida: null,
    preparar() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.salida = this.ctx.createGain(); this.salida.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.salida.connect(comp); comp.connect(this.ctx.destination);
    },
    ruidoBuffer() {
      if (this._ruido) return this._ruido;
      const n = this.ctx.sampleRate * 0.6, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return (this._ruido = b);
    },
    // Nota de marimba: seno + armónico corto
    nota(frec, cuando = 0, vol = 0.22, dur = 0.9) {
      if (!this.on || !this.ctx) return;
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
    // Soplido de polvo: ruido filtrado
    puff(fuerza = 1) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.ruidoBuffer();
      f.type = 'bandpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(500 + Math.random() * 900, t);
      f.frequency.exponentialRampToValueAtTime(180, t + 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * fuerza, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      s.connect(f); f.connect(g); g.connect(this.salida); s.start(t); s.stop(t + 0.45);
      this.nota(PENTA[Math.floor(Math.random() * PENTA.length)] * 2, 0.02, 0.07, 0.5);
    },
    papel() {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.ruidoBuffer(); f.type = 'highpass'; f.frequency.value = 2500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      s.connect(f); f.connect(g); g.connect(this.salida); s.start(t); s.stop(t + 0.15);
    },
    tic() { this.nota(1320, 0, 0.05, 0.12); },
    acorde() { [0, 2, 4].forEach((k, i) => this.nota(PENTA[k] * 2, i * 0.09, 0.16, 1.2)); },
    letras(n) { for (let i = 0; i < n; i++) this.nota(PENTA[i % PENTA.length] * (i < 5 ? 2 : 4), i * 0.055, 0.1, 0.6); }
  };
  const PENTA = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];

  function montarBotonSonido() {
    const btn = document.getElementById('sonidoBtn');
    if (!btn) return;
    let guardado = false;
    try { guardado = localStorage.getItem('ampa-sonido') === '1'; } catch (e) { /* sin almacenamiento */ }
    const poner = (v) => {
      sonido.on = v; btn.setAttribute('aria-pressed', String(v));
      try { localStorage.setItem('ampa-sonido', v ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    };
    btn.addEventListener('click', () => {
      sonido.preparar();
      if (sonido.ctx && sonido.ctx.state === 'suspended') sonido.ctx.resume();
      poner(!sonido.on);
      if (sonido.on) sonido.acorde();
    });
    // El navegador no deja sonar hasta que la persona toca la página
    if (guardado) {
      btn.setAttribute('aria-pressed', 'true');
      const despertar = () => { sonido.preparar(); if (sonido.ctx) sonido.ctx.resume(); sonido.on = true; };
      window.addEventListener('pointerdown', despertar, { once: true, capture: true });
      window.addEventListener('keydown', despertar, { once: true, capture: true });
    }
    document.querySelectorAll('.menu a, .pill, .car-botones button, .evento').forEach(el => el.addEventListener('pointerenter', () => sonido.tic()));
  }

  /* ================= Polvo de colores (canvas) ================= */
  class Polvo {
    constructor(canvas, cfg) {
      this.c = canvas; this.g = canvas.getContext('2d'); this.cfg = cfg;
      this.p = []; this.chispas = []; this.raton = { x: -1e4, y: -1e4 };
      this.sprites = {}; this.visible = true; this.t0 = performance.now();
      (cfg.colores || COLORES).forEach(col => { this.sprites[col] = this.sprite(col); });
      this.redimensionar(true);
      new ResizeObserver(() => this.redimensionar(false)).observe(canvas);
      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.bucle(); }).observe(canvas);
      const zona = cfg.zona || canvas.parentElement;
      zona.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.raton.x = e.clientX - r.left; this.raton.y = e.clientY - r.top; });
      zona.addEventListener('pointerleave', () => { this.raton.x = this.raton.y = -1e4; });
      zona.addEventListener('pointerdown', (e) => {
        if (e.target.closest('a, button, input, textarea, label')) return;
        const r = canvas.getBoundingClientRect();
        this.explosion(e.clientX - r.left, e.clientY - r.top, 46);
        sonido.puff();
      });
      if (calma) this.dibujar(); else this.bucle();
    }
    sprite(col) {
      const s = document.createElement('canvas'); s.width = s.height = 64;
      const g = s.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, col); rg.addColorStop(0.35, col + 'CC'); rg.addColorStop(1, col + '00');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64); return s;
    }
    redimensionar(inicio) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = this.c.clientWidth; this.h = this.c.clientHeight;
      if (!this.w || !this.h) return;
      this.c.width = this.w * dpr; this.c.height = this.h * dpr;
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = this.cfg.cantidad(this.w);
      const cols = this.cfg.colores || COLORES;
      while (this.p.length < n) this.p.push({ fase: Math.random() * 6.28, vel: 0.4 + Math.random(), vx: 0, vy: 0, col: cols[0], r: 4, a: 0.8, sem: Math.random() });
      this.p.length = n;
      this.p.forEach((q, i) => {
        const h = this.cfg.casa(i, n, this.w, this.h, q);
        q.hx = h.x; q.hy = h.y; q.r = h.r; q.a = h.a; q.col = h.col;
        if (inicio) {
          const o = this.cfg.origen ? this.cfg.origen(this.w, this.h) : null;
          if (o && !calma) { q.x = o.x + (Math.random() - 0.5) * 40; q.y = o.y + (Math.random() - 0.5) * 30; }
          else { q.x = q.hx; q.y = q.hy; }
        }
      });
      if (calma || !this.animando) this.dibujar();
    }
    explosion(x, y, n) {
      if (calma) return;
      const cols = this.cfg.colores || COLORES;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * 6.283, v = 2 + Math.random() * 9;
        this.chispas.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 1.5, r: 5 + Math.random() * 22, col: cols[Math.floor(Math.random() * cols.length)], vida: 1 });
      }
      // Las partículas cercanas también salen despedidas
      this.p.forEach(q => { const dx = q.x - x, dy = q.y - y, d = Math.hypot(dx, dy) || 1; if (d < 220) { q.vx += dx / d * (220 - d) * 0.09; q.vy += dy / d * (220 - d) * 0.09; } });
      this.bucle();
    }
    bucle() {
      if (calma || this.animando) return;
      this.animando = true;
      const paso = (ts) => {
        if (!this.visible) { this.animando = false; return; }
        this.mover(ts); this.dibujar();
        requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }
    mover(ts) {
      const t = (ts - this.t0) * 0.001, R = this.cfg.radioRaton || 130, deriva = this.cfg.deriva || 14;
      const { x: mx, y: my } = this.raton;
      for (const q of this.p) {
        const tx = q.hx + Math.sin(t * 0.6 * q.vel + q.fase) * deriva;
        const ty = q.hy + Math.cos(t * 0.5 * q.vel + q.fase * 1.3) * deriva + (this.cfg.subir ? -((t * 12 * q.vel + q.sem * this.h) % (this.h + 80)) + this.h * q.sem : 0);
        q.vx += (tx - q.x) * 0.012; q.vy += (ty - q.y) * 0.012;
        const dx = q.x - mx, dy = q.y - my, d2 = dx * dx + dy * dy;
        if (d2 < R * R) { const d = Math.sqrt(d2) || 1, f = (R - d) / R; q.vx += dx / d * f * 2.4; q.vy += dy / d * f * 2.4; }
        q.vx *= 0.9; q.vy *= 0.9; q.x += q.vx; q.y += q.vy;
      }
      for (const c of this.chispas) { c.x += c.vx; c.y += c.vy; c.vx *= 0.94; c.vy = c.vy * 0.94 + 0.06; c.vida -= 0.011; c.r *= 1.008; }
      this.chispas = this.chispas.filter(c => c.vida > 0);
    }
    dibujar() {
      const g = this.g; g.clearRect(0, 0, this.w, this.h);
      for (const q of this.p) { g.globalAlpha = q.a; g.drawImage(this.sprites[q.col], q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
      for (const c of this.chispas) { g.globalAlpha = Math.max(0, c.vida) * 0.85; g.drawImage(this.sprites[c.col], c.x - c.r, c.y - c.r, c.r * 2, c.r * 2); }
      g.globalAlpha = 1;
    }
  }

  // Inicio: un anillo de polvo alrededor del logo, con los colores del logo
  function polvoInicio() {
    const canvas = document.getElementById('polvoHero'), logo = document.querySelector('.hero-logo');
    if (!canvas || !logo) return null;
    const centroLogo = () => {
      const rc = canvas.getBoundingClientRect(), rl = logo.getBoundingClientRect();
      // getBoundingClientRect incluye la animación de entrada: se usa el tamaño de diseño
      const w = logo.offsetWidth || rl.width, h = logo.offsetHeight || rl.height;
      return { x: rl.left + rl.width / 2 - rc.left, y: rl.top + rl.height / 2 - rc.top, w, h };
    };
    return new Polvo(canvas, {
      cantidad: (w) => w < 700 ? 190 : 380,
      origen: () => { const c = centroLogo(); return { x: c.x, y: c.y }; },
      casa: (i, n, W, H) => {
        const c = centroLogo();
        const ang = Math.random() * Math.PI * 2;
        const lejos = Math.random() < 0.3;
        const k = lejos ? 1.25 + Math.random() * 1.6 : 0.82 + (Math.random() + Math.random() - 1) * 0.22;
        const x = c.x + Math.cos(ang) * c.w * 0.55 * k, y = c.y + Math.sin(ang) * c.h * 0.55 * k;
        // arriba: verde → amarillo → naranja → rosa; abajo: amarillo → rosa → morado → azul (como el logo)
        const u = (Math.cos(ang) + 1) / 2;
        const fila = Math.sin(ang) < 0 ? ['#3FB54A', '#FFC21A', '#FF7A1A', '#FF4D8D'] : ['#FFC21A', '#FF4D8D', '#8A5CC2', '#00A3E0'];
        const col = fila[clamp(Math.floor(u * 4 + (Math.random() - 0.5) * 1.2), 0, 3)];
        const grande = Math.random() < 0.12;
        return { x: clamp(x, -20, W + 20), y: clamp(y, -20, H + 20), r: grande ? 26 + Math.random() * 30 : 3 + Math.random() * 10, a: grande ? 0.16 : (lejos ? 0.35 : 0.7), col };
      }
    });
  }

  // Hazte socio: polvo claro que sube despacio sobre el rosa
  function polvoSocio() {
    const canvas = document.getElementById('polvoSocio');
    if (!canvas) return null;
    return new Polvo(canvas, {
      colores: ['#FFFFFF', '#FFC21A', '#FFD6E5', '#FF7A1A'],
      cantidad: (w) => w < 700 ? 70 : 150,
      deriva: 26, radioRaton: 160,
      casa: (i, n, W, H) => {
        const cols = ['#FFFFFF', '#FFC21A', '#FFD6E5', '#FF7A1A'];
        const grande = Math.random() < 0.15;
        return { x: Math.random() * W, y: Math.random() * H, r: grande ? 24 + Math.random() * 30 : 2 + Math.random() * 7, a: grande ? 0.14 : 0.55, col: cols[i % 4] };
      }
    });
  }

  /* ================= Cinta arcoíris ================= */
  const cinta = { svg: null, path: null, largo: 0, tabla: [], y0: 0, yFin: 1 };
  function recalcularCinta() {
    const svg = document.getElementById('cinta'), path = document.getElementById('cintaPath');
    if (!svg || !path) return;
    cinta.svg = svg; cinta.path = path;
    const W = document.documentElement.clientWidth;
    svg.style.height = '0px'; svg.setAttribute('height', 0);
    const H = document.body.scrollHeight;
    svg.setAttribute('height', H); svg.style.height = H + 'px';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const yAbs = (el) => el.getBoundingClientRect().top + window.scrollY;
    const hero = document.getElementById('hero');
    const secciones = [...document.querySelectorAll('main > section')].filter(s => s !== hero && !s.hidden && s.offsetParent !== null);
    if (!hero || !secciones.length) return;
    const margen = W < 700 ? 9 : clamp((W - 1200) / 2 + 12, 22, 200);
    const izq = margen, der = W - margen;
    const acciones = hero.querySelector('.hero-acciones:not([style*="none"])') || hero;
    let x = W / 2, y = yAbs(hero) + hero.offsetHeight - 24;
    cinta.y0 = y - 40;
    let d = `M ${x} ${y}`, lado = 0;
    secciones.forEach((s) => {
      const t = yAbs(s), nx = lado % 2 === 0 ? izq : der;
      if (t - 70 > y) d += ` L ${x} ${t - 70}`;
      const yy = Math.max(y, t - 70);
      d += ` C ${x} ${yy + 70}, ${nx} ${yy + 40}, ${nx} ${yy + 120}`;
      x = nx; y = yy + 120; lado++;
    });
    const fin = yAbs(document.querySelector('.pie-web')) - 10;
    d += ` L ${x} ${fin}`;
    cinta.yFin = fin;
    path.setAttribute('d', d);
    // Degradado arcoíris que se repite a lo largo de la página
    const grad = document.getElementById('arco');
    grad.setAttribute('y2', H);
    const vueltas = Math.max(2, Math.round(H / 900));
    let stops = '';
    for (let v = 0; v <= vueltas * 6; v++) stops += `<stop offset="${(v / (vueltas * 6)).toFixed(4)}" stop-color="${COLORES[v % 6]}"/>`;
    grad.innerHTML = stops;
    cinta.largo = path.getTotalLength();
    path.style.strokeDasharray = cinta.largo;
    // Tabla altura → longitud para dibujarla según lo que se ha bajado
    cinta.tabla = [];
    for (let i = 0; i <= 300; i++) { const l = cinta.largo * i / 300; cinta.tabla.push([path.getPointAtLength(l).y, l]); }
    moverCinta();
  }
  function moverCinta() {
    if (!cinta.path || !cinta.largo) return;
    if (calma) { cinta.path.style.strokeDashoffset = 0; return; }
    const objetivo = window.scrollY + window.innerHeight * 0.72;
    let l = 0;
    for (const [y, len] of cinta.tabla) { if (y <= objetivo) l = Math.max(l, len); }
    cinta.path.style.strokeDashoffset = cinta.largo - l;
  }

  /* ================= Fotos que pasan solas ================= */
  function muroVivo(muro, o) {
    let parado = calma || !o.enMovimiento, encima = false, arrastre = null, movido = 0;
    const velocidad = 0.45;
    const mitad = () => muro.scrollWidth / 2;
    const ponerPausa = (v) => { parado = v; if (o.pausa) { o.pausa.setAttribute('aria-pressed', String(v)); o.pausa.textContent = v ? 'Mover' : 'Parar'; } };
    if (calma && o.pausa) ponerPausa(true);
    o.pausa && o.pausa.addEventListener('click', () => ponerPausa(!parado));
    const paso = () => Math.min(muro.clientWidth * 0.8, 420);
    o.ant && o.ant.addEventListener('click', () => { sonido.papel(); muro.scrollBy({ left: -paso(), behavior: calma ? 'auto' : 'smooth' }); });
    o.sig && o.sig.addEventListener('click', () => { sonido.papel(); muro.scrollBy({ left: paso(), behavior: calma ? 'auto' : 'smooth' }); });
    muro.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') encima = true; });
    muro.addEventListener('pointerleave', () => { encima = false; });
    muro.addEventListener('focusin', () => { encima = true; });
    muro.addEventListener('focusout', () => { encima = false; });
    // Arrastrar con el ratón (con el dedo ya se desliza solo)
    muro.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      arrastre = { x: e.clientX, s: muro.scrollLeft }; movido = 0; muro.classList.add('arrastrando');
    });
    window.addEventListener('pointermove', (e) => {
      if (!arrastre) return;
      movido = Math.abs(e.clientX - arrastre.x);
      muro.scrollLeft = arrastre.s - (e.clientX - arrastre.x);
    });
    window.addEventListener('pointerup', () => { arrastre = null; muro.classList.remove('arrastrando'); });
    muro.addEventListener('click', (e) => {
      const b = e.target.closest('.polaroid'); if (!b || movido > 6) return;
      o.alPulsar(Number(b.dataset.k));
    });
    muro.addEventListener('pointerover', (e) => { if (e.target.closest('.polaroid') && e.pointerType === 'mouse' && !e.relatedTarget?.closest?.('.polaroid')) sonido.papel(); });
    if (!o.enMovimiento) return;
    let acumulado = 0;
    const avanzar = () => {
      if (!parado && !encima && !arrastre) {
        acumulado += velocidad;
        if (acumulado >= 1) { muro.scrollLeft += Math.floor(acumulado); acumulado -= Math.floor(acumulado); }
      }
      if (muro.scrollLeft >= mitad()) muro.scrollLeft -= mitad();
      else if (muro.scrollLeft <= 0 && o.enMovimiento) muro.scrollLeft += mitad();
      requestAnimationFrame(avanzar);
    };
    muro.scrollLeft = 1;
    requestAnimationFrame(avanzar);
  }

  /* ================= Servicios que pasan de lado ================= */
  function carril() {
    const c = document.getElementById('carril'), pista = document.getElementById('pista');
    if (!c || !pista) return;
    const paneles = [...pista.children];
    const activar = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('activo'); }), { threshold: 0.55 });
    paneles.forEach(p => activar.observe(p));
    let ultimo = -1;
    const mover = () => {
      if (calma || window.innerWidth <= 820) { pista.style.transform = ''; return; }
      const r = c.getBoundingClientRect();
      const recorrido = c.offsetHeight - window.innerHeight;
      const p = clamp(-r.top / recorrido, 0, 1);
      const sobra = pista.scrollWidth - window.innerWidth;
      pista.style.transform = `translate3d(${-p * sobra}px,0,0)`;
      // Una nota por panel al llegar a él
      const k = Math.round(p * (paneles.length - 1));
      if (k !== ultimo && r.top < 0 && r.bottom > window.innerHeight) { if (ultimo !== -1) sonido.nota(PENTA[k * 2 % PENTA.length], 0, 0.12, 0.9); ultimo = k; }
    };
    return mover;
  }

  /* ================= Apariciones, letras, botones ================= */
  let obsAparece = null;
  function observarApariciones() {
    if (!obsAparece) {
      obsAparece = new IntersectionObserver((es) => es.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('visto'); obsAparece.unobserve(e.target);
        if (e.target.id === 'gigante') { sonido.letras(e.target.querySelectorAll('.l').length); const p = window.Vida._socio; if (p) setTimeout(() => p.explosion(p.w * 0.3, p.h * 0.25, 70), 350); }
      }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    }
    document.querySelectorAll('.aparece:not(.visto), #gigante:not(.visto), #pasosSocio:not(.visto), #listaJunta:not(.visto)').forEach(el => obsAparece.observe(el));
  }
  function partirTitulo() {
    const h1 = document.getElementById('titulo');
    if (h1) { const pal = h1.textContent.trim().split(/\s+/); h1.innerHTML = pal.map((p, i) => `<span class="pal" style="--i:${i}">${p}</span>`).join(' '); }
    const gig = document.getElementById('gigante');
    if (gig) { gig.innerHTML = [...gig.textContent].map((ch, i) => ch === ' ' ? ' ' : `<span class="l" aria-hidden="true" style="--i:${i}">${ch}</span>`).join(''); }
  }
  function magneticos() {
    if (calma || !window.matchMedia('(hover: hover)').matches) return;
    document.querySelectorAll('.magnetico').forEach(b => {
      b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`; });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }
  // El botón flotante aparece al dejar atrás el inicio y se esconde en la escena de Hazte socio y al final
  function flotante() {
    const f = document.getElementById('flotante'), hero = document.getElementById('hero'), escena = document.getElementById('hazte-socio'), pie = document.querySelector('.pie-web');
    if (!f || !hero) return () => {};
    return () => {
      const pasado = hero.getBoundingClientRect().bottom < 80;
      const vh = window.innerHeight;
      const enEscena = escena && (() => { const r = escena.getBoundingClientRect(); return r.top < vh && r.bottom > 0; })();
      const enPie = pie && pie.getBoundingClientRect().top < vh - 40;
      f.classList.toggle('ver', pasado && !enEscena && !enPie);
    };
  }

  function iniciar() {
    partirTitulo();
    montarBotonSonido();
    polvoInicio();
    window.Vida._socio = polvoSocio();
    observarApariciones();
    magneticos();
    const moverCarril = carril() || (() => {});
    const moverFlotante = flotante();
    let pendiente = false;
    const alBajar = () => {
      if (pendiente) return; pendiente = true;
      requestAnimationFrame(() => { pendiente = false; moverCinta(); moverCarril(); moverFlotante(); });
    };
    window.addEventListener('scroll', alBajar, { passive: true });
    let tRes = null;
    window.addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(() => { recalcularCinta(); alBajar(); }, 150); });
    // Las fuentes y las imágenes cambian la altura: se recalcula al cargar
    window.addEventListener('load', recalcularCinta);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recalcularCinta);
    new ResizeObserver(() => { clearTimeout(tRes); tRes = setTimeout(recalcularCinta, 120); }).observe(document.body);
    recalcularCinta(); alBajar();
  }

  window.Vida = { iniciar, sonido, muroVivo, observarApariciones, recalcularCinta: () => { requestAnimationFrame(recalcularCinta); }, _socio: null };
})();
