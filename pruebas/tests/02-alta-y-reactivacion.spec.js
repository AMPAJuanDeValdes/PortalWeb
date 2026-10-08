// 2. Hazte socio, Reactivar cuenta y web pública
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, emailPrueba, socioPorEmail, COMPROBANTE, dniPrueba } = require('../ayudantes/datos');

async function rellenarAlta(page, email) {
  await page.goto('/hazte-socio.html');
  await page.fill('#a1Nombre', 'Prueba');
  await page.fill('#a1Apellidos', 'Autoservicio');
  await page.fill('#a1Email', email);
  await page.fill('#a1Dni', dniPrueba());
  await page.fill('#a1Password', 'Alta-1234');
  await page.fill('#a1Password2', 'Alta-1234');
  await page.fill('#a1Direccion', 'Calle de las Pruebas 2');
  await page.fill('#a1Ciudad', 'Madrid');
  await page.fill('#a1Provincia', 'Madrid');
  await page.fill('#a1Cp', '28022');
  await page.fill('#a1Movil', '611111111');
  await page.click('#addAlumnoBtn');
  const al = page.locator('.hijo-card').last();
  await al.locator('input[id^="alN_"]').fill('Hija');
  await al.locator('input[id^="alA_"]').fill('Autoservicio');
  await al.locator('input[id^="alF_"]').fill('2016-09-15');
  await al.locator('select[id^="alE_"]').selectOption('Primaria');
  await al.locator('select[id^="alC_"]').selectOption('4º');
  await page.setInputFiles('#comprobanteFile', COMPROBANTE);
}

// Si una prueba falla, las demás del grupo se siguen ejecutando
test.describe.configure({ mode: 'default' });

test.describe('Hazte socio y reactivación', () => {
  let baja, activa;
  const emailAlta = emailPrueba('alta');

  test.beforeAll(async () => {
    baja = await crearFamilia({ etiqueta: 'reactivar', estado: 'baja' });
    activa = await crearFamilia({ etiqueta: 'yaactiva' });
  });

  test('Web pública: entrar, eventos, hazte socio y reactivar a la vista', async ({ page }) => {
    await page.goto('/index.html');
    // (por texto, no por dirección: Netlify reescribe los enlaces "x.html" como "/x")
    await expect(page.locator('header').getByRole('link', { name: 'Entrar como socio' })).toBeVisible();
    await expect(page.locator('header').getByRole('link', { name: 'Eventos', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Hazte socio por/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reactivad vuestra cuenta' })).toBeVisible();
    await page.goto('/publico.html');
    await expect(page.getByRole('link', { name: /reactivar mi cuenta/i })).toBeVisible();
  });

  test('Hazte socio: muestra el IBAN real y el aviso de transferir antes', async ({ page }) => {
    await page.goto('/hazte-socio.html');
    await expect(page.locator('#datosPago')).toContainText('ES41 0049 4078 5026 1410 8578');
    await expect(page.locator('#pagoCard')).toContainText('ANTES');
  });

  test('Hazte socio vacío: marca en rojo los campos que faltan', async ({ page }) => {
    await page.goto('/hazte-socio.html');
    await page.click('#addAlumnoBtn');
    await page.click('#enviarBtn');
    await expect(page.locator('#msg')).toContainText('campos marcados en rojo');
    expect(await page.locator('.campo-error').count()).toBeGreaterThan(10);
    await expect(page.locator('input[id^="alF_"]')).toHaveClass(/campo-error/);   // fecha nacimiento obligatoria
    await expect(page.locator('#comprobanteFile')).toHaveClass(/campo-error/);
  });

  test('Hazte socio completo → solicitud con todos los datos y comprobante', async ({ page }) => {
    await rellenarAlta(page, emailAlta);
    await page.click('#enviarBtn');
    await expect(page).toHaveURL(/estado-recien-creada\.html/, { timeout: 45_000 });

    const socio = await socioPorEmail(emailAlta);
    expect(socio.estado).toBe('recien_creada');
    const { data: comp } = await admin.from('comprobantes_pago').select('archivo_url').eq('socio_id', socio.id);
    expect(comp.length).toBe(1);
    const { data: al } = await admin.from('alumnos').select('fecha_nacimiento, curso').eq('socio_id', socio.id);
    expect(al[0].fecha_nacimiento).toBe('2016-09-15');
  });

  test('Hazte socio con email de cuenta ACTIVA → error y sin solicitud vacía', async ({ page }) => {
    const { count: antes } = await admin.from('socios').select('id', { count: 'exact', head: true });
    await rellenarAlta(page, activa.adultos[0].email);
    await page.click('#enviarBtn');
    await expect(page.locator('#msg')).toContainText('Ya existe una cuenta activa');
    const { count: despues } = await admin.from('socios').select('id', { count: 'exact', head: true });
    expect(despues).toBe(antes);
  });

  test('Hazte socio con email de cuenta DE BAJA → lleva a Reactivar', async ({ page }) => {
    await rellenarAlta(page, baja.adultos[0].email);
    await page.click('#enviarBtn');
    await expect(page).toHaveURL(/reactivar-cuenta\.html\?desde=alta/, { timeout: 30_000 });
    await expect(page.locator('#email')).toHaveValue(baja.adultos[0].email);
  });

  test('Reactivar: campos vacíos en rojo', async ({ page }) => {
    await page.goto('/reactivar-cuenta.html');
    await page.click('#enviarBtn');
    await expect(page.locator('#dni')).toHaveClass(/campo-error/);
  });

  test('Reactivar con DNI incorrecto → no encuentra la cuenta', async ({ page }) => {
    await page.goto('/reactivar-cuenta.html');
    await page.fill('#email', baja.adultos[0].email);
    await page.fill('#dni', '00000000T');
    await page.setInputFiles('#comprobanteFile', COMPROBANTE);
    await page.click('#enviarBtn');
    await expect(page.locator('#msg')).toContainText('No hemos encontrado');
  });

  test('Reactivar con datos correctos → solicitud registrada', async ({ page }) => {
    await page.goto('/reactivar-cuenta.html?motivo=baja');
    await page.fill('#email', baja.adultos[0].email);
    await page.fill('#dni', baja.adultos[0].dni_nie);
    await page.setInputFiles('#comprobanteFile', COMPROBANTE);
    await page.click('#enviarBtn');
    await expect(page.locator('#okCard')).toBeVisible();
    const { data } = await admin.from('socios').select('reactivacion_solicitada_en').eq('id', baja.socio.id).single();
    expect(data.reactivacion_solicitada_en).not.toBeNull();
  });
});
