// Carga la configuración de las pruebas:
//  - ampa-pruebas.env en TU CARPETA DE USUARIO (C:\Users\<tú>\ampa-pruebas.env)
//    → SITE_URL, SUPABASE_SERVICE_ROLE_KEY, EMAIL_PRUEBAS
//    Está fuera del proyecto a propósito: así la clave secreta nunca puede
//    acabar subida a GitHub ni publicada en la web por error.
//  - ../shared/config.js    → SUPABASE_URL y SUPABASE_ANON_KEY (las públicas)
// y fija un identificador de esta ejecución (RUN_ID) para marcar todo lo
// que se crea y poder borrarlo al final.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ARCHIVO_ENV = path.join(os.homedir(), 'ampa-pruebas.env');

function leerEnv(archivo) {
  if (!fs.existsSync(archivo)) return {};
  const out = {};
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !linea.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function leerConfigPublica() {
  const archivo = path.join(__dirname, '..', '..', 'shared', 'config.js');
  if (!fs.existsSync(archivo)) return {};
  const txt = fs.readFileSync(archivo, 'utf8');
  const url = txt.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
  const key = txt.match(/SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
  return { SUPABASE_URL: url && url[1], SUPABASE_ANON_KEY: key && key[1] };
}

function cargarEntorno() {
  if (process.env.__AMPA_ENTORNO_CARGADO) return;
  const env = { ...leerConfigPublica(), ...leerEnv(ARCHIVO_ENV) };
  for (const [k, v] of Object.entries(env)) if (v && !process.env[k]) process.env[k] = v;

  const faltan = ['SITE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'EMAIL_PRUEBAS']
    .filter(k => !process.env[k] || /\.\.\.|tu-sitio|tu\.email/.test(process.env[k]));
  if (faltan.length) {
    throw new Error('Faltan datos en ' + ARCHIVO_ENV + ': ' + faltan.join(', ') +
      '\nAbre ese archivo y rellénalo (ejecutar-pruebas.bat lo crea la primera vez).');
  }
  process.env.SITE_URL = process.env.SITE_URL.replace(/\/$/, '');
  // Mismo identificador para el proceso principal y el de las pruebas
  if (!process.env.RUN_ID) process.env.RUN_ID = Date.now().toString(36);
  process.env.__AMPA_ENTORNO_CARGADO = '1';
}

module.exports = { cargarEntorno, ARCHIVO_ENV };
