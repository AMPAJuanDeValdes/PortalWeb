// Mandato SEPA: genera el PDF definitivo escribiendo los datos del socio
// directamente sobre la plantilla del AMPA (assets/mandato-sepa-ampa.pdf)
// en posiciones fijas, medidas en puntos PDF. El socio solo revisa sus
// datos en un formulario normal y firma; no coloca nada sobre el papel.
//
//   validarIban(iban)            -> { ok, limpio, mensaje }
//   formatearIban(iban)          -> 'ES12 3456 ...'
//   bicDesdeIban(iban)           -> BIC del banco o ''
//   generarMandatoSepaPdf(datos) -> Promise<Blob>  (application/pdf)
//   montarPadFirma(contenedor)   -> { vacio(), dataUrl(), borrar() }
//
// Si se cambia la plantilla por otra con distinta maquetación, hay que
// ajustar POSICIONES (x, y de la línea base desde ARRIBA, ancho máximo).

const PLANTILLA_MANDATO_URL = 'assets/mandato-sepa-ampa.pdf';
const PDF_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

const POSICIONES = {
  referencia:   { x: 226, y: 124, ancho: 318 },
  titular:      { x: 140, y: 371, ancho: 400 },
  direccion:    { x: 200, y: 402, ancho: 340 },
  cpPoblacion:  { x: 284, y: 432, ancho: 256 },
  pais:         { x: 184, y: 466, ancho: 356 },
  bic:          { x: 310, y: 488, ancho: 230 },
  iban:         { x: 236, y: 537, ancho: 304 },
  fechaLugar:   { x: 138, y: 612, ancho: 402 },
  firma:        { x: 140, y: 657, ancho: 190, alto: 38 }   // y = borde inferior
};

/* ---------- IBAN y BIC ---------- */

function limpiarIban(iban) { return String(iban || '').replace(/[\s-]/g, '').toUpperCase(); }

function validarIban(iban) {
  const limpio = limpiarIban(iban);
  if (!limpio) return { ok: false, limpio, mensaje: 'Escribe el IBAN.' };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(limpio)) return { ok: false, limpio, mensaje: 'El IBAN empieza por dos letras (ES) y dos números.' };
  if (limpio.startsWith('ES') && limpio.length !== 24) return { ok: false, limpio, mensaje: `Un IBAN español tiene 24 caracteres; has escrito ${limpio.length}.` };
  if (limpio.length < 15 || limpio.length > 34) return { ok: false, limpio, mensaje: 'La longitud del IBAN no es correcta.' };
  const reordenado = limpio.slice(4) + limpio.slice(0, 4);
  let resto = 0;
  for (const ch of reordenado) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  if (resto !== 1) return { ok: false, limpio, mensaje: 'El IBAN no es correcto: revisa los números.' };
  return { ok: true, limpio, mensaje: '' };
}

function formatearIban(iban) { return limpiarIban(iban).replace(/(.{4})/g, '$1 ').trim(); }

// Código de entidad (posiciones 5-8 del IBAN español) -> BIC. Bancos más habituales.
const BIC_ENTIDADES = {
  '0049': 'BSCHESMM', '0030': 'ESPCESMM', '0075': 'POPUESMM', '0073': 'OPENESMM',
  '0081': 'BSABESBB', '0182': 'BBVAESMM', '2100': 'CAIXESBB', '2038': 'CAHMESMM',
  '0128': 'BKBKESMM', '1465': 'INGDESMM', '2080': 'CAGLESMM', '2085': 'CAZRES2Z',
  '3058': 'CCRIES2A', '2095': 'BASKES2B', '0237': 'CSURES2C', '3035': 'CLPEES2M',
  '2103': 'UCJAES2M', '0061': 'BMARES2M', '0186': 'BFIVESBB', '1491': 'TRIOESMM',
  '0239': 'EVOBESMM', '0216': 'POHIESMM', '0019': 'DEUTESBB', '3025': 'CDENESBB',
  '0487': 'GBMNESMM', '0131': 'BESMESMM'
};
function bicDesdeIban(iban) {
  const l = limpiarIban(iban);
  if (!l.startsWith('ES') || l.length < 8) return '';
  return BIC_ENTIDADES[l.slice(4, 8)] || '';
}

/* ---------- Generación del PDF ---------- */

let pdfLibCargando = null;
function cargarPdfLib() {
  if (window.PDFLib) return Promise.resolve();
  if (pdfLibCargando) return pdfLibCargando;
  pdfLibCargando = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDF_LIB_URL;
    s.onload = () => resolve();
    s.onerror = () => { pdfLibCargando = null; reject(new Error('No se pudo cargar la librería de PDF.')); };
    document.head.appendChild(s);
  });
  return pdfLibCargando;
}

// datos: { referencia, titular, direccion, cpPoblacion, pais, bic, iban, fechaLugar, firmaPng }
async function generarMandatoSepaPdf(datos, urlPlantilla) {
  await cargarPdfLib();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const resp = await fetch(urlPlantilla || PLANTILLA_MANDATO_URL);
  if (!resp.ok) throw new Error('No se encontró la plantilla del mandato.');
  const pdf = await PDFDocument.load(await resp.arrayBuffer());
  const pagina = pdf.getPages()[0];
  const altoPagina = pagina.getHeight();
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const fuenteMono = await pdf.embedFont(StandardFonts.Courier);
  const tinta = rgb(0.05, 0.12, 0.35);

  function escribir(clave, texto, opciones = {}) {
    const p = POSICIONES[clave];
    const f = opciones.mono ? fuenteMono : fuente;
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    let tam = opciones.tam || 11;
    while (tam > 6 && f.widthOfTextAtSize(t, tam) > p.ancho) tam -= 0.5;
    pagina.drawText(t, { x: p.x, y: altoPagina - p.y, size: tam, font: f, color: tinta });
  }

  escribir('referencia', datos.referencia);
  escribir('titular', datos.titular);
  escribir('direccion', datos.direccion);
  escribir('cpPoblacion', datos.cpPoblacion);
  escribir('pais', datos.pais);
  escribir('bic', datos.bic, { mono: true });
  escribir('iban', formatearIban(datos.iban), { mono: true, tam: 12 });
  escribir('fechaLugar', datos.fechaLugar);

  if (datos.firmaPng) {
    const img = await pdf.embedPng(datos.firmaPng);
    const p = POSICIONES.firma;
    const escala = Math.min(p.ancho / img.width, p.alto / img.height);
    const w = img.width * escala, h = img.height * escala;
    pagina.drawImage(img, { x: p.x, y: altoPagina - p.y + 2, width: w, height: h });
  }

  pdf.setTitle('Orden de domiciliación SEPA');
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/* ---------- Pad de firma (en la propia página) ---------- */

function montarPadFirma(contenedor) {
  contenedor.innerHTML = `
    <div class="firma-pad">
      <canvas aria-label="Recuadro para firmar"></canvas>
      <span class="firma-pad-guia">Firma aquí con el dedo o el ratón</span>
    </div>
    <button type="button" class="linklike firma-borrar">Borrar firma</button>`;
  const caja = contenedor.querySelector('.firma-pad');
  const canvas = caja.querySelector('canvas');
  const guia = caja.querySelector('.firma-pad-guia');
  const ctx = canvas.getContext('2d');
  let dibujando = false, trazos = 0, ultimo = null;

  function ajustar() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0D1F59';
    trazos = 0; guia.hidden = false;
  }
  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', (e) => {
    dibujando = true; ultimo = pos(e); canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    trazos++; guia.hidden = true; e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo = p; e.preventDefault();
  });
  const fin = () => { dibujando = false; };
  canvas.addEventListener('pointerup', fin);
  canvas.addEventListener('pointercancel', fin);
  contenedor.querySelector('.firma-borrar').addEventListener('click', () => ajustar());
  requestAnimationFrame(ajustar);

  // Recorta el espacio en blanco alrededor de la firma.
  function dataUrl() {
    const { width: w, height: h } = canvas;
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const m = 6;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  return { vacio: () => trazos === 0, dataUrl, borrar: ajustar };
}
