/* Editor para recortar el cartel de un evento (admin-eventos.html).
   recortarCartel(file) abre una ventana con la imagen dentro de un marco
   vertical 2:3 (el formato de la cartelera). Se arrastra para moverla y se
   usa el control de zoom para acercarla. Devuelve un File JPEG de 1000×1500
   con el recorte, o null si se cancela. */
(function () {
  const ANCHO = 1000, ALTO = 1500;   // tamaño del cartel recortado (2:3)

  function crear() {
    const d = document.createElement('dialog');
    d.className = 'recorte-dialogo';
    d.innerHTML = `
      <h2>Recortar el cartel</h2>
      <p class="ayuda">Arrastra la imagen para elegir qué parte se ve y usa el zoom para acercarla. Lo que queda dentro del marco es el cartel.</p>
      <div class="recorte-marco"><img alt=""></div>
      <label class="recorte-zoom">Zoom <input type="range" min="1" max="4" step="0.01" value="1"></label>
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

      const limitar = () => {
        const w = img.naturalWidth * esc, h = img.naturalHeight * esc;
        x = Math.min(0, Math.max(W - w, x));
        y = Math.min(0, Math.max(H - h, y));
      };
      const pintar = () => {
        limitar();
        img.style.width = img.naturalWidth * esc + 'px';
        img.style.height = img.naturalHeight * esc + 'px';
        img.style.transform = `translate(${x}px, ${y}px)`;
      };
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
        base = Math.max(W / img.naturalWidth, H / img.naturalHeight);   // la imagen cubre el marco
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
        g.fillStyle = '#fff'; g.fillRect(0, 0, ANCHO, ALTO);
        g.drawImage(img, -x / esc, -y / esc, W / esc, H / esc, 0, 0, ANCHO, ALTO);
        c.toBlob(b => fin(b ? new File([b], 'cartel.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.88);
      };
    });
  };
})();
