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

  const { error: errMig3 } = await admin.from('eventos').select('pide_alergias', { head: true });
  if (errMig3) throw new Error('Falta ejecutar supabase/migracion-eventos-v2.sql en Supabase (' + errMig3.message + ')');

  const { error: errDatos } = await admin.from('socios').select('datos_revisados_en', { head: true });
  if (errDatos) throw new Error('Falta ejecutar supabase/migracion-datos-familia.sql en Supabase (' + errDatos.message + ')');

  const { error: errMochila } = await admin.from('mochila_juegos').select('id', { head: true });
  if (errMochila) throw new Error('Falta ejecutar supabase/migracion-mochila-v2.sql en Supabase (' + errMochila.message + ')');

  const { error: errDon } = await admin.from('donaciones').select('items', { head: true });
  if (errDon) throw new Error('Falta ejecutar supabase/migracion-donaciones.sql en Supabase (' + errDon.message + ')');
  const { error: errDonado } = await admin.from('donado_stock').select('id', { head: true });
  if (errDonado) throw new Error('Falta ejecutar supabase/migracion-donado.sql en Supabase (' + errDonado.message + ')');
  const { error: errLot } = await admin.from('eventos').select('lugar', { head: true });
  if (errLot) throw new Error('Falta ejecutar supabase/migracion-loteria.sql en Supabase (' + errLot.message + ')');
  const { error: errSeg } = await admin.from('mochila_cola').select('aviso_enviado_en', { head: true });
  if (errSeg) throw new Error('Falta ejecutar supabase/migracion-revision-seguridad.sql en Supabase (' + errSeg.message + ')');

  const { data: titulos } = await admin.from('libros_catalogo').select('titulo');
  const vistos = new Set(), repetidos = new Set();
  (titulos || []).forEach(t => { const k = t.titulo.trim().toLowerCase(); (vistos.has(k) ? repetidos : vistos).add(k); });
  if (repetidos.size) throw new Error('Hay títulos repetidos en el catálogo de libros (' + [...repetidos].join(', ') + '). Ejecuta supabase/migracion-fusionar-libros-repetidos.sql en Supabase');

  await require('./limpiar')();
  console.log(`\n▶ Probando ${process.env.SITE_URL} (ejecución ${process.env.RUN_ID})\n`);
};
