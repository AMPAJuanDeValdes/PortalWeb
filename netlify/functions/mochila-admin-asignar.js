// La Junta pulsa «Asignar»: la siguiente familia de la lista recibe el
// turno de la semana siguiente y el email con las fechas; tiene 24 h para aceptarla en la
// web. Se puede asignar aunque otra familia tenga la mochila en casa.

const { accionMochila } = require('./_lib/mochila');

// Body opcional: { entrega: 'YYYY-MM-DD', devolucion: 'YYYY-MM-DD' } (fechas que pone la Junta)
const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
exports.handler = (event) => accionMochila(event, 'mochila_admin_asignar', {
  soloAdmin: true,
  parametros: (b) => ({ p_entrega: fecha(b.entrega), p_devolucion: fecha(b.devolucion) })
});
