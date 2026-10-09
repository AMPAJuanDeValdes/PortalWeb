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

  // Eventos de prueba (y sus inscripciones, en cascada) antes de borrar
  // a las familias, que si no quedan referenciadas
  await admin.from('eventos').delete().ilike('titulo', `${MARCA}%`);
  if (socios.length) await admin.from('evento_inscripciones').delete().in('socio_id', socios);

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

  // 6b. Donaciones de prueba, lo que movieron en el stock donado y los
  //     libros que pasaron al banco con un código de prueba
  const { data: movsDonado } = await admin.from('donado_movimientos').select('id, clave, cantidad, accion').ilike('creado_por_nombre', '%Automática%');
  const saldo = {};
  (movsDonado || []).forEach(m => { saldo[m.clave] = (saldo[m.clave] || 0) + (m.accion === 'entra' ? m.cantidad : -m.cantidad); });
  for (const [clave, n] of Object.entries(saldo)) {
    if (n <= 0) continue;
    const { data: fila } = await admin.from('donado_stock').select('id, cantidad').eq('clave', clave).maybeSingle();
    if (fila) await admin.from('donado_stock').update({ cantidad: Math.max(0, fila.cantidad - n) }).eq('id', fila.id);
  }
  if ((movsDonado || []).length) await admin.from('donado_movimientos').delete().in('id', movsDonado.map(m => m.id));
  await admin.from('donaciones').delete().ilike('email', `%${MARCA}%`);
  await admin.from('libros_ejemplares').delete().ilike('codigo', `${MARCA}%`);

  // 7. Convocatoria de préstamo de prueba que se hubiera quedado abierta
  const { CIERRE_PRUEBA } = require('./datos');
  await admin.from('prestamo_convocatorias').delete().eq('fecha_cierre', CIERRE_PRUEBA);

  if (ids.length || socios.length) {
    console.log(`\n🧹 Limpieza: ${ids.length} usuario(s) y ${socios.length} familia(s) de prueba borrados.`);
  }
};
