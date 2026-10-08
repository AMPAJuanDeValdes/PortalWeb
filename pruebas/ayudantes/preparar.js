// Antes de empezar: comprueba que la web y Supabase responden, y borra
// restos de ejecuciones anteriores que se hubieran cortado a medias.
const { cargarEntorno } = require('./entorno');

module.exports = async function preparar() {
  cargarEntorno();
  const resp = await fetch(process.env.SITE_URL + '/login.html').catch(e => ({ ok: false, statusText: e.message }));
  if (!resp.ok) throw new Error(`No se puede abrir ${process.env.SITE_URL}/login.html (${resp.status || ''} ${resp.statusText}). Revisa SITE_URL en ampa-pruebas.env (tu carpeta de usuario)`);

  const { admin } = require('./datos');
  const { error } = await admin.from('socios').select('id', { count: 'exact', head: true });
  if (error) throw new Error('No se puede conectar con Supabase: ' + error.message + '. Revisa SUPABASE_SERVICE_ROLE_KEY en ampa-pruebas.env (tu carpeta de usuario)');

  const { error: errMig } = await admin.from('recuperaciones_password').select('id', { head: true });
  if (errMig) throw new Error('Falta ejecutar supabase/migracion-gestion-cuentas.sql en Supabase (' + errMig.message + ')');
  const { error: errMig2 } = await admin.from('libros_compras').select('id', { head: true });
  if (errMig2) throw new Error('Falta ejecutar supabase/migracion-libros-uniformes.sql en Supabase (' + errMig2.message + ')');

  const { data: titulos } = await admin.from('libros_catalogo').select('titulo');
  const vistos = new Set(), repetidos = new Set();
  (titulos || []).forEach(t => { const k = t.titulo.trim().toLowerCase(); (vistos.has(k) ? repetidos : vistos).add(k); });
  if (repetidos.size) throw new Error('Hay títulos repetidos en el catálogo de libros (' + [...repetidos].join(', ') + '). Ejecuta supabase/migracion-fusionar-libros-repetidos.sql en Supabase');

  await require('./limpiar')();
  console.log(`\n▶ Probando ${process.env.SITE_URL} (ejecución ${process.env.RUN_ID})\n`);
};
