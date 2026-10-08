// 1. Acceso, cuentas inactivas y contraseñas
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, entrar, emailPrueba, llamarFuncion, PASSWORD } = require('../ayudantes/datos');

// Si una prueba falla, las demás del grupo se siguen ejecutando
test.describe.configure({ mode: 'default' });

test.describe('Acceso y contraseñas', () => {
  let activa, baja, faltaPago, forzada;

  test.beforeAll(async () => {
    activa = await crearFamilia({ etiqueta: 'activa' });
    baja = await crearFamilia({ etiqueta: 'baja', estado: 'baja' });
    faltaPago = await crearFamilia({ etiqueta: 'impago', estado: 'falta_pago' });
    forzada = await crearFamilia({ etiqueta: 'forzada', forzarCambioClave: true });
  });

  test('Login correcto lleva a Inicio', async ({ page }) => {
    await entrar(page, activa.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await expect(page.locator('#saludo')).toContainText('Prueba');
  });

  test('Contraseña incorrecta: mensaje genérico', async ({ page }) => {
    await entrar(page, activa.adultos[0].email, 'contraseña-mala');
    await expect(page.locator('#errorMsg')).toHaveText('Email o contraseña incorrectos.');
  });

  test('Cuenta de baja: "Usuario dado de baja" y botón Reactivar', async ({ page }) => {
    await entrar(page, baja.adultos[0].email);
    await expect(page.locator('#inactivaCard')).toBeVisible();
    await expect(page.locator('#inactivaTitulo')).toHaveText('Usuario dado de baja');
    await expect(page.locator('#reactivarBtn')).toHaveAttribute('href', /reactivar-cuenta\.html\?motivo=baja/);
    await page.goto('/dashboard.html');           // y no puede colarse en el portal
    await expect(page).not.toHaveURL(/dashboard\.html/);
  });

  test('Cuenta con falta de pago: "Cuenta inactiva"', async ({ page }) => {
    await entrar(page, faltaPago.adultos[0].email);
    await expect(page.locator('#inactivaTitulo')).toContainText('Cuenta inactiva');
  });

  test('Primer acceso: obliga a "Elige una nueva contraseña"', async ({ page }) => {
    await entrar(page, forzada.adultos[0].email);
    await expect(page).toHaveURL(/cambiar-clave\.html/);
    await expect(page.locator('h1')).toHaveText('Elige una nueva contraseña');
    await page.fill('#password', 'NuevaClave-123');
    await page.fill('#password2', 'NuevaClave-123');
    await page.click('#submitBtn');
    await expect(page).toHaveURL(/dashboard\.html/);
    const { data } = await admin.from('adultos').select('force_password_change').eq('id', forzada.adultos[0].id).single();
    expect(data.force_password_change).toBe(false);
  });

  test('Cambio voluntario: "Cambiar mi contraseña" con vuelta a Inicio', async ({ page }) => {
    await entrar(page, activa.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/cambiar-clave.html');
    await expect(page.locator('h1')).toHaveText('Cambiar mi contraseña');
    await expect(page.locator('#navLinks a', { hasText: 'Inicio' })).toBeVisible();
  });

  test('Recuperar contraseña: email inexistente o de baja → no se envía', async () => {
    const r1 = await llamarFuncion('recuperar-contrasena', { email: emailPrueba('noexiste') });
    expect(r1.status).toBe(403);
    expect(r1.json.codigo).toBe('no_activa');
    const r2 = await llamarFuncion('recuperar-contrasena', { email: baja.adultos[0].email });
    expect(r2.status).toBe(403);
  });

  test('Recuperar contraseña: cuenta activa → se envía UNA vez (la 2ª se bloquea)', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('#resetLink');
    await page.fill('#resetEmail', activa.adultos[0].email);
    await page.click('#resetBtn');
    await expect(page.locator('#resetMsg')).toContainText('Te hemos enviado un correo');
    await expect(page.locator('#resetBtn')).toBeDisabled();
    const r = await llamarFuncion('recuperar-contrasena', { email: activa.adultos[0].email });
    expect(r.status).toBe(429);
  });

  test('Recuperar en la pantalla: email de baja ofrece Reactivar', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('#resetLink');
    await page.fill('#resetEmail', baja.adultos[0].email);
    await page.click('#resetBtn');
    await expect(page.locator('#resetMsg a[href*="reactivar-cuenta.html"]')).toBeVisible();
  });

  test('Enlace del correo: "Restablece tu contraseña", y usado 2 veces → caducado', async ({ page }) => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery', email: activa.adultos[0].email,
      options: { redirectTo: process.env.SITE_URL + '/cambiar-clave.html' }
    });
    expect(error).toBeNull();
    const enlace = data.properties.action_link;

    await page.goto(enlace);
    await expect(page.locator('h1')).toHaveText('Restablece tu contraseña');
    await page.fill('#password', 'Recuperada-123');
    await page.fill('#password2', 'Recuperada-123');
    await page.click('#submitBtn');
    await expect(page).toHaveURL(/dashboard\.html/);

    await page.goto(enlace);                        // segunda vez
    await expect(page.locator('h1')).toHaveText('Enlace no válido o caducado');
    await expect(page.locator('#avisoBotones').getByRole('link', { name: 'Ir al acceso' })).toBeVisible();
    await expect(page.locator('#avisoBotones').getByRole('link', { name: 'Web del AMPA' })).toBeVisible();

    // Deja la contraseña como estaba para el resto de pruebas
    await admin.auth.admin.updateUserById(activa.adultos[0].id, { password: PASSWORD });
  });

  test('Enlace de recuperación de una cuenta de baja → no entra al portal', async ({ page }) => {
    const { data } = await admin.auth.admin.generateLink({
      type: 'recovery', email: baja.adultos[0].email,
      options: { redirectTo: process.env.SITE_URL + '/cambiar-clave.html' }
    });
    await page.goto(data.properties.action_link);
    await expect(page.locator('h1')).toHaveText('Tu cuenta no está activa');
    await expect(page.locator('#formCard')).toBeHidden();
  });

  test('Navegación: login y cambiar-clave enlazan a la web pública', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.getByRole('link', { name: '‹ Web del AMPA' })).toBeVisible();
    await page.goto('/cambiar-clave.html#error=access_denied&error_code=otp_expired');
    await expect(page.locator('h1')).toHaveText('Enlace no válido o caducado');
    await expect(page.locator('.pub-links').getByRole('link', { name: '‹ Web del AMPA' })).toBeVisible();
  });
});
