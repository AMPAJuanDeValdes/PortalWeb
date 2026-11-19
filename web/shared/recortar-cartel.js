/* Editor para recortar el cartel de un evento (admin-eventos.html).
   recortarCartel(file) abre una ventana con la imagen dentro de un marco
   vertical 2:3 (el formato de la cartelera). Se arrastra para moverla y se
   usa el control de zoom para acercarla o alejarla: alejada (p. ej. una
   imagen horizontal entera), lo que sobra del marco son bordes blancos o
   transparentes (PNG). Devuelve un File JPEG de 1000×1500
   con el recorte, o null si se cancela. */
(function () {
  const ANCHO = 1000, ALTO = 1500;   // tamaño del cartel recortado (2:3)

  function crear() {
    const d = document.createElement('dialog');
    d.className = 'recorte-dialogo';
    d.innerHTML = `
      <h2>Recortar el cartel</h2>
      <p class="ayuda">Arrastra la imagen para moverla y usa el zoom para acercarla o alejarla. Lo que sobra del marco son los bordes.</p>
      <div class="recorte-marco"><img alt=""></div>
      <div class="recorte-fondo"><span>Bordes</span>
        <label><input type="radio" name="recorteFondo" value="blanco" checked> Blancos</label>
        <label><input type="radio" name="recorteFondo" value="transparente"> Transparentes</label></div>
      <label class="recorte-zoom">Zoom <input type="range" min="0.3" max="4" step="0.01" value="1"></label>
      <div class="recorte-acciones">
        <button type="button" class="btn btn-outline recorte-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary recorte-ok">Usar este recorte</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  window.recortarCartel = function (file) {
    return new Promise((resolve) => {
      const d = document.querySelector('.recorte-dialogo') || crear();
      const marco = d.querySelector('.recorte-marco');
      const img = marco.querySelector('img');
      const zoom = d.querySelector('input[type=range]');
      const url = URL.createObjectURL(file);
      let W, H, base, esc = 1, x = 0, y = 0, terminado = false;

      // Más grande que el marco: no deja huecos. Más pequeña: no se sale del marco.
      const limitar = () => {
        const w = img.naturalWidth * esc, h = img.naturalHeight * esc;
        x = w >= W ? Math.min(0, Math.max(W - w, x)) : Math.max(0, Math.min(W - w, x));
        y = h >= H ? Math.min(0, Math.max(H - h, y)) : Math.max(0, Math.min(H - h, y));
      };
      const pintar = () => {
        limitar();
        img.style.width = img.naturalWidth * esc + 'px';
        img.style.height = img.naturalHeight * esc + 'px';
        img.style.transform = `translate(${x}px, ${y}px)`;
      };
      const fondo = () => (d.querySelector('input[name=recorteFondo]:checked') || {}).value;
      const pintarFondo = () => marco.classList.toggle('transparente', fondo() === 'transparente');
      d.querySelectorAll('input[name=recorteFondo]').forEach(r => { r.onchange = pintarFondo; });
      pintarFondo();
      const fin = (res) => {
        if (terminado) return;
        terminado = true;
        marco.onpointerdown = marco.onpointermove = marco.onpointerup = marco.onpointercancel = null;
        zoom.oninput = null;
        d.querySelector('.recorte-ok').onclick = d.querySelector('.recorte-cancelar').onclick = d.oncancel = null;
        if (d.open) d.close();
        URL.revokeObjectURL(url);
        resolve(res);
      };

      img.onerror = () => { alert('No se puede abrir esa imagen. Prueba con un JPG o un PNG.'); fin(null); };
      img.onload = () => {
        d.showModal();
        W = marco.clientWidth; H = marco.clientHeight;
        base = Math.max(W / img.naturalWidth, H / img.naturalHeight);   // zoom 1: la imagen cubre el marco
        // Se puede alejar hasta ver la imagen entera dentro del marco (y un poco más)
        const entera = Math.min(W / img.naturalWidth, H / img.naturalHeight) / base;
        zoom.min = Math.min(1, +(entera * 0.8).toFixed(2));
        zoom.value = 1; esc = base;
        x = (W - img.naturalWidth * esc) / 2; y = (H - img.naturalHeight * esc) / 2;
        pintar();
      };
      img.src = url;

      // Zoom manteniendo el centro del marco
      zoom.oninput = () => {
        const nueva = base * Number(zoom.value);
        const cx = (W / 2 - x) / esc, cy = (H / 2 - y) / esc;
        esc = nueva; x = W / 2 - cx * esc; y = H / 2 - cy * esc;
        pintar();
      };
      // Arrastrar (ratón o dedo)
      let arrastre = null;
      marco.onpointerdown = (e) => { arrastre = { px: e.clientX, py: e.clientY, x, y }; marco.setPointerCapture(e.pointerId); };
      marco.onpointermove = (e) => { if (!arrastre) return; x = arrastre.x + e.clientX - arrastre.px; y = arrastre.y + e.clientY - arrastre.py; pintar(); };
      marco.onpointerup = marco.onpointercancel = () => { arrastre = null; };

      d.querySelector('.recorte-cancelar').onclick = () => fin(null);
      d.oncancel = (e) => { e.preventDefault(); fin(null); };
      d.querySelector('.recorte-ok').onclick = () => {
        const c = document.createElement('canvas');
        c.width = ANCHO; c.height = ALTO;
        const g = c.getContext('2d');
        const transparente = fondo() === 'transparente';
        if (!transparente) { g.fillStyle = '#fff'; g.fillRect(0, 0, ANCHO, ALTO); }
        // Se pinta la imagen donde está en el marco, a escala del cartel (fuera, blanco)
        const k = ANCHO / W;
        g.drawImage(img, x * k, y * k, img.naturalWidth * esc * k, img.naturalHeight * esc * k);
        // Con bordes transparentes, PNG (el JPG no tiene transparencia)
        c.toBlob(b => fin(b ? new File([b], transparente ? 'cartel.png' : 'cartel.jpg', { type: b.type }) : null), transparente ? 'image/png' : 'image/jpeg', 0.88);
      };
    });
  };
})();
