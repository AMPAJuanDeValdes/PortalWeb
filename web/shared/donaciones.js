// Lo que el AMPA recoge como donación (lo comparten donar.html,
// admin-donaciones.html y la función de Netlify `donacion`).
(function (raiz) {
  const DONACIONES = {
    instrumentos: ['Carillón', 'Flauta'],
    extraescolares: ['Kimono', 'Chándal del equipo de fútbol', 'Pantalón de fútbol'],
    tiposUniforme: ['Sudadera', 'Pantalón Largo', 'Pantalón Corto', 'Camiseta', 'Baby'],
    tallas: ['1', '2', '3', '4', '6', '8', '10', '12', '14', '16', '18', '20'],
    tallasBaby: ['1', '2', '3', '4', '6'],
    maxCantidad: 20,
    // Texto de una línea de la donación
    texto(i) {
      if (i.categoria === 'libros') return `Libro «${i.titulo}»${i.curso ? ', ' + i.curso : ''}`;
      if (i.categoria === 'uniformes') return `${i.tipo} del uniforme, talla ${i.talla}`;
      if (i.categoria === 'instrumentos') return String(i.articulo || '');
      if (i.categoria === 'extraescolares') return `${i.articulo}${i.talla ? ', talla ' + i.talla : ''}`;
      return String(i.articulo || '');
    },
    // Línea con la cantidad: «Camiseta del uniforme, talla 20 · 2 unidades»
    linea(i) {
      const n = Number(i.cantidad) || 1;
      return `${this.texto(i)} · ${n} ${n === 1 ? 'unidad' : 'unidades'}`;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DONACIONES; else raiz.DONACIONES = DONACIONES;
})(this);
