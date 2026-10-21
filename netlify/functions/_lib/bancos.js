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
    // Circular («Enviar circular»): ver _lib/circular.js
    circular: (conv, web) => ({
      titulo: 'Banco de Uniformes', subtitulo: 'Nuevo reparto',
      entrada: ['Hemos abierto un nuevo reparto del Banco de Uniformes.'],
      apartados: [
        { titulo: 'Cómo funciona', puntos: [
          'Cada alumno o alumna recibe una sola prenda.',
          'Al pedir, elegís 3 por orden de prioridad: intentamos daros la primera; la segunda y la tercera son por si no hay suficientes de la primera.'
        ] },
        { titulo: 'Cómo pedir', puntos: [
          { texto: 'Pedir en la web del AMPA', enlace: `${web}/uniformes.html` },
          { etiqueta: 'Fecha límite:', texto: fechaHoraTexto(conv.fecha_cierre) }
        ] }
      ]
    })
  },
  libros: {
    tabla: 'prestamo_convocatorias', pagina: 'prestamo.html', nombre: 'Banco de Libros',
    tituloAviso: 'Banco de Libros: ya podéis pedir',
    asunto: 'Banco de Libros: ya podéis pedir los libros',
    circular: (conv, web) => ({
      titulo: 'Banco de Libros', subtitulo: 'Ya podéis pedir los libros',
      entrada: ['Hemos abierto la convocatoria del Banco de Libros.'],
      apartados: [
        { titulo: 'Cómo pedir', puntos: [
          'Elegid a cada alumno o alumna y marcad los libros que necesitáis para su curso.',
          { texto: 'Pedir en la web del AMPA', enlace: `${web}/prestamo.html` },
          { etiqueta: 'Fecha límite:', texto: fechaHoraTexto(conv.fecha_cierre) }
        ] }
      ]
    })
  }
};

module.exports = { BANCOS, fechaHoraTexto };
