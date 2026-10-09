// Servidor para probar la web EN TU ORDENADOR, sin subir nada a Netlify.
// Lo arranca probar-en-local.bat (doble clic). Abre http://localhost:8888
//
// · Sirve las páginas igual que Netlify (index.html, shared/, assets/...).
// · Ejecuta las funciones de netlify/functions (altas, donaciones, Mochila...)
//   con las mismas claves que usan las pruebas automáticas:
//     - C:\Users\<tú>\ampa-pruebas.env   → SUPABASE_SERVICE_ROLE_KEY (y SMTP_* si
//       quieres que salgan los emails; si no están, todo funciona salvo el envío)
//     - shared/config.js                → SUPABASE_URL y SUPABASE_ANON_KEY
// · Cada 15 minutos hace la revisión de la Mochila (como en Netlify).
//
// OJO: los datos son los REALES de Supabase (la misma base que la web).
// No usa ninguna librería extra: solo Node.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.env.PUERTO || 8888);
const FUNCIONES = path.join(RAIZ, 'netlify', 'functions');

/* ---------- Claves ---------- */
function leerEnv(archivo) {
  const out = {};
  if (!fs.existsSync(archivo)) return out;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    if (linea.trim().startsWith('#')) continue;
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const config = fs.readFileSync(path.join(RAIZ, 'shared', 'config.js'), 'utf8');
const deConfig = (k) => { const m = config.match(new RegExp(k + "\\s*=\\s*['\"]([^'\"]+)")); return m && m[1]; };
const env = { SUPABASE_URL: deConfig('SUPABASE_URL'), SUPABASE_ANON_KEY: deConfig('SUPABASE_ANON_KEY'), ...leerEnv(path.join(os.homedir(), 'ampa-pruebas.env')) };
for (const [k, v] of Object.entries(env)) if (v && !process.env[k]) process.env[k] = v;
process.env.SITE_URL = `http://localhost:${PUERTO}`;   // los enlaces de los emails apuntan aquí

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || /\.\.\./.test(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.log('\n[!] Falta la clave SUPABASE_SERVICE_ROLE_KEY en ' + path.join(os.homedir(), 'ampa-pruebas.env'));
  console.log('    Las páginas se verán, pero las altas, donaciones, Mochila... darán error.\n');
}
if (!process.env.SMTP_HOST) console.log('[i] Sin SMTP_* en ampa-pruebas.env: los emails no se enviarán (todo lo demás funciona).');

/* ---------- Funciones de Netlify ---------- */
function cargarFuncion(nombre) {
  const archivo = path.join(FUNCIONES, nombre + '.js');
  if (!/^[\w-]+$/.test(nombre) || !fs.existsSync(archivo)) return null;
  // Se recarga en cada llamada: si cambias una función, no hace falta reiniciar
  Object.keys(require.cache).filter(k => k.startsWith(FUNCIONES)).forEach(k => delete require.cache[k]);
  return require(archivo).handler;
}
async function ejecutarFuncion(nombre, req, res, url) {
  const handler = cargarFuncion(nombre);
  if (!handler) { res.writeHead(404); res.end('No existe la función ' + nombre); return; }
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const event = {
    httpMethod: req.method, path: url.pathname, headers: req.headers,
    queryStringParameters: Object.fromEntries(url.searchParams), body: Buffer.concat(trozos).toString('utf8'),
    isBase64Encoded: false
  };
  try {
    const r = (await handler(event, {})) || { statusCode: 200 };
    res.writeHead(r.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8', ...(r.headers || {}) });
    res.end(r.isBase64Encoded ? Buffer.from(r.body || '', 'base64') : (r.body || ''));
    console.log(`  función ${nombre} → ${r.statusCode || 200}`);
  } catch (e) {
    console.error(`  función ${nombre} → ERROR`, e);
    res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
  }
}

/* ---------- Archivos ---------- */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp', '.csv': 'text/csv; charset=utf-8' };
function servirArchivo(url, res) {
  let ruta = decodeURIComponent(url.pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = path.normalize(path.join(RAIZ, ruta));
  // Como en Netlify: nada fuera del proyecto, ni las pruebas, ni dependencias
  const prohibido = !archivo.startsWith(RAIZ) || /[\\/](pruebas|node_modules|\.git|netlify)[\\/]/.test(archivo.slice(RAIZ.length) + '/');
  if (prohibido || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(RAIZ, 'index.html')));
    return;
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(archivo).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const m = url.pathname.match(/^\/\.netlify\/functions\/([\w-]+)/);
  if (m) return ejecutarFuncion(m[1], req, res, url);
  servirArchivo(url, res);
}).listen(PUERTO, () => {
  console.log(`\n  Web del AMPA en tu ordenador: http://localhost:${PUERTO}`);
  console.log('  (datos REALES de Supabase · cierra esta ventana para pararla)\n');
});

// La revisión de la Mochila, como la tarea programada de Netlify
setInterval(async () => {
  const h = cargarFuncion('mochila-caducar');
  if (h) { try { await h({ httpMethod: 'POST', headers: {}, body: '' }, {}); } catch (e) { console.error('Mochila:', e.message); } }
}, 15 * 60 * 1000);
