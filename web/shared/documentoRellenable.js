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
// Opcionales: pagina (la página del PDF donde va; si no, la del documento),
// tamPct (tamaño de letra en % del ancho; 1.4 si no) y anchoPct (espacio
// disponible: si el texto no cabe, se hace más pequeño).
//
// Varias páginas: donde se pide `fondo` vale una imagen (dataUrl) o una
// lista [{ pagina, dataUrl }] (una por página que lleva campos).

const TIPOS_CAMPO = [
  { id: 'nombre', label: 'Nombre' },
  { id: 'apellidos', label: 'Apellidos' },
  { id: 'dni_nie', label: 'DNI/NIE' },
  { id: 'fecha_nacimiento', label: 'F. nacimiento' },
  { id: 'direccion', label: 'Dirección' },
  { id: 'cp_ciudad_provincia', label: 'CP, ciudad y provincia' },
  { id: 'pais_deudor', label: 'País del deudor' },
  { id: 'iban', label: 'IBAN' },
  { id: 'swift_bic', label: 'Swift BIC' },
  { id: 'ref_mandato', label: 'Referencia del mandato' },
  { id: 'id_acreedor', label: 'Identificador del acreedor' },
  { id: 'nombre_acreedor', label: 'Nombre del acreedor' },
  { id: 'direccion_acreedor', label: 'Dirección del acreedor' },
  { id: 'cp_acreedor', label: 'CP del acreedor' },
  { id: 'pais_acreedor', label: 'País del acreedor' },
  { id: 'tipo_pago_fijo', label: 'Tipo de pago (fijo)' },
  { id: 'nombre_completo', label: 'Nombre y apellidos' },
  // Documentos de un alumno con su adulto (p. ej. autorización de la Cabalgata)
  { id: 'tutor_nombre_completo', label: 'Padre/madre/tutor: nombre' },
  { id: 'tutor_dni', label: 'Padre/madre/tutor: DNI' },
  { id: 'tutor_domicilio', label: 'Padre/madre/tutor: domicilio' },
  { id: 'tutor_movil', label: 'Padre/madre/tutor: móvil' },
  { id: 'menor_nombre_completo', label: 'Alumno/a: nombre' },
  { id: 'menor_fecha_nacimiento', label: 'Alumno/a: nacimiento (DD/MM/AA)' },
  { id: 'menor_edad', label: 'Alumno/a: edad' },
  { id: 'acomp_nombre_completo', label: 'Acompañante: nombre' },
  { id: 'acomp_parentesco', label: 'Acompañante: parentesco' },
  { id: 'acomp_movil', label: 'Acompañante: móvil' },
  { id: 'entidad', label: 'Entidad (AMPA)' },
  { id: 'marca_x', label: 'Marca X' },
  { id: 'lugar', label: 'Lugar (ciudad)' },
  { id: 'dia_hoy', label: 'Día de hoy' },
  { id: 'mes_hoy', label: 'Mes de hoy' },
  { id: 'texto', label: 'Texto libre' },
  { id: 'fecha_hoy', label: 'Fecha de hoy' },
  { id: 'firma', label: 'Firma' }
];
// Los que no salen de los datos de la persona: se calculan solos
const CAMPOS_FIJOS = ['fecha_hoy', 'dia_hoy', 'mes_hoy', 'marca_x', 'entidad', 'firma'];

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
  const viewport = page.getViewport({ scale: 2.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  // Fondo blanco: sin él, la página sale transparente y se ve el color de detrás
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
}

// Páginas del PDF que llevan campos (y la del documento, aunque aún no tenga)
function paginasDeCampos(campos, paginaBase) {
  const set = new Set([paginaBase || 1]);
  (campos || []).forEach(c => { if (c.pagina) set.add(c.pagina); });
  return [...set].sort((a, b) => a - b);
}
async function renderizarPaginasPDF(pdfUrl, paginas) {
  const out = [];
  for (const pagina of paginas) out.push({ pagina, ...(await renderizarPaginaPDF(pdfUrl, pagina)) });
  return out;
}
function normalizarFondos(fondo) {
  return Array.isArray(fondo) ? fondo : [{ pagina: null, dataUrl: fondo }];
}
// Página de un campo: la suya, o la primera del documento
const paginaCampo = (c, fondos) => c.pagina || fondos[0].pagina;

/* ==================== 2. Editor de plantilla (admin) ==================== */

function abrirEditorPlantilla(contenedor, fondo, camposExistentes, onGuardar) {
  const fondos = normalizarFondos(fondo);
  let campos = (camposExistentes || []).map(c => ({ ...c }));
  let tipoActual = TIPOS_CAMPO[0].id;

  contenedor.innerHTML = `
    <div class="doc-editor-toolbar" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
      ${TIPOS_CAMPO.map(t => `<button type="button" class="btn btn-outline tipoBtn" data-tipo="${t.id}">${t.label}</button>`).join('')}
    </div>
    <p style="font-size:12.5px; color:var(--ink-soft); margin:0 0 10px;">
      Elige un tipo de campo arriba y haz clic en el documento para colocarlo. Haz clic en un campo ya puesto para borrarlo.
    </p>
    ${fondos.map((f, k) => `${fondos.length > 1 ? `<p class="section-label" style="margin:14px 0 6px;">Página ${f.pagina}</p>` : ''}
    <div style="position:relative; display:inline-block; max-width:100%;">
      <img class="doc-editor-img" data-k="${k}" src="${f.dataUrl}" style="max-width:100%; display:block;">
      <div class="doc-campos-overlay" data-k="${k}" style="position:absolute; inset:0;"></div>
    </div>`).join('')}
    <button type="button" class="btn btn-primary guardarPlantillaBtn" style="margin-top:14px;">Guardar plantilla</button>
  `;

  const botonesTipo = contenedor.querySelectorAll('.tipoBtn');
  function marcarBotonActivo() {
    botonesTipo.forEach(b => b.classList.toggle('btn-primary', b.dataset.tipo === tipoActual));
  }
  marcarBotonActivo();

  function pintarMarcadores() {
    contenedor.querySelectorAll('.doc-campos-overlay').forEach(o => { o.innerHTML = ''; });
    campos.forEach((c, idx) => {
      const k = fondos.findIndex(f => f.pagina === paginaCampo(c, fondos));
      const overlay = contenedor.querySelector(`.doc-campos-overlay[data-k="${k < 0 ? 0 : k}"]`);
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

  contenedor.querySelectorAll('.doc-editor-img').forEach(img => img.addEventListener('click', (e) => {
    const rect = img.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    const pagina = fondos[Number(img.dataset.k)].pagina;
    campos.push({ id: generarIdCampo(), tipo: tipoActual, xPct, yPct, ...(pagina ? { pagina } : {}) });
    pintarMarcadores();
  }));

  contenedor.querySelector('.guardarPlantillaBtn').addEventListener('click', () => onGuardar(campos));
}

/* ==================== 3. Formulario de relleno + firma (socio) ==================== */

// Genérico a propósito: cualquier tipo de campo que no sea "texto libre",
// "fecha de hoy" o "firma" se autorrellena leyendo esa misma propiedad del
// objeto `persona` que le pase la página que llama (eventos.html construye
// `persona` a partir del adulto/alumno; mis-datos.html, para el mandato
// SEPA, construye un `persona` más rico mezclando el adulto, el socio y la
// configuración del acreedor — así no hace falta tocar este archivo cada
// vez que se añade un nuevo tipo de documento).
// Un campo de "texto libre" se rellena solo si `persona` trae un valor con
// el MISMO id que el campo (ej. el campo "localidad" del mandato SEPA).
const MESES_DOC = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function valorDePersonaParaTipo(tipo, persona, idCampo) {
  const hoy = new Date();
  if (tipo === 'firma') return '';
  if (tipo === 'fecha_hoy') return hoy.toLocaleDateString('es-ES');
  if (tipo === 'dia_hoy') return String(hoy.getDate());
  if (tipo === 'mes_hoy') return MESES_DOC[hoy.getMonth()];
  if (tipo === 'marca_x') return 'X';
  if (tipo === 'entidad') return persona.entidad || (typeof AMPA_ENTIDAD !== 'undefined' ? AMPA_ENTIDAD : 'AMPA Juan de Valdés');
  if (tipo === 'texto') return (idCampo && persona[idCampo]) || '';
  return persona[tipo] || '';
}
function esCampoIdentidad(tipo) {
  return tipo !== 'texto' && !CAMPOS_FIJOS.includes(tipo);
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

// Escribe un texto en el documento: a su tamaño, y más pequeño si no cabe en su sitio
function escribirCampo(ctx, c, texto, x, y, anchoPagina) {
  let tam = Math.round(anchoPagina * (c.tamPct || 1.4) / 100);
  const max = c.anchoPct ? anchoPagina * c.anchoPct / 100 : null;
  ctx.font = tam + 'px sans-serif';
  while (max && tam > 8 && ctx.measureText(texto).width > max) { tam--; ctx.font = tam + 'px sans-serif'; }
  ctx.fillText(texto, x, y);
}

// Una imagen con todas las páginas que llevan campos, una debajo de otra
async function componerDocumentoFinal(fondo, campos, estado) {
  const fondos = normalizarFondos(fondo);
  const imgs = [];
  for (const f of fondos) imgs.push(await cargarImagen(f.dataUrl));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...imgs.map(i => i.naturalWidth));
  canvas.height = imgs.reduce((t, i) => t + i.naturalHeight, 0);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let arriba = 0;
  for (let k = 0; k < fondos.length; k++) {
    const img = imgs[k], W = img.naturalWidth, H = img.naturalHeight;
    ctx.drawImage(img, 0, arriba);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    for (const c of campos.filter(c => paginaCampo(c, fondos) === fondos[k].pagina)) {
      const x = (c.xPct / 100) * W;
      const y = arriba + (c.yPct / 100) * H;
      if (c.tipo === 'firma') {
        if (estado[c.id]) {
          const imgFirma = await cargarImagen(estado[c.id]);
          const anchoFirma = W * 0.16;
          const altoFirma = anchoFirma * (imgFirma.naturalHeight / imgFirma.naturalWidth);
          ctx.drawImage(imgFirma, x, y, anchoFirma, altoFirma);
        }
      } else {
        escribirCampo(ctx, c, String(estado[c.id] || ''), x, y, W);
      }
    }
    arriba += H;
  }

  return new Promise(resolve => canvas.toBlob(blob => resolve({ blob }), 'image/png'));
}

// opciones.soloFirma: los datos salen de la web y no se pueden cambiar en el
// documento; la familia solo firma. Si falta algún dato, no deja firmar y
// dice cuál falta (opciones.dondeCorregir: dónde se completa).
function abrirFormularioRelleno(contenedor, fondo, campos, persona, onCompletar, opciones = {}) {
  const fondos = normalizarFondos(fondo);
  const soloFirma = !!opciones.soloFirma;
  const estado = {};
  const valoresOriginales = {};

  contenedor.innerHTML = `
    ${fondos.map((f, k) => `<div class="doc-fill-pagina" style="position:relative; display:inline-block; max-width:100%;${k ? ' margin-top:10px;' : ''}">
      <img class="doc-fill-img" src="${f.dataUrl}" style="max-width:100%; display:block;">
      <div class="doc-campos-overlay" data-k="${k}" style="position:absolute; inset:0;"></div>
    </div>`).join('')}
    <p class="rellenoFaltan msg-error" hidden style="margin-top:12px;"></p>
    <button type="button" class="btn btn-primary confirmarBtn" style="margin-top:14px; display:block;">${soloFirma ? 'Confirmar y guardar' : 'Confirmar y firmar'}</button>
    <p class="rellenoMsg" style="display:none; margin-top:10px;"></p>
  `;

  const msg = contenedor.querySelector('.rellenoMsg');
  const faltan = [];

  function posicionar(el, c) {
    el.style.position = 'absolute';
    el.style.left = c.xPct + '%';
    el.style.top = c.yPct + '%';
  }
  // Los textos de solo lectura, al mismo tamaño que saldrán en el documento final
  const ajustarTam = () => contenedor.querySelectorAll('.doc-fill-pagina').forEach(pg => {
    const ancho = pg.clientWidth;
    pg.querySelectorAll('.doc-dato').forEach(el => {
      let tam = ancho * (Number(el.dataset.tam) || 1.4) / 100;
      el.style.fontSize = tam + 'px';
      const max = Number(el.dataset.ancho) ? ancho * Number(el.dataset.ancho) / 100 : 0;
      while (max && tam > 6 && el.scrollWidth > max) { tam -= 0.5; el.style.fontSize = tam + 'px'; }
    });
  });

  campos.forEach(c => {
    const k = fondos.findIndex(f => f.pagina === paginaCampo(c, fondos));
    const overlay = contenedor.querySelector(`.doc-campos-overlay[data-k="${k < 0 ? 0 : k}"]`);
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
      return;
    }
    const valorInicial = valorDePersonaParaTipo(c.tipo, persona, c.id);
    valoresOriginales[c.id] = valorInicial;
    estado[c.id] = valorInicial;

    if (soloFirma && c.tipo !== 'texto') {
      // Dato de la web: se ve en el documento, no se puede cambiar
      if (!String(valorInicial).trim()) faltan.push(etiquetaTipo(c.tipo));
      const span = document.createElement('span');
      span.className = 'doc-dato';
      span.dataset.tam = c.tamPct || 1.4;
      if (c.anchoPct) span.dataset.ancho = c.anchoPct;
      span.textContent = valorInicial;
      span.style.cssText += 'white-space:nowrap; line-height:1; color:#000; font-family:sans-serif; pointer-events:none;';
      posicionar(span, c);
      overlay.appendChild(span);
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = valorInicial;
    input.style.cssText = `width:${c.tipo === 'texto' ? '160px' : '130px'}; font-size:12px; padding:2px 4px;`;
    posicionar(input, c);
    input.addEventListener('input', () => { estado[c.id] = input.value; });
    overlay.appendChild(input);
  });
  ajustarTam();
  contenedor.querySelectorAll('.doc-fill-img').forEach(img => img.addEventListener('load', ajustarTam));
  if (window.ResizeObserver) new ResizeObserver(ajustarTam).observe(contenedor);

  if (faltan.length) {
    const p = contenedor.querySelector('.rellenoFaltan');
    p.hidden = false;
    p.textContent = `No se puede firmar todavía: falta ${[...new Set(faltan)].join(', ')}.` + (opciones.dondeCorregir ? ' ' + opciones.dondeCorregir : '');
    contenedor.querySelector('.confirmarBtn').disabled = true;
  }

  contenedor.querySelector('.confirmarBtn').addEventListener('click', async () => {
    const faltaAlgo = campos.some(c => !estado[c.id] || !String(estado[c.id]).trim());
    if (faltaAlgo) {
      msg.style.display = 'block'; msg.className = 'msg-error';
      msg.textContent = soloFirma ? 'Falta la firma.' : 'Completa todos los campos (incluida la firma) antes de continuar.';
      return;
    }
    if (!confirm('Una vez confirmado no podrás modificar este documento. ¿Continuar?')) return;

    const avisoDiferencias = campos.some(c =>
      esCampoIdentidad(c.tipo) && String(estado[c.id]).trim() !== String(valoresOriginales[c.id] || '').trim()
    );

    msg.style.display = 'block'; msg.className = 'msg-ok'; msg.textContent = 'Generando el documento final...';
    try {
      const { blob } = await componerDocumentoFinal(fondos, campos, estado);
      const datosFinales = {};
      campos.forEach(c => { if (c.tipo !== 'firma') datosFinales[c.id] = estado[c.id]; });
      onCompletar(blob, datosFinales, avisoDiferencias);
    } catch (err) {
      msg.className = 'msg-error';
      msg.textContent = 'No se pudo generar el documento: ' + err.message;
    }
  });
}

/* ==================== 4. Datos de la persona para un documento de evento ====================
   Lo usan eventos.html y la página de prueba en local (así se prueba lo mismo).
   doc.aplica_a:
     'adulto' → el adulto apuntado (socio) o el adulto no socio (invitado)
     'alumno' → el alumno/a apuntado
     'pareja' → un alumno/a con el adulto que le acompaña (Cabalgata): el
                alumno/a, su acompañante (socio o no) y quien firma como
                padre/madre/tutor (el adulto que está en la web)
   ctx: { evento, inscripcion, inscripciones (de la familia en el evento),
          adultos, alumnos (de la familia), firmante (adulto con la sesión) } */
function fechaDDMMAA(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a.slice(2)}` : '';
}
function edadEn(iso, dia) {
  if (!iso) return '';
  const n = new Date(String(iso).slice(0, 10) + 'T12:00:00'), h = dia ? new Date(dia) : new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return String(e);
}
const nombreYApellidos = (p) => p ? [p.nombre, p.apellidos].filter(Boolean).join(' ') : '';
function domicilioDe(a) {
  if (!a) return '';
  return [a.direccion, [a.codigo_postal, a.ciudad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
function datosAdultoInscripcion(i, adultos) {
  if (!i) return null;
  if (i.tipo_miembro === 'invitado') return { nombre: i.nombre_invitado || '', apellidos: i.apellidos_invitado || '', dni_nie: i.dni_invitado || '', movil: i.movil_invitado || '' };
  const a = (adultos || []).find(x => x.id === i.adulto_id);
  return a ? { ...a, movil: a.movil || '' } : null;
}
function personaParaDocumento(doc, ctx) {
  const i = ctx.inscripcion;
  const firmante = ctx.firmante || (ctx.adultos || [])[0] || {};
  const comun = { lugar: firmante.ciudad || '' };
  if (doc.aplica_a === 'pareja') {
    const al = (ctx.alumnos || []).find(a => a.id === i.alumno_id) || {};
    const filaAdulto = (ctx.inscripciones || []).find(x => x.grupo_id && x.grupo_id === i.grupo_id && (x.tipo_miembro === 'adulto' || x.tipo_miembro === 'invitado'));
    const acomp = datosAdultoInscripcion(filaAdulto, ctx.adultos) || {};
    return { ...comun, ...al,
      menor_nombre_completo: nombreYApellidos(al), menor_fecha_nacimiento: fechaDDMMAA(al.fecha_nacimiento),
      menor_edad: edadEn(al.fecha_nacimiento, ctx.evento && ctx.evento.fecha),
      tutor_nombre_completo: nombreYApellidos(firmante), tutor_dni: firmante.dni_nie || '',
      tutor_domicilio: domicilioDe(firmante), tutor_movil: firmante.movil || '',
      acomp_nombre_completo: nombreYApellidos(acomp), acomp_parentesco: (filaAdulto && filaAdulto.parentesco) || '',
      acomp_movil: acomp.movil || '' };
  }
  if (doc.aplica_a === 'adulto') {
    const ad = datosAdultoInscripcion(i, ctx.adultos) || {};
    return { ...comun, ...ad, nombre_completo: nombreYApellidos(ad) };
  }
  const al = (ctx.alumnos || []).find(a => a.id === i.alumno_id) || {};
  return { ...comun, ...al, nombre_completo: nombreYApellidos(al), fecha_nacimiento: al.fecha_nacimiento || '' };
}

/* ==================== Vista previa ampliable ==================== */
// Envuelve una <img> de vista previa en un marco con botón «Ampliar» /
// «Ver entera» (al ampliar se puede desplazar para leer cada parte).
function hacerAmpliable(img) {
  if (!img || img.closest('.doc-zoom')) return;
  const marco = document.createElement('div');
  marco.className = 'doc-zoom';
  img.parentNode.insertBefore(marco, img);
  marco.appendChild(img);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn btn-outline btn-zoom'; btn.textContent = 'Ampliar';
  marco.parentNode.insertBefore(btn, marco);
  btn.addEventListener('click', () => {
    const grande = marco.classList.toggle('ampliado');
    btn.textContent = grande ? 'Ver entera' : 'Ampliar';
  });
  img.addEventListener('click', () => btn.click());
}
