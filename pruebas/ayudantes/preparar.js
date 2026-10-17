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

  // Comprueba que la base de datos está al día (lo más reciente de schema.sql)
  const comprobaciones = [['mochila_compromisos', 'socio_id'], ['prestamo_items', 'a_mano'], ['comprobantes_pago', 'pago_id'], ['evento_incompatibles', 'evento_a'], ['evento_sesiones', 'numero'], ['evento_inscripciones', 'recoge_otra'], ['socios', 'sepa_pendiente'], ['curso_bajas', 'alumno_id'], ['push_suscripciones', 'endpoint']];
  for (const [tabla, columna] of comprobaciones) {
    const { error: errMig } = await admin.from(tabla).select(columna, { head: true });
    if (errMig) throw new Error('La base de datos no está al día: ejecuta en Supabase lo que haya en supabase/pendientes/ (' + errMig.message + ')');
  }

  await require('./limpiar')();
  console.log(`\n▶ Probando ${process.env.SITE_URL} (ejecución ${process.env.RUN_ID})\n`);
};
