// La circular en PDF (el documento adjunto del email de «Enviar circular»),
// con el mismo contenido que _lib/circular.js y el aspecto de las circulares
// del AMPA: fondo de colores suaves, título grande, fecha, logo, apartados
// con viñetas, enlaces a la web que se pueden pulsar y el pie de contacto.
//
// Generador de PDF propio y sin dependencias (solo zlib de Node): usa las
// fuentes Helvetica y Helvetica-Bold que traen todos los lectores de PDF
// (texto en WinAnsi: acentos, ñ, º, €…; los emojis no caben y se quitan).
//   pdfCircular(circular, { logo: '/ruta/logo.png' }) → Buffer

const zlib = require('zlib');
const fs = require('fs');
const { AMPA_EMAIL, AMPA_INSTAGRAM, AMPA_WHATSAPP } = require('../../../web/shared/datos-ampa.js');

// Anchos de los caracteres 32–255 (WinAnsi) de Helvetica y Helvetica-Bold, en milésimas
const ANCHOS = {
  normal: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,750,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,552,400,549,333,333,333,576,537,333,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500],
  negrita: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,750,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,552,400,549,333,333,333,576,556,333,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556]
};

// WinAnsi: los caracteres 128–159 no son los de Latin-1
const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2C6: 0x88,
  0x2030: 0x89, 0x160: 0x8A, 0x2039: 0x8B, 0x152: 0x8C, 0x17D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2DC: 0x98, 0x2122: 0x99, 0x161: 0x9A, 0x203A: 0x9B, 0x153: 0x9C, 0x17E: 0x9E, 0x178: 0x9F };

// Texto → códigos WinAnsi (lo que no existe en WinAnsi, como los emojis, se quita)
function codigos(texto) {
  const out = [];
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const u = ch.codePointAt(0);
    if (u === 9) out.push(32);
    else if ((u >= 32 && u <= 126) || (u >= 160 && u <= 255)) out.push(u);
    else if (WIN[u]) out.push(WIN[u]);
  }
  return out;
}
const anchoTexto = (texto, fuente, tam) => codigos(texto).reduce((s, c) => s + (ANCHOS[fuente][c - 32] || 0), 0) * tam / 1000;
const cadena = (texto) => '(' + Buffer.from(codigos(texto)).toString('latin1').replace(/[\\()]/g, '\\$&') + ')';
const rgb = (hex) => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const n = (x) => Number(x.toFixed(2));

// ---------- PNG (8 bits; color, color con transparencia o paleta) ----------
function leerPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('No es un PNG');
  let p = 8, ihdr, plte, trns; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), tipo = buf.toString('latin1', p + 4, p + 8), datos = buf.subarray(p + 8, p + 8 + len);
    if (tipo === 'IHDR') ihdr = { w: datos.readUInt32BE(0), h: datos.readUInt32BE(4), bits: datos[8], color: datos[9], entrelazado: datos[12] };
    else if (tipo === 'PLTE') plte = datos;
    else if (tipo === 'tRNS') trns = datos;
    else if (tipo === 'IDAT') idat.push(datos);
    p += 12 + len;
  }
  const { w, h, bits, color, entrelazado } = ihdr;
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (bits !== 8 || entrelazado || !canales) throw new Error('PNG no admitido');
  const crudo = zlib.inflateSync(Buffer.concat(idat)), fila = w * canales;
  const px = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) {
    const f = crudo[y * (fila + 1)], ori = crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
    for (let x = 0; x < fila; x++) {
      const a = x >= canales ? px[y * fila + x - canales] : 0, b = y ? px[(y - 1) * fila + x] : 0, c = x >= canales && y ? px[(y - 1) * fila + x - canales] : 0;
      let v = ori[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * fila + x] = v & 255;
    }
  }
  const color3 = Buffer.alloc(w * h * 3), alfa = Buffer.alloc(w * h, 255);
  for (let i = 0; i < w * h; i++) {
    if (color === 3) { const k = px[i]; plte.copy(color3, i * 3, k * 3, k * 3 + 3); if (trns && k < trns.length) alfa[i] = trns[k]; }
    else if (color === 2 || color === 6) { px.copy(color3, i * 3, i * canales, i * canales + 3); if (color === 6) alfa[i] = px[i * 4 + 3]; }
    else { color3.fill(px[i * canales], i * 3, i * 3 + 3); if (color === 4) alfa[i] = px[i * 2 + 1]; }
  }
  return { w, h, color: color3, alfa };
}

// ---------- Página y maquetación ----------
const A4 = { w: 595.28, h: 841.89 };
const M = 50;                       // márgenes
const PIE = 46;                     // alto reservado al pie
const COL = { titulo: '#4A4F9E', fecha: '#E0218A', texto: '#1F2A6B' };

function pdfCircular(c, { logo } = {}) {
  const paginas = [];
  let pag, y;
  const nuevaPagina = () => { pag = { ops: ['q /Fondo sh Q'], enlaces: [] }; paginas.push(pag); y = M; };
  const Y = (yy) => n(A4.h - yy);
  nuevaPagina();

  // Una línea de trozos [{ t, f, enlace }] en (x, y = línea base)
  function pintarLinea(trozos, x, base, tam, color) {
    let cx = x;
    for (const t of trozos) {
      const w = anchoTexto(t.t, t.f, tam);
      pag.ops.push(`BT /${t.f === 'negrita' ? 'F2' : 'F1'} ${tam} Tf ${rgb(color)} rg ${n(cx)} ${Y(base)} Td ${cadena(t.t)} Tj ET`);
      if (t.enlace) {
        const vis = anchoTexto(t.t.replace(/\s+$/, ''), t.f, tam);
        pag.ops.push(`${rgb(color)} RG 0.6 w ${n(cx)} ${Y(base + 1.6)} m ${n(cx + vis)} ${Y(base + 1.6)} l S`);
        pag.enlaces.push({ rect: [n(cx), Y(base + 3), n(cx + vis), Y(base - tam)], url: t.enlace });
      }
      cx += w;
    }
  }

  // Párrafo con ajuste de línea. trozos: [{ t, f, enlace }]; avanza y (y cambia de página si no cabe)
  function parrafo(trozos, x, ancho, { tam = 11.5, alto = 17.5, color = COL.texto, centrado = false, vineta = null } = {}) {
    const palabras = [];
    trozos.forEach(t => String(t.t).split(/(?<=\s)/).forEach(p => p && palabras.push({ ...t, t: p })));
    const lineas = []; let actual = [], usado = 0;
    for (const p of palabras) {
      const w = anchoTexto(p.t, p.f, tam), sinEsp = anchoTexto(p.t.replace(/\s+$/, ''), p.f, tam);
      if (actual.length && usado + sinEsp > ancho) { lineas.push(actual); actual = []; usado = 0; }
      actual.push(p); usado += w;
    }
    if (actual.length) lineas.push(actual);
    lineas.forEach((l, i) => {
      if (y + alto > A4.h - M - PIE) nuevaPagina();
      // juntar trozos seguidos con el mismo estilo
      const junt = [];
      l.forEach(p => { const u = junt[junt.length - 1]; if (u && u.f === p.f && u.enlace === p.enlace) u.t += p.t; else junt.push({ ...p }); });
      const anchoL = junt.reduce((s, t) => s + anchoTexto(t.t.replace(/\s+$/, ''), t.f, tam), 0);
      const base = y + tam;
      if (i === 0 && vineta) pintarLinea([{ t: vineta, f: 'normal' }], x - 13, base, tam, color);
      pintarLinea(junt, centrado ? x + (ancho - anchoL) / 2 : x, base, tam, color);
      y += alto;
    });
  }
  const trozosPunto = (p) => {
    p = typeof p === 'string' ? { texto: p } : p;
    const t = [];
    if (p.etiqueta) t.push({ t: p.etiqueta + ' ', f: 'negrita' });
    t.push({ t: p.texto, f: 'normal', enlace: p.enlace || null });
    return { trozos: t, sub: p.sub || [] };
  };

  // Cabecera: título y fecha centrados, logo a la derecha
  let img = null;
  if (logo) { try { img = leerPng(fs.readFileSync(logo)); } catch (e) { img = null; } }
  const anchoLogo = img ? 118 : 0, altoLogo = img ? anchoLogo * img.h / img.w : 0;
  const anchoTitulo = A4.w - 2 * M - (img ? anchoLogo + 14 : 0);
  if (img) pag.ops.push(`q ${anchoLogo} 0 0 ${n(altoLogo)} ${n(A4.w - M - anchoLogo + 10)} ${Y(M - 14 + altoLogo)} cm /Logo Do Q`);
  y = M - 6;
  parrafo([{ t: String(c.titulo || '').toUpperCase(), f: 'negrita' }], M, anchoTitulo, { tam: 23, alto: 27, color: COL.titulo, centrado: true });
  if (c.subtitulo) { y += 4; parrafo([{ t: c.subtitulo, f: 'normal' }], M, anchoTitulo, { tam: 15, alto: 19, color: COL.fecha, centrado: true }); }
  y = Math.max(y, M - 14 + altoLogo) + 16;

  const ancho = A4.w - 2 * M;
  (c.entrada || []).forEach(t => { parrafo([{ t, f: 'normal' }], M, ancho); y += 6; });
  (c.apartados || []).forEach(a => {
    y += 8;
    if (y + 40 > A4.h - M - PIE) nuevaPagina();   // el título del apartado no se queda solo al final
    parrafo([{ t: a.titulo, f: 'negrita' }], M, ancho, { tam: 12.5, alto: 19 });
    (a.parrafos || []).forEach(t => { parrafo([{ t, f: 'normal' }], M + 6, ancho - 6); y += 2; });
    (a.puntos || []).forEach(p => {
      const { trozos, sub } = trozosPunto(p);
      parrafo(trozos, M + 20, ancho - 20, { vineta: '•' });
      sub.forEach(s => parrafo([{ t: s, f: 'normal' }], M + 40, ancho - 40, { vineta: '–' }));
      y += 2;
    });
  });

  // Pie: email, Instagram y WhatsApp (abajo de la última página)
  const pie = [{ t: AMPA_EMAIL, enlace: 'mailto:' + AMPA_EMAIL }, { t: 'Instagram', enlace: AMPA_INSTAGRAM }, { t: 'WhatsApp', enlace: AMPA_WHATSAPP }];
  const basePie = A4.h - M + 6, tamPie = 10.5;
  const anchos = pie.map(p => anchoTexto(p.t, 'negrita', tamPie));
  const hueco = (A4.w - 2 * M - anchos.reduce((s, w) => s + w, 0)) / (pie.length - 1);
  let px = M;
  pie.forEach((p, i) => { pintarLinea([{ t: p.t, f: 'negrita', enlace: p.enlace }], px, basePie, tamPie, COL.texto); px += anchos[i] + hueco; });

  return construir(paginas, img, c.titulo);
}

// ---------- Escribir el archivo PDF ----------
function construir(paginas, img, titulo) {
  const objs = [];                                  // índice + 1 = número de objeto
  const reservar = () => { objs.push(null); return objs.length; };
  const poner = (id, cuerpo) => { objs[id - 1] = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'latin1'); };
  const flujo = (dicc, datos) => Buffer.concat([Buffer.from(`<< ${dicc} /Length ${datos.length} >>\nstream\n`, 'latin1'), datos, Buffer.from('\nendstream', 'latin1')]);

  const catalogo = reservar(), arbol = reservar(), f1 = reservar(), f2 = reservar(), fondo = reservar();
  poner(f1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  poner(f2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  // Fondo: degradado suave en diagonal (rosa, lila, verde agua, crema)
  const tramo = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(a)}] /C1 [${rgb(b)}] /N 1 >>`;
  poner(fondo, `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 ${A4.h} ${A4.w} 0] /Extend [true true] /Function << /FunctionType 3 /Domain [0 1] /Functions [${tramo('#FDE6F0', '#EFE8FA')} ${tramo('#EFE8FA', '#E2F3F0')} ${tramo('#E2F3F0', '#FFF3DE')}] /Bounds [0.35 0.7] /Encode [0 1 0 1 0 1] >> >>`);
  let logoRef = '';
  if (img) {
    const mascara = reservar(), imagen = reservar();
    poner(mascara, flujo(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(img.alfa)));
    poner(imagen, flujo(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${mascara} 0 R`, zlib.deflateSync(img.color)));
    logoRef = `/XObject << /Logo ${imagen} 0 R >>`;
  }
  const recursos = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /Shading << /Fondo ${fondo} 0 R >> ${logoRef} >>`;
  const kids = paginas.map(p => {
    const id = reservar(), cont = reservar();
    poner(cont, flujo('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'))));
    const annots = p.enlaces.map(e => {
      const a = reservar();
      poner(a, `<< /Type /Annot /Subtype /Link /Rect [${e.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${cadena(e.url)} >> >>`);
      return `${a} 0 R`;
    });
    poner(id, `<< /Type /Page /Parent ${arbol} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources ${recursos} /Contents ${cont} 0 R${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>`);
    return `${id} 0 R`;
  });
  poner(arbol, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  poner(catalogo, `<< /Type /Catalog /Pages ${arbol} 0 R >>`);
  const info = reservar();
  poner(info, `<< /Title ${cadena(titulo || 'Circular')} /Author (AMPA Juan de Valdes) /Producer (AMPA Juan de Valdes) >>`);

  const partes = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let pos = partes[0].length; const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
    partes.push(b); pos += b.length;
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map(o => String(o).padStart(10, '0') + ' 00000 n ')].join('\n');
  partes.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

module.exports = { pdfCircular, anchoTexto, codigos };
