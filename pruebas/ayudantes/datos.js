// Utilidades compartidas por todas las pruebas: crear familias de prueba
// directamente en la base de datos, iniciar sesión, llamar a funciones...
// Todo lo que se crea lleva "ampa-prueba-" en el email para poder borrarlo.
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { cargarEntorno } = require('./entorno');
cargarEntorno();

const MARCA = 'ampa-prueba-';
// Fecha de cierre que marca las convocatorias de préstamo abiertas por las pruebas
const CIERRE_PRUEBA = '2099-12-31T23:59:59Z';
const PASSWORD = 'Prueba-1234!';
const COMPROBANTE = path.join(__dirname, '..', 'fixtures', 'comprobante.pdf');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let contador = 0;
// tu.email@gmail.com → tu.email+ampa-prueba-<run>-<etiqueta><n>@gmail.com
function emailPrueba(etiqueta) {
  const [local, dominio] = process.env.EMAIL_PRUEBAS.split('@');
  const sep = local.includes('+') ? '-' : '+';
  contador++;
  // Sufijo al azar: si una prueba falla, Playwright reinicia y el contador vuelve a 0
  const azar = Math.random().toString(36).slice(2, 6);
  return `${local}${sep}${MARCA}${process.env.RUN_ID}-${etiqueta}${contador}${azar}@${dominio}`.toLowerCase();
}

function dniPrueba() {
  const n = Math.floor(10000000 + Math.random() * 89999999);
  return n + 'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23];
}

async function ok(promesa, que) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${que}: ${error.message}`);
  return data;
}

// Crea una familia completa directamente en la base de datos.
async function crearFamilia({ etiqueta = 'fam', estado = 'activa', adultos = 1, alumnos = 0,
  esAdmin = false, forzarCambioClave = false, conNumero = false, datosRevisados = true } = {}) {
  const socio = await ok(admin.from('socios').insert({
    anio_ultima_cuota: new Date().getFullYear(), estado,
    datos_revisados_en: datosRevisados ? new Date().toISOString() : null,
    numero_secuencial: conNumero ? await siguienteNumeroLibre() : null
  }).select('*').single(), 'crear socio');

  const listaAdultos = [];
  for (let i = 0; i < adultos; i++) {
    const email = emailPrueba(etiqueta);
    const u = await ok(admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }), 'crear usuario');
    const fila = {
      id: u.user.id, socio_id: socio.id, nombre: i === 0 ? 'Prueba' : 'Segunda', apellidos: 'Automática ' + etiqueta,
      dni_nie: dniPrueba(), email, direccion: 'Calle de las Pruebas 1', ciudad: 'Madrid', provincia: 'Madrid',
      codigo_postal: '28022', movil: '600000000', role: esAdmin && i === 0 ? 'admin' : 'socio',
      force_password_change: forzarCambioClave
    };
    await ok(admin.from('adultos').insert(fila), 'crear adulto');
    listaAdultos.push({ ...fila, password: PASSWORD });
  }

  const listaAlumnos = [];
  for (let i = 0; i < alumnos; i++) {
    const al = await ok(admin.from('alumnos').insert({
      socio_id: socio.id, nombre: 'Alumno' + (i + 1), apellidos: 'Prueba', etapa: 'Primaria', curso: '3º',
      fecha_nacimiento: '2017-05-0' + (i + 1)
    }).select('*').single(), 'crear alumno');
    listaAlumnos.push(al);
  }
  return { socio, adultos: listaAdultos, alumnos: listaAlumnos };
}

async function siguienteNumeroLibre() {
  // Un número alto que no choque con socios reales
  for (let i = 0; i < 20; i++) {
    const n = String(9000 + Math.floor(Math.random() * 999)).padStart(4, '0');
    const { data } = await admin.from('socios').select('id').eq('numero_secuencial', n).limit(1);
    if (!data || !data.length) return n;
  }
  throw new Error('No se encontró un número de socio libre para la prueba');
}

async function socioPorEmail(email) {
  const { data } = await admin.from('adultos').select('socio_id, socios(*)').ilike('email', email).limit(1);
  return data && data[0] ? data[0].socios : null;
}

// Cliente de Supabase "como un usuario" (con sus permisos reales)
async function clienteComo(email, password = PASSWORD) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  await ok(c.auth.signInWithPassword({ email, password }), 'iniciar sesión ' + email);
  const { data } = await c.auth.getSession();
  return { cliente: c, token: data.session.access_token };
}

async function llamarFuncion(nombre, cuerpo, token) {
  const resp = await fetch(`${process.env.SITE_URL}/.netlify/functions/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(cuerpo || {})
  });
  let json = {};
  try { json = await resp.json(); } catch (e) {}
  return { status: resp.status, json };
}

// Inicia sesión en el navegador desde login.html
async function entrar(page, email, password = PASSWORD) {
  await page.goto('/login.html');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#submitBtn');
}

// Acepta automáticamente los confirm()/alert() de las páginas
function aceptarDialogos(page) {
  page.on('dialog', d => d.accept().catch(() => {}));
}

module.exports = {
  CIERRE_PRUEBA,
  admin, MARCA, PASSWORD, COMPROBANTE, emailPrueba, dniPrueba, crearFamilia, socioPorEmail,
  clienteComo, llamarFuncion, entrar, aceptarDialogos, siguienteNumeroLibre
};
