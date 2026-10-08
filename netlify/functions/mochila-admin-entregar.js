// La Junta pulsa «Entregar mochila»: la familia del puesto 1 recibe el
// turno y el email; tiene 24 h para aceptarla en la web.

const { accionMochila } = require('./_lib/mochila');

exports.handler = (event) => accionMochila(event, 'mochila_admin_entregar', { soloAdmin: true });
