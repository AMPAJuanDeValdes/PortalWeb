// Circulares del AMPA (botón «Enviar circular»), como las que mandaba la
// Junta: un email corto (nota para el colegio + mensaje a las familias) con
// la circular adjunta en PDF (_lib/pdf-circular.js).
//
// La circular se describe con un objeto:
//   { titulo, subtitulo, entrada: ['párrafo', …],
//     apartados: [{ titulo, parrafos: ['…'], puntos: [Punto, …] }] }
//   Punto: 'texto' | { etiqueta, texto, enlace, sub: ['…'] }
//     etiqueta → en negrita delante («Fecha límite:»); enlace → el texto es
//     un enlace a esa dirección; sub → viñetas de segundo nivel.

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lista = (n) => n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || '';

// «plazas, coste, inscripción y organización»: lo que trae la circular
const NOMBRE_APARTADO = { 'Plazas disponibles': 'plazas', 'Cómo pedir': 'cómo pedir', 'Cómo funciona': 'cómo funciona' };
function contenidoCircular(c) {
  return lista((c.apartados || []).filter(a => a.titulo !== 'Importante')
    .map(a => NOMBRE_APARTADO[a.titulo] || a.titulo.toLowerCase()));
}

// El email que acompaña a la circular (que va adjunta en PDF), como los que
// mandaba la Junta: primero una nota para el colegio pidiendo que lo reenvíe
// a los cursos que tocan y, después del «--», el mensaje para las familias.
//   { destinatarios: 'los alumnos y alumnas de Primaria (1º a 6º)',
//     entrada: ['párrafo', …], circular (para decir qué información trae),
//     limite: 'jueves 8 de octubre', enlaces: [{ texto, url }] }
function correoCircular({ destinatarios, entrada = [], circular, limite, etiquetaLimite = 'Fecha límite de inscripción:', enlaces = [] }) {
  const contenido = contenidoCircular(circular);
  const AZUL = '#2F6684';
  const colegio = [
    'Buenos días,',
    `por favor compartid el siguiente comunicado (cuerpo de email y documento adjunto) con ${destinatarios}.`,
    'Muchas gracias.'
  ];
  const texto = [
    ...colegio.flatMap(t => [t, '']),
    '--',
    'Estimadas familias, 👋', '',
    ...entrada.flatMap(t => [t, '']),
    `En el documento adjunto encontraréis toda la información sobre ${contenido}.`, '',
    ...(limite ? [`📅 ${etiquetaLimite} ${limite}`] : []),
    ...enlaces.map(e => `🔗 ${e.texto}: ${e.url}`)
  ].join('\n');
  const p = (html, estilo = '') => `<p style="margin:0 0 14px;${estilo}">${html}</p>`;
  const html = `<div style="font-family:Verdana, Geneva, sans-serif; font-size:10pt; line-height:1.5; color:#1A1A18; max-width:640px;">
${colegio.map(t => p(esc(t))).join('\n')}
<p style="margin:0;">--</p>
<div style="color:${AZUL};">
${p('Estimadas familias, 👋')}
${entrada.map(t => p(esc(t).replace(/\n/g, '<br>'))).join('\n')}
${p(`En el documento adjunto encontraréis <b>toda la información sobre ${esc(contenido)}</b>.`)}
${limite || enlaces.length ? p([
    ...(limite ? [`📅 <b>${esc(etiquetaLimite)}</b> ${esc(limite)}`] : []),
    ...enlaces.map(e => `🔗 <a href="${esc(e.url)}" style="color:${AZUL};">${esc(e.texto)}</a>`)
  ].join('<br>')) : ''}
</div>
</div>`;
  return { texto, html };
}

module.exports = { correoCircular, contenidoCircular };
