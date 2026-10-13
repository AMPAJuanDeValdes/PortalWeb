// Carta de compromiso de buen uso de la Mochila Jugona Exploradora.
// Escribe los datos de la familia y su firma sobre la carta original
// (assets/carta-compromiso-mochila.pdf) en posiciones fijas, en puntos PDF.
// Usa cargarPdfLib() y montarPadFirma() de shared/mandatoSepa.js.
//
//   generarCompromisoMochilaPdf(datos) -> Promise<Blob>
//     datos: { nombre, dni, numeroSocio, telefono, fechaEntrega, fechaDevolucion, firmaPng }
//
// Si se cambia la carta por otra con distinta maquetación, hay que ajustar
// POSICIONES_CARTA (x, y de la línea base desde ARRIBA, ancho máximo).

const PLANTILLA_CARTA_MOCHILA = 'assets/carta-compromiso-mochila.pdf';

const POSICIONES_CARTA = {
  nombre:          { x: 44,  y: 679, ancho: 338 },
  dni:             { x: 448, y: 679, ancho: 128 },
  numeroSocio:     { x: 119, y: 702, ancho: 96 },
  telefono:        { x: 284, y: 702, ancho: 174 },
  fechaEntrega:    { x: 128, y: 772, ancho: 150 },
  fechaDevolucion: { x: 414, y: 772, ancho: 150 },
  firma:           { x: 62,  y: 836, ancho: 170, alto: 40 }   // y = borde inferior
};

async function generarCompromisoMochilaPdf(datos) {
  await cargarPdfLib();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const resp = await fetch(PLANTILLA_CARTA_MOCHILA);
  if (!resp.ok) throw new Error('No se encontró la carta de compromiso.');
  const pdf = await PDFDocument.load(await resp.arrayBuffer());
  const pagina = pdf.getPages()[0];
  const alto = pagina.getHeight();
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const tinta = rgb(0.05, 0.12, 0.35);

  function escribir(clave, texto) {
    const p = POSICIONES_CARTA[clave];
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    let tam = 11;
    while (tam > 6 && fuente.widthOfTextAtSize(t, tam) > p.ancho) tam -= 0.5;
    pagina.drawText(t, { x: p.x, y: alto - p.y, size: tam, font: fuente, color: tinta });
  }
  ['nombre', 'dni', 'numeroSocio', 'telefono', 'fechaEntrega', 'fechaDevolucion'].forEach(k => escribir(k, datos[k]));

  if (datos.firmaPng) {
    const img = await pdf.embedPng(datos.firmaPng);
    const p = POSICIONES_CARTA.firma;
    const escala = Math.min(p.ancho / img.width, p.alto / img.height);
    pagina.drawImage(img, { x: p.x, y: alto - p.y, width: img.width * escala, height: img.height * escala });
  }
  pdf.setTitle('Mochila Jugona Exploradora · Compromiso de buen uso');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
