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

/* ---------- Formulario para firmar el mandato (Mis datos y alta) ----------
   Rellena el mandato con los datos del adulto que firma, lo enseña para
   revisarlo y, al confirmar, lo guarda y domicilia la cuota de la familia
   (rpc mandato_sepa_firmar). alCancelar: si no se pasa, no hay «Cancelar»
   (cuando la familia tiene que firmar sí o sí). */
function montarFirmaSepa(zona, { socio, adulto, mandatoVigente = null, alCancelar = null, alFirmar = null }) {
  const limpio = (v) => (v === 'PENDIENTE' || v === '00000' || v == null) ? '' : String(v).trim();
  const esc = (v) => String(v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const original = {
    titular: [limpio(adulto.nombre), limpio(adulto.apellidos)].filter(Boolean).join(' '),
    direccion: limpio(adulto.direccion),
    cpPoblacion: [limpio(adulto.codigo_postal), limpio(adulto.ciudad), limpio(adulto.provincia)].filter(Boolean).join(' - '),
    pais: 'España',
    localidad: limpio(adulto.ciudad)
  };
  const ibanInicial = (mandatoVigente && mandatoVigente.iban) || socio.iban || '';

  zona.innerHTML = `
    <div class="sepa-form">
      <div class="aviso" style="margin-top:0;">El mandato es de <b>toda la familia</b>: uno por socio.${mandatoVigente ? ' Si firmas uno nuevo, <b>sustituye al actual</b>.' : ''}
        Revisa tus datos y firma: el documento se rellena solo.</div>

      <div class="field"><label for="sTitular">Titular de la cuenta</label><input type="text" id="sTitular" autocomplete="name" value="${esc(original.titular)}"></div>
      <div class="field"><label for="sDireccion">Dirección</label><input type="text" id="sDireccion" autocomplete="street-address" value="${esc(original.direccion)}"></div>
      <div class="two-col">
        <div class="field"><label for="sCp">Código postal, población y provincia</label><input type="text" id="sCp" value="${esc(original.cpPoblacion)}"></div>
        <div class="field"><label for="sPais">País</label><input type="text" id="sPais" value="${esc(original.pais)}"></div>
      </div>
      <div class="two-col">
        <div class="field"><label for="sIban">IBAN</label><input type="text" id="sIban" inputmode="text" autocomplete="off" spellcheck="false" placeholder="ES00 0000 0000 0000 0000 0000" value="${esc(ibanInicial ? formatearIban(ibanInicial) : '')}" style="font-family:ui-monospace,Menlo,Consolas,monospace; letter-spacing:.02em;"><small class="campo-ayuda" id="sIbanAyuda"></small></div>
        <div class="field"><label for="sBic">Código BIC del banco</label><input type="text" id="sBic" autocomplete="off" spellcheck="false" style="text-transform:uppercase;"><small class="campo-ayuda">Se rellena solo con los bancos más habituales. Si no, viene en tu extracto o en la web de tu banco.</small></div>
      </div>
      <div class="field"><label for="sLocalidad">Localidad donde firmas</label><input type="text" id="sLocalidad" value="${esc(original.localidad)}"></div>

      <div class="field"><label>Firma</label><div id="sFirma"></div></div>

      <div class="acciones-sepa">
        <button type="button" class="btn btn-primary" id="sRevisar">Ver el documento</button>
        ${alCancelar ? '<button type="button" class="linklike" id="sCancelar">Cancelar</button>' : ''}
      </div>
      <p id="sMsg" class="msg-error" hidden></p>
    </div>
    <div class="sepa-preview" hidden>
      <p style="margin:0 0 10px;">Así queda tu mandato. Si todo está bien, confírmalo.</p>
      <img id="sPreviewImg" alt="Vista previa del mandato firmado">
      <div class="acciones-sepa">
        <button type="button" class="btn btn-primary" id="sConfirmar">Confirmar y domiciliar</button>
        <button type="button" class="btn btn-outline" id="sCorregir">Corregir</button>
      </div>
      <p id="sMsg2" hidden></p>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const pad = montarPadFirma($('sFirma'));
  const iban = $('sIban'), bic = $('sBic'), ayuda = $('sIbanAyuda');
  let bicTocado = false;
  function revisarIban() {
    const v = validarIban(iban.value);
    if (!bicTocado) bic.value = v.ok ? bicDesdeIban(v.limpio) : '';
    ayuda.textContent = !iban.value.trim() ? '' : v.ok ? 'IBAN correcto ✓' : v.mensaje;
    ayuda.className = 'campo-ayuda ' + (!iban.value.trim() ? '' : v.ok ? 'ok' : 'error');
    return v;
  }
  iban.addEventListener('input', revisarIban);
  iban.addEventListener('blur', () => { if (validarIban(iban.value).ok) iban.value = formatearIban(iban.value); });
  bic.addEventListener('input', () => { bicTocado = true; });
  revisarIban();
  if (alCancelar) $('sCancelar').addEventListener('click', alCancelar);

  let pdfBlob = null, datos = null;
  $('sRevisar').addEventListener('click', async () => {
    const msg = $('sMsg'); msg.hidden = true;
    const v = revisarIban();
    const val = (id) => $(id).value.trim();
    const falta = [['sTitular', 'el titular'], ['sDireccion', 'la dirección'], ['sCp', 'el código postal y la población'], ['sPais', 'el país'], ['sLocalidad', 'la localidad']]
      .filter(([id]) => !val(id)).map(([, n]) => n);
    let error = '';
    if (falta.length) error = 'Falta ' + falta.join(', ') + '.';
    else if (!v.ok) error = v.mensaje;
    else if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(val('sBic').toUpperCase())) error = 'El BIC tiene 8 u 11 letras y números.';
    else if (pad.vacio()) error = 'Falta tu firma.';
    if (error) { msg.textContent = error; msg.hidden = false; return; }

    datos = {
      referencia: socio.numero_socio_completo || '',
      titular: val('sTitular'), direccion: val('sDireccion'), cpPoblacion: val('sCp'), pais: val('sPais'),
      bic: val('sBic').toUpperCase(), iban: v.limpio,
      fechaLugar: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' – ' + val('sLocalidad'),
      firmaPng: pad.dataUrl()
    };
    const btn = $('sRevisar'); btn.disabled = true; btn.textContent = 'Preparando el documento...';
    try {
      pdfBlob = await generarMandatoSepaPdf(datos);
      const url = URL.createObjectURL(pdfBlob);
      const { dataUrl } = await renderizarPaginaPDF(url, 1);
      URL.revokeObjectURL(url);
      $('sPreviewImg').src = dataUrl;
      hacerAmpliable($('sPreviewImg'));
      zona.querySelector('.sepa-form').hidden = true;
      zona.querySelector('.sepa-preview').hidden = false;
      zona.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      msg.textContent = 'No se pudo preparar el documento: ' + err.message; msg.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Ver el documento'; }
  });

  $('sCorregir').addEventListener('click', () => {
    zona.querySelector('.sepa-preview').hidden = true;
    zona.querySelector('.sepa-form').hidden = false;
  });

  $('sConfirmar').addEventListener('click', async () => {
    const btn = $('sConfirmar'), msg = $('sMsg2');
    btn.disabled = true; btn.textContent = 'Guardando...';
    const fallo = (t) => { msg.className = 'msg-error'; msg.textContent = t; msg.hidden = false; btn.disabled = false; btn.textContent = 'Confirmar y domiciliar'; };

    const path = `${socio.id}/${Date.now()}.pdf`;
    const { error: upErr } = await sb.storage.from('mandatos-sepa').upload(path, pdfBlob, { contentType: 'application/pdf' });
    if (upErr) return fallo('No se pudo guardar el documento: ' + upErr.message);

    const { firmaPng, ...datosFinales } = datos;
    const avisoDiferencias = ['titular', 'direccion', 'cpPoblacion', 'pais'].some(k => datos[k] !== original[k]);
    const { error } = await sb.rpc('mandato_sepa_firmar', {
      p_iban: datos.iban, p_archivo_url: path, p_datos_finales: datosFinales, p_aviso_diferencias: avisoDiferencias
    });
    if (error) return fallo('No se pudo registrar el mandato: ' + error.message);

    zona.innerHTML = '<p class="msg-ok">Mandato firmado ✓. La cuota de la familia ya está domiciliada en esta cuenta.</p>';
    if (alFirmar) alFirmar();
  });
}

/* ---------- Domiciliación elegida en el alta y todavía sin firmar ----------
   (socios.sepa_pendiente). Hasta que se firme la orden SEPA, la cuenta no
   tiene domiciliación (sin IBAN no hay domiciliación). La familia firma
   aquí o, si lo prefiere, pasa a pagar por transferencia. */
function montarSepaPendiente(contenedor, { socio, adulto, alTerminar }) {
  contenedor.innerHTML = `
    <p class="section-label">Falta firmar la orden de domiciliación</p>
    <p style="margin:0 0 6px;">Elegisteis pagar las cuotas por <b>domiciliación bancaria</b>. Para que se pueda cobrar, firma la orden SEPA con la cuenta de la familia.</p>
    <p style="margin:0;"><button type="button" class="linklike sepaTransferencia">Prefiero pagar por transferencia</button></p>
    <p class="msg-error sepaPendMsg" hidden></p>
    <div class="sepaPendForm" style="margin-top:12px;"></div>`;
  montarFirmaSepa(contenedor.querySelector('.sepaPendForm'), {
    socio, adulto, alFirmar: () => setTimeout(alTerminar, 1400)
  });
  contenedor.querySelector('.sepaTransferencia').addEventListener('click', async (e) => {
    if (!confirm('¿Pagar las cuotas por transferencia en vez de domiciliación?')) return;
    e.target.disabled = true;
    const { error } = await sb.rpc('socio_pagar_por_transferencia');
    if (error) {
      const m = contenedor.querySelector('.sepaPendMsg');
      m.textContent = 'No se pudo cambiar: ' + error.message; m.hidden = false; e.target.disabled = false; return;
    }
    alTerminar();
  });
}
