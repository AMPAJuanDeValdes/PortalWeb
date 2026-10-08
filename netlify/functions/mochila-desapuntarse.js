// La familia se desapunta: la lista sube un puesto. Si tenía el turno,
// pasa a la siguiente familia, que recibe el email.

const { accionMochila } = require('./_lib/mochila');

exports.handler = (event) => accionMochila(event, 'mochila_desapuntarse');
