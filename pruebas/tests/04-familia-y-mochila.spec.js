// 4. "Mis datos" (segundo adulto) y Mochila
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, entrar, aceptarDialogos, emailPrueba } = require('../ayudantes/datos');

// Si una prueba falla, las demás del grupo se siguen ejecutando
test.describe.configure({ mode: 'default' });

test.describe('Mis datos y Mochila', () => {
  let fam;
  test.beforeAll(async () => { fam = await crearFamilia({ etiqueta: 'misdatos' }); });
  test.beforeEach(async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
  });

  test('Añadir segundo adulto con formulario: el móvil se guarda y se ve', async ({ page }) => {
    await page.goto('/mis-datos.html');
    await page.click('#addAdultoBtn');
    await expect(page.locator('#n2Direccion')).toHaveValue('Calle de las Pruebas 1');   // precargada
    await page.click('#n2Guardar');
    await expect(page.locator('#n2Nombre')).toHaveClass(/campo-error/);
    await page.fill('#n2Nombre', 'Segundo');
    await page.fill('#n2Apellidos', 'Adulto Prueba');
    await page.fill('#n2Email', emailPrueba('segundo'));
    await page.fill('#n2Movil', '633333333');
    await page.fill('#n2Dni', '87654321X');
    await page.click('#n2Guardar');
    const tarjeta = page.locator('#adultosWrap .hijo-card', { hasText: 'Segundo Adulto Prueba' });
    await expect(tarjeta).toBeVisible({ timeout: 30_000 });
    await expect(tarjeta.locator('.field', { hasText: 'Móvil' }).locator('input')).toHaveValue('633333333');
    const { data } = await admin.from('adultos').select('movil, dni_nie, direccion').eq('socio_id', fam.socio.id).eq('nombre', 'Segundo').single();
    expect(data).toMatchObject({ movil: '633333333', dni_nie: '87654321X', direccion: 'Calle de las Pruebas 1' });
  });

  test('El adulto 1 edita el móvil del adulto 2 y de verdad se guarda', async ({ page }) => {
    await page.goto('/mis-datos.html');
    const tarjeta = page.locator('#adultosWrap .hijo-card', { hasText: 'Segundo Adulto Prueba' });
    await tarjeta.locator('.field', { hasText: 'Móvil' }).locator('input').fill('644444444');
    await tarjeta.getByRole('button', { name: 'Guardar' }).click();
    await expect(tarjeta).toContainText('Guardado ✓');
    const { data } = await admin.from('adultos').select('movil').eq('socio_id', fam.socio.id).eq('nombre', 'Segundo').single();
    expect(data.movil).toBe('644444444');
  });

  test('El email de acceso no se puede editar desde Mis datos', async ({ page }) => {
    await page.goto('/mis-datos.html');
    const email = page.locator('#adultosWrap .hijo-card').first().locator('input[type="email"]');
    await expect(email).toHaveAttribute('readonly', '');
  });

  test('Mochila: apuntarse y desapuntarse funcionan', async ({ page }) => {
    const wrap = page.locator('#mochilaWrap');
    await expect(page.locator('#mochilaApuntarseBtn')).toBeVisible();
    await page.click('#mochilaApuntarseBtn');
    await expect(wrap).toContainText('Estáis en el puesto', { timeout: 30_000 });
    const { data } = await admin.from('mochila_cola').select('posicion').eq('socio_id', fam.socio.id);
    expect(data.length).toBe(1);

    await page.click('#mochilaDesapuntarseBtn');
    await expect(page.locator('#mochilaApuntarseBtn')).toBeVisible({ timeout: 30_000 });
    const { data: d2 } = await admin.from('mochila_cola').select('id').eq('socio_id', fam.socio.id);
    expect(d2.length).toBe(0);
  });
});
