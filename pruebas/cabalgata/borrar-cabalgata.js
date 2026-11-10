// Borra la Cabalgata de prueba y TODAS las cuentas de prueba (las que llevan
// «ampa-prueba-» en el email), con sus inscripciones, postulaciones y
// documentos firmados. Nunca toca datos de familias reales.
const fs = require('fs');
const path = require('path');
const limpiar = require('../ayudantes/limpiar');

limpiar().then(() => {
  const archivo = path.join(__dirname, 'cuentas-de-prueba.txt');
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  console.log('Datos de prueba borrados.');
}).catch(e => { console.error('[!] No se pudo borrar todo: ' + e.message); process.exit(1); });
