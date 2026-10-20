// Datos comunes del Banco de Uniformes y del Banco de Libros para los avisos
// en el móvil y las circulares de sus convocatorias.
const ZONA = { timeZone: 'Europe/Madrid' };
const fechaHoraTexto = (f) => new Date(f).toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' })
  + ' a las ' + new Date(f).toLocaleTimeString('es-ES', { ...ZONA, hour: '2-digit', minute: '2-digit' });

const BANCOS = {
  uniformes: {
    tabla: 'uniformes_convocatorias', pagina: 'uniformes.html', nombre: 'Banco de Uniformes',
    tituloAviso: 'Banco de Uniformes: nuevo reparto',
    asunto: 'Banco de Uniformes: nuevo reparto',
    texto: (conv, web) => [
      'Hola, familias:', '',
      'Hemos abierto un nuevo reparto del Banco de Uniformes.', '',
      `Podéis pedir hasta el ${fechaHoraTexto(conv.fecha_cierre)}.`, '',
      'Cada alumno o alumna recibe una sola prenda. Al pedir, elegís 3 por orden de prioridad: intentamos daros la primera; la segunda y la tercera son por si no hay suficientes de la primera.', '',
      `Para pedir, entrad en la web del AMPA:\n${web}/uniformes.html`
    ].join('\n')
  },
  libros: {
    tabla: 'prestamo_convocatorias', pagina: 'prestamo.html', nombre: 'Banco de Libros',
    tituloAviso: 'Banco de Libros: ya podéis pedir',
    asunto: 'Banco de Libros: ya podéis pedir los libros',
    texto: (conv, web) => [
      'Hola, familias:', '',
      'Hemos abierto la convocatoria del Banco de Libros.', '',
      `Podéis pedir los libros hasta el ${fechaHoraTexto(conv.fecha_cierre)}.`, '',
      'Elegid a cada alumno o alumna y marcad los libros que necesitáis para su curso.', '',
      `Para pedir, entrad en la web del AMPA:\n${web}/prestamo.html`
    ].join('\n')
  }
};

module.exports = { BANCOS, fechaHoraTexto };
