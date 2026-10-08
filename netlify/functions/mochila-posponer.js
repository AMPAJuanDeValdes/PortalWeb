// La familia con turno pulsa «Esperar una semana más»: cambia el puesto
// con la familia de detrás, que recibe el turno y el email al momento.

const { accionMochila } = require('./_lib/mochila');

exports.handler = (event) => accionMochila(event, 'mochila_esperar_semana');
