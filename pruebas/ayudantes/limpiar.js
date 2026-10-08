// Borra TODO lo creado por las pruebas (esta ejecución y restos de
// ejecuciones anteriores que se hubieran cortado): usuarios de acceso,
// familias, alumnos, inscripciones, etc. Solo toca cuentas cuyo email
// contiene "ampa-prueba-", nunca datos reales.
const { cargarEntorno } = require('./entorno');

module.exports = async function limpiar() {
  cargarEntorno();
  const { admin, MARCA } = require('./datos');

  // 1. Usuarios de acceso de prueba
  const usuarios = [];
  for (let pagina = 1; pagina < 50; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) throw new Error('No se pudieron listar los usuarios: ' + error.message);
    usuarios.push(...data.users.filter(u => (u.email || '').includes(MARCA)));
    if (data.users.length < 1000) break;
  }

  // 2. Familias a las que pertenecen (por la ficha de adulto)
  const ids = usuarios.map(u => u.id);
  let socios = [];
  if (ids.length) {
    const { data } = await admin.from('adultos').select('socio_id').in('id', ids);
    socios = [...new Set((data || []).map(a => a.socio_id))];
  }
  // También familias cuyos adultos tengan la marca en el email (por si el
  // email de acceso se cambió durante una prueba)
  const { data: porEmail } = await admin.from('adultos').select('id, socio_id').ilike('email', `%${MARCA}%`);
  (porEmail || []).forEach(a => { if (!socios.includes(a.socio_id)) socios.push(a.socio_id); if (!ids.includes(a.id)) ids.push(a.id); });

  // 3. Salir de la cola de la Mochila de forma ordenada no es posible sin
  //    sesión; se borran sus entradas (las familias de prueba van al final)
  if (socios.length) await admin.from('mochila_cola').delete().in('socio_id', socios);

  // 4. Borrar usuarios (sus fichas de adulto se borran en cascada) y familias
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  if (socios.length) await admin.from('socios').delete().in('id', socios);

  // 5. Registro de "recuperar contraseña"
  await admin.from('recuperaciones_password').delete().ilike('email', `%${MARCA}%`);

  // 6. Compras y movimientos de stock de prueba (marcados con la MARCA)
  await admin.from('libros_compras').delete().ilike('tienda', `%${MARCA}%`);
  const { data: movs } = await admin.from('prendas_movimientos').select('tipo, talla').ilike('motivo', `%${MARCA}%`);
  for (const m of movs || []) {
    // la combinación creada por la prueba se borra solo si quedó a 0
    await admin.from('prendas_catalogo').delete().eq('tipo', m.tipo).eq('talla', m.talla).eq('stock', 0);
  }
  await admin.from('prendas_movimientos').delete().ilike('motivo', `%${MARCA}%`);

  if (ids.length || socios.length) {
    console.log(`\n🧹 Limpieza: ${ids.length} usuario(s) y ${socios.length} familia(s) de prueba borrados.`);
  }
};
