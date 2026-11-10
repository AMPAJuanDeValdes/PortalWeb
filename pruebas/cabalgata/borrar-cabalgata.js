// Borra la Cabalgata de prueba y TODAS las cuentas de prueba (las que llevan
// «ampa-prueba-» en el email), con sus inscripciones, postulaciones y
// documentos firmados. Nunca toca datos de familias reales.
const fs = require('fs');
const path = require('path');
const limpiar = require('../ayudantes/limpiar');
const REGISTRO = path.join(__dirname, 'registro-prueba.txt');
const anotar = (t) => { console.log(t); try { fs.appendFileSync(REGISTRO, t + '\n', 'utf8'); } catch (e) { /* sin registro */ } };
anotar(`\n=== Borrar los datos de prueba (${new Date().toLocaleString('es-ES')}) ===`);

limpiar().then(() => {
  const archivo = path.join(__dirname, 'cuentas-de-prueba.txt');
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  anotar('Datos de prueba borrados.');
}).catch(e => { anotar('[!] No se pudo borrar todo: ' + e.message); process.exit(1); });
