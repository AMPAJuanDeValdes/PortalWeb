// Circulares del AMPA (botón «Enviar circular»): el mismo formato que las
// circulares que se mandaban en PDF. Título grande en mayúsculas, la fecha
// debajo, el logo a la derecha, un párrafo de entrada, apartados con
// viñetas (Plazas disponibles, Coste, Inscripción…) y al pie el email, el
// Instagram y el WhatsApp del AMPA. Los enlaces van a la web del AMPA.
//
// Una circular se describe con un objeto y de él salen el HTML y el texto:
//   { titulo, subtitulo, entrada: ['párrafo', …],
//     apartados: [{ titulo, parrafos: ['…'], puntos: [Punto, …] }] }
//   Punto: 'texto' | { etiqueta, texto, enlace, sub: ['…'] }
//     etiqueta → en negrita delante («Fecha límite:»); enlace → el texto es
//     un enlace a esa dirección; sub → viñetas de segundo nivel.

const { AMPA_EMAIL, AMPA_INSTAGRAM, AMPA_WHATSAPP } = require('../../../web/shared/datos-ampa.js');

const C = { titulo: '#4A4F9E', fecha: '#E0218A', texto: '#1F2A6B', fondo: '#F7F2FA' };
const FUENTE = "'Open Sans', 'Segoe UI', Arial, Helvetica, sans-serif";
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enlaceHtml = (href, texto) => `<a href="${esc(href)}" style="color:${C.texto}; text-decoration:underline;">${esc(texto)}</a>`;
const comoPunto = (p) => typeof p === 'string' ? { texto: p } : p;

function puntoHtml(p) {
  p = comoPunto(p);
  const etiqueta = p.etiqueta ? `<b>${esc(p.etiqueta)}</b> ` : '';
  const cuerpo = p.enlace ? enlaceHtml(p.enlace, p.texto) : esc(p.texto).replace(/\n/g, '<br>');
  const sub = p.sub && p.sub.length
    ? `<ul style="margin:4px 0 0; padding-left:22px; list-style-type:circle;">${p.sub.map(s => `<li style="margin:0 0 2px;">${esc(s)}</li>`).join('')}</ul>` : '';
  return `<li style="margin:0 0 4px;">${etiqueta}${cuerpo}${sub}</li>`;
}

function circularHtml(c, { srcLogo } = {}) {
  const apartados = (c.apartados || []).map(a => `
        <p style="margin:18px 0 6px; font-weight:bold; font-size:16px;">${esc(a.titulo)}</p>
        ${(a.parrafos || []).map(t => `<p style="margin:0 0 6px;">${esc(t).replace(/\n/g, '<br>')}</p>`).join('')}
        ${a.puntos && a.puntos.length ? `<ul style="margin:0; padding-left:22px;">${a.puntos.map(puntoHtml).join('')}</ul>` : ''}`).join('');
  const pie = [
    enlaceHtml('mailto:' + AMPA_EMAIL, '✉ ' + AMPA_EMAIL),
    enlaceHtml(AMPA_INSTAGRAM, 'Instagram'),
    enlaceHtml(AMPA_WHATSAPP, 'WhatsApp')
  ].map(x => `<td style="padding:6px 8px; font-weight:bold; font-size:14px; font-family:${FUENTE};">${x}</td>`).join('');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background-color:${C.fondo}; background-image:linear-gradient(135deg, #FDE6F0 0%, #EFE8FA 35%, #E2F3F0 70%, #FFF3DE 100%);">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;">
      <tr>
        <td valign="middle" align="center" style="font-family:${FUENTE};">
          <p style="margin:0; font-size:28px; line-height:1.2; font-weight:bold; letter-spacing:0.5px; color:${C.titulo}; text-transform:uppercase;">${esc(c.titulo)}</p>
          ${c.subtitulo ? `<p style="margin:8px 0 0; font-size:19px; color:${C.fecha};">${esc(c.subtitulo)}</p>` : ''}
        </td>
        ${srcLogo ? `<td valign="middle" width="150" align="right"><img src="${esc(srcLogo)}" alt="AMPA Juan de Valdés" width="140" style="display:block; width:140px; height:auto; border:0;"></td>` : ''}
      </tr>
      <tr><td colspan="2" style="padding-top:16px; font-family:${FUENTE}; font-size:15px; line-height:1.65; color:${C.texto};">
        ${(c.entrada || []).map(t => `<p style="margin:0 0 10px;">${esc(t).replace(/\n/g, '<br>')}</p>`).join('')}
        ${apartados}
      </td></tr>
      <tr><td colspan="2" style="padding-top:26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${pie}</tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function circularTexto(c) {
  const l = [String(c.titulo || '').toUpperCase()];
  if (c.subtitulo) l.push(c.subtitulo);
  l.push('');
  (c.entrada || []).forEach(t => l.push(t, ''));
  (c.apartados || []).forEach(a => {
    l.push(a.titulo);
    (a.parrafos || []).forEach(t => l.push(t));
    (a.puntos || []).map(comoPunto).forEach(p => {
      l.push('  - ' + (p.etiqueta ? p.etiqueta + ' ' : '') + p.texto + (p.enlace ? ': ' + p.enlace : ''));
      (p.sub || []).forEach(s => l.push('      · ' + s));
    });
    l.push('');
  });
  l.push(`Email: ${AMPA_EMAIL}`, `Instagram: ${AMPA_INSTAGRAM}`, `WhatsApp: ${AMPA_WHATSAPP}`);
  return l.join('\n');
}

module.exports = { circularHtml, circularTexto };
