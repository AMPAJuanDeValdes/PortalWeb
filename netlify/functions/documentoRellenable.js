// Sistema de documentos rellenables y firmables para eventos.
// Expone 3 funciones globales, usadas por admin-eventos.html y eventos.html:
//
//   renderizarPaginaPDF(pdfUrl, numeroPagina) -> Promise<{dataUrl, width, height}>
//     Renderiza una página de un PDF como imagen (usa PDF.js, cargado
//     dinámicamente desde CDN la primera vez que hace falta).
//
//   abrirEditorPlantilla(contenedorDOM, dataUrlFondo, camposExistentes, onGuardar)
//     UI de admin: mostrar la página, marcar dónde va cada dato con un
//     clic, y guardar la plantilla (llama a onGuardar(campos)).
//
//   abrirFormularioRelleno(contenedorDOM, dataUrlFondo, campos, persona, onCompletar)
//     UI de socio: mostrar la página con los campos ya colocados como
//     inputs de verdad (rellenos con los datos de `persona` cuando el
//     tipo de campo coincide), más un pad de firma. Al confirmar,
//     compone una sola imagen PNG con todo y llama a
//     onCompletar(blob, datosFinales, avisoDiferencias).
//
// Cada "campo" es: { id, tipo, xPct, yPct } — la posición es en % del
// ancho/alto de la imagen, así funciona igual en cualquier pantalla.

const TIPOS_CAMPO = [
  { id: 'nombre', label: 'Nombre' },
  { id: 'apellidos', label: 'Apellidos' },
  { id: 'dni_nie', label: 'DNI/NIE' },
  { id: 'fecha_nacimiento', label: 'F. nacimiento' },
  { id: 'texto', label: 'Texto libre' },
  { id: 'fecha_hoy', label: 'Fecha de hoy' },
  { id: 'firma', label: 'Firma' }
];

function etiquetaTipo(tipo) {
  const t = TIPOS_CAMPO.find(x => x.id === tipo);
  return t ? t.label : tipo;
}

function generarIdCampo() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'campo_' + Date.now() + '_' + Math.random().toString(36).slice(2));
}

/* ==================== 1. Renderizar página de PDF ==================== */

let pdfjsCargando = null;
function cargarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (pdfjsCargando) return pdfjsCargando;
  pdfjsCargando = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    script.onerror = () => reject(new Error('No se pudo cargar la librería de PDF.'));
    document.head.appendChild(script);
  });
  return pdfjsCargando;
}

async function renderizarPaginaPDF(pdfUrl, numeroPagina) {
  await cargarPdfJs();
  const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
  if (numeroPagina < 1 || numeroPagina > pdf.numPages) {
    throw new Error(`El PDF solo tiene ${pdf.numPages} página(s).`);
  }
  const page = await pdf.getPage(numeroPagina);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
}

/* ==================== 2. Editor de plantilla (admin) ==================== */

function abrirEditorPlantilla(contenedor, dataUrlFondo, camposExistentes, onGuardar) {
  let campos = (camposExistentes || []).map(c => ({ ...c }));
  let tipoActual = TIPOS_CAMPO[0].id;

  contenedor.innerHTML = `
    <div class="doc-editor-toolbar" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
      ${TIPOS_CAMPO.map(t => `<button type="button" class="btn btn-outline tipoBtn" data-tipo="${t.id}">${t.label}</button>`).join('')}
    </div>
    <p style="font-size:12.5px; color:var(--ink-soft); margin:0 0 10px;">
      Elige un tipo de campo arriba y haz clic en el documento para colocarlo. Haz clic en un campo ya puesto para borrarlo.
    </p>
    <div style="position:relative; display:inline-block; max-width:100%;">
      <img class="doc-editor-img" src="${dataUrlFondo}" style="max-width:100%; display:block;">
      <div class="doc-campos-overlay" style="position:absolute; inset:0;"></div>
    </div>
    <button type="button" class="btn btn-primary guardarPlantillaBtn" style="margin-top:14px;">Guardar plantilla</button>
  `;

  const img = contenedor.querySelector('.doc-editor-img');
  const overlay = contenedor.querySelector('.doc-campos-overlay');
  const botonesTipo = contenedor.querySelectorAll('.tipoBtn');

  function marcarBotonActivo() {
    botonesTipo.forEach(b => b.classList.toggle('btn-primary', b.dataset.tipo === tipoActual));
  }
  marcarBotonActivo();

  function pintarMarcadores() {
    overlay.innerHTML = '';
    campos.forEach((c, idx) => {
      const marcador = document.createElement('div');
      marcador.className = 'doc-campo-marcador';
      marcador.style.left = c.xPct + '%';
      marcador.style.top = c.yPct + '%';
      marcador.style.cursor = 'pointer';
      marcador.textContent = etiquetaTipo(c.tipo);
      marcador.title = 'Clic para borrar este campo';
      marcador.addEventListener('click', (e) => {
        e.stopPropagation();
        campos.splice(idx, 1);
        pintarMarcadores();
      });
      overlay.appendChild(marcador);
    });
  }
  pintarMarcadores();

  botonesTipo.forEach(btn => {
    btn.addEventListener('click', () => { tipoActual = btn.dataset.tipo; marcarBotonActivo(); });
  });

  img.addEventListener('click', (e) => {
    const rect = img.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    campos.push({ id: generarIdCampo(), tipo: tipoActual, xPct, yPct });
    pintarMarcadores();
  });

  contenedor.querySelector('.guardarPlantillaBtn').addEventListener('click', () => onGuardar(campos));
}

/* ==================== 3. Formulario de relleno + firma (socio) ==================== */

function valorDePersonaParaTipo(tipo, persona) {
  switch (tipo) {
    case 'nombre': return persona.nombre || '';
    case 'apellidos': return persona.apellidos || '';
    case 'dni_nie': return persona.dni_nie || '';
    case 'fecha_nacimiento': return persona.fecha_nacimiento || '';
    default: return '';
  }
}
function esCampoIdentidad(tipo) {
  return ['nombre', 'apellidos', 'dni_nie', 'fecha_nacimiento'].includes(tipo);
}

function abrirPadFirma(onFirmar) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:200; padding:20px;';
  modal.innerHTML = `
    <div style="background:#fff; padding:20px; border-radius:4px; max-width:360px; width:100%;">
      <p class="section-label">Firma aquí</p>
      <canvas class="firmaCanvas" width="300" height="140" style="border:1px solid var(--line); touch-action:none; width:100%; background:#fff; display:block;"></canvas>
      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline borrarFirmaBtn">Borrar</button>
        <button type="button" class="btn btn-primary usarFirmaBtn">Usar esta firma</button>
        <button type="button" class="btn-danger-link cancelarFirmaBtn">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const canvas = modal.querySelector('.firmaCanvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1A1A18';
  let dibujando = false, huboTrazo = false;

  function posicion(e) {
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width, escalaY = canvas.height / rect.height;
    const punto = e.touches ? e.touches[0] : e;
    return { x: (punto.clientX - rect.left) * escalaX, y: (punto.clientY - rect.top) * escalaY };
  }
  function empezar(e) { dibujando = true; huboTrazo = true; const p = posicion(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
  function mover(e) { if (!dibujando) return; const p = posicion(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
  function terminar() { dibujando = false; }

  canvas.addEventListener('mousedown', empezar);
  canvas.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', terminar);
  canvas.addEventListener('touchstart', empezar, { passive: false });
  canvas.addEventListener('touchmove', mover, { passive: false });
  canvas.addEventListener('touchend', terminar);

  modal.querySelector('.borrarFirmaBtn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    huboTrazo = false;
  });
  modal.querySelector('.cancelarFirmaBtn').addEventListener('click', () => modal.remove());
  modal.querySelector('.usarFirmaBtn').addEventListener('click', () => {
    if (!huboTrazo) { alert('Dibuja tu firma antes de continuar.'); return; }
    onFirmar(canvas.toDataURL('image/png'));
    modal.remove();
  });
}

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar una imagen del documento.'));
    img.src = src;
  });
}

async function componerDocumentoFinal(dataUrlFondo, campos, estado) {
  const imgFondo = await cargarImagen(dataUrlFondo);
  const canvas = document.createElement('canvas');
  canvas.width = imgFondo.naturalWidth;
  canvas.height = imgFondo.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgFondo, 0, 0);

  ctx.font = Math.round(canvas.width * 0.014) + 'px sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  for (const c of campos) {
    const x = (c.xPct / 100) * canvas.width;
    const y = (c.yPct / 100) * canvas.height;
    if (c.tipo === 'firma') {
      if (estado[c.id]) {
        const imgFirma = await cargarImagen(estado[c.id]);
        const anchoFirma = canvas.width * 0.16;
        const altoFirma = anchoFirma * (imgFirma.naturalHeight / imgFirma.naturalWidth);
        ctx.drawImage(imgFirma, x, y, anchoFirma, altoFirma);
      }
    } else {
      ctx.fillText(String(estado[c.id] || ''), x, y);
    }
  }

  return new Promise(resolve => canvas.toBlob(blob => resolve({ blob }), 'image/png'));
}

function abrirFormularioRelleno(contenedor, dataUrlFondo, campos, persona, onCompletar) {
  const estado = {};
  const valoresOriginales = {};

  contenedor.innerHTML = `
    <div style="position:relative; display:inline-block; max-width:100%;">
      <img class="doc-fill-img" src="${dataUrlFondo}" style="max-width:100%; display:block;">
      <div class="doc-campos-overlay" style="position:absolute; inset:0;"></div>
    </div>
    <button type="button" class="btn btn-primary confirmarBtn" style="margin-top:14px;">Confirmar y firmar</button>
    <p class="rellenoMsg" style="display:none; margin-top:10px;"></p>
  `;

  const overlay = contenedor.querySelector('.doc-campos-overlay');
  const msg = contenedor.querySelector('.rellenoMsg');

  function posicionar(el, c) {
    el.style.position = 'absolute';
    el.style.left = c.xPct + '%';
    el.style.top = c.yPct + '%';
  }

  campos.forEach(c => {
    if (c.tipo === 'firma') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline';
      btn.style.cssText = 'font-size:11px; padding:4px 8px;';
      btn.textContent = 'Firmar aquí';
      posicionar(btn, c);
      btn.addEventListener('click', () => abrirPadFirma((dataUrlFirma) => {
        estado[c.id] = dataUrlFirma;
        btn.textContent = 'Firma capturada ✓';
        btn.style.color = '#1E7A46';
      }));
      overlay.appendChild(btn);
    } else {
      const valorInicial = c.tipo === 'fecha_hoy'
        ? new Date().toLocaleDateString('es-ES')
        : valorDePersonaParaTipo(c.tipo, persona);
      valoresOriginales[c.id] = valorInicial;
      estado[c.id] = valorInicial;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = valorInicial;
      input.style.cssText = `width:${c.tipo === 'texto' ? '160px' : '130px'}; font-size:12px; padding:2px 4px;`;
      posicionar(input, c);
      input.addEventListener('input', () => { estado[c.id] = input.value; });
      overlay.appendChild(input);
    }
  });

  contenedor.querySelector('.confirmarBtn').addEventListener('click', async () => {
    const faltaAlgo = campos.some(c => !estado[c.id] || !String(estado[c.id]).trim());
    if (faltaAlgo) {
      msg.style.display = 'block'; msg.className = 'msg-error';
      msg.textContent = 'Completa todos los campos (incluida la firma) antes de continuar.';
      return;
    }
    if (!confirm('Una vez confirmado no podrás modificar este documento. ¿Continuar?')) return;

    const avisoDiferencias = campos.some(c =>
      esCampoIdentidad(c.tipo) && String(estado[c.id]).trim() !== String(valoresOriginales[c.id] || '').trim()
    );

    msg.style.display = 'block'; msg.className = 'msg-ok'; msg.textContent = 'Generando el documento final...';
    try {
      const { blob } = await componerDocumentoFinal(dataUrlFondo, campos, estado);
      const datosFinales = {};
      campos.forEach(c => { if (c.tipo !== 'firma') datosFinales[c.id] = estado[c.id]; });
      onCompletar(blob, datosFinales, avisoDiferencias);
    } catch (err) {
      msg.className = 'msg-error';
      msg.textContent = 'No se pudo generar el documento: ' + err.message;
    }
  });
}
