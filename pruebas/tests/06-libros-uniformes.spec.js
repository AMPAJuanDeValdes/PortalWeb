// 6. Libros y uniformes (solo lo que se puede probar sin tocar las
//    convocatorias reales: catálogo, movimientos de stock y compras).
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, entrar, aceptarDialogos, MARCA } = require('../ayudantes/datos');

test.describe.configure({ mode: 'default' });

test.describe('Libros y uniformes', () => {
  let jefe;
  // Combinación que no existe en el stock real del AMPA (se crea y se borra)
  const TIPO = 'Sudadera', TALLA = '18';

  test.beforeAll(async () => {
    jefe = await crearFamilia({ etiqueta: 'adminlu', esAdmin: true });
  });
  test.beforeEach(async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
  });

  test('Catálogo de libros: están los 20 títulos y Coraline sirve para 1º y 2º ESO', async ({ page }) => {
    const { count } = await admin.from('libros_catalogo').select('id', { count: 'exact', head: true });
    expect(count).toBeGreaterThanOrEqual(20);
    await page.goto('/admin-libros.html');
    const fila = page.locator('#listaWrap tr', { hasText: 'Coraline' });
    await expect(fila).toContainText('1º ESO, 2º ESO');
  });

  test('Uniformes: registrar entrada y salida de stock actualiza la tabla', async ({ page }) => {
    const { data: existe } = await admin.from('prendas_catalogo').select('id').eq('tipo', TIPO).eq('talla', TALLA);
    test.skip(existe && existe.length > 0, `Ya existe ${TIPO} talla ${TALLA} en vuestro stock: no la toco.`);

    await page.goto('/admin-uniformes.html');
    await page.selectOption('#mTipo', TIPO);
    await page.selectOption('#mTalla', TALLA);
    await page.fill('#mCantidad', '3');
    await page.fill('#mMotivo', MARCA + 'prueba');
    await page.click('#mBtn');
    await expect(page.locator('#mMsg')).toContainText('ahora hay 3');
    await expect(page.locator(`td.celda[data-tipo="${TIPO}"][data-talla="${TALLA}"]`)).toHaveText('3');

    await page.selectOption('#mOperacion', 'restar');
    await page.fill('#mCantidad', '5');
    await page.click('#mBtn');
    await expect(page.locator('#mMsg')).toContainText('Solo quedan 3');

    await page.fill('#mCantidad', '3');
    await page.click('#mBtn');
    await expect(page.locator('#mMsg')).toContainText('ahora hay 0');
    await expect(page.locator('#movWrap')).toContainText(MARCA + 'prueba');

    // y se puede eliminar la combinación (está a 0 y nadie la ha pedido)
    await page.selectOption('#delSelect', { label: `${TIPO} talla ${TALLA}` });
    await page.click('#delBtn');
    await expect(page.locator('#delMsg')).toContainText('Eliminada');
  });

  test('Libros: registrar una compra la suma a los totales y al gasto', async ({ page }) => {
    await page.goto('/admin-libros.html');
    await page.click('.tab-btn[data-tab="demanda"]');
    const fila = page.locator('#dTablaWrap tr', { hasText: 'Tales from Camelot' });
    await expect(fila).toBeVisible();
    await fila.locator('.cCant').fill('2');
    await fila.locator('.cEstado').selectOption('reservado');
    await fila.locator('.cTienda').fill(MARCA + 'tienda');
    await fila.locator('.cCoste').fill('9.90');
    await fila.locator('.cBtn').click();
    await expect(page.locator('#dMsg')).toContainText('Compra registrada');
    await expect(page.locator('#hWrap')).toContainText(MARCA + 'tienda');
    const { data } = await admin.from('libros_compras').select('cantidad, estado, coste, creado_por_nombre').eq('tienda', MARCA + 'tienda');
    expect(data[0]).toMatchObject({ cantidad: 2, estado: 'reservado', coste: 9.9 });
    expect(data[0].creado_por_nombre).toContain('Prueba');
  });

  test('Familia: el préstamo solo ofrece los libros del curso de cada hijo/a', async ({ page }) => {
    const { data: conv } = await admin.from('prestamo_convocatorias').select('estado, fecha_cierre').order('created_at', { ascending: false }).limit(1);
    const abierta = conv && conv[0] && conv[0].estado === 'abierta' && new Date(conv[0].fecha_cierre) > new Date();
    test.skip(!abierta, 'No hay ninguna convocatoria de préstamo abierta ahora mismo.');
    const fam = await crearFamilia({ etiqueta: 'prestamo' });
    await admin.from('alumnos').insert({ socio_id: fam.socio.id, nombre: 'Lector', apellidos: 'Prueba', etapa: 'ESO', curso: '2º' });
    await page.goto('/login.html');
    await entrar(page, fam.adultos[0].email);
    await page.goto('/prestamo.html');
    await page.selectOption('#alumnoSelect', { label: 'Lector Prueba — 2º ESO' });
    await expect(page.locator('#librosWrap')).toContainText('Coraline');
    await expect(page.locator('#librosWrap')).toContainText('Diebstahl im Museum');
    await expect(page.locator('#librosWrap')).not.toContainText('Unheimliches im Wald');   // es de 1º ESO
  });
});
