// 3. Panel de administración: Socios, solicitudes y alta manual
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, entrar, aceptarDialogos, emailPrueba, siguienteNumeroLibre, PASSWORD } = require('../ayudantes/datos');

test.describe.serial('Administración de socios', () => {
  let jefe, pendiente, pendiente2, otra, conNumero;

  test.beforeAll(async () => {
    jefe = await crearFamilia({ etiqueta: 'admin', esAdmin: true });
    pendiente = await crearFamilia({ etiqueta: 'pendiente', estado: 'recien_creada', alumnos: 1 });
    pendiente2 = await crearFamilia({ etiqueta: 'pendiente2', estado: 'recien_creada' });
    otra = await crearFamilia({ etiqueta: 'editar', adultos: 2, alumnos: 2 });
    conNumero = await crearFamilia({ etiqueta: 'connumero', conNumero: true });
    // Apellido único para encontrarlas en la pantalla
    for (const f of [pendiente, pendiente2, otra]) {
      await admin.from('adultos').update({ apellidos: 'Prueba ' + f.socio.id.slice(0, 8) }).eq('socio_id', f.socio.id);
    }
  });

  test.beforeEach(async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
  });

  const apellido = (f) => 'Prueba ' + f.socio.id.slice(0, 8);
  const solicitudDe = (page, f) => page.locator('.solicitud', { hasText: apellido(f) });
  async function abrirFicha(page, f) {
    await page.goto('/admin-socios.html');
    await page.click('.tab-btn[data-tab="socios"]');
    await page.fill('#filtroTexto', apellido(f));
    await page.click(`tr[data-id="${f.socio.id}"]`);
    return page.locator('td.detalle');
  }

  test('Inicio del admin lleva al Panel de la Junta, con su menú y pendientes', async ({ page }) => {
    await page.click('#adminSection');
    await expect(page.locator('.admin-menu')).toBeVisible();
    await expect(page.locator('.admin-menu').getByRole('link', { name: 'Socios', exact: true })).toBeVisible();
    await expect(page.locator('#tareas')).not.toContainText('Revisando');
    await expect(page.locator('#tareas')).toContainText(/solicitud/i);   // hay una familia pendiente de prueba
  });

  test('Solicitudes: se ven todos los datos de la familia', async ({ page }) => {
    await page.goto('/admin-socios.html');
    const s = solicitudDe(page, pendiente);
    await expect(s).toBeVisible();
    await expect(s).toContainText(pendiente.adultos[0].email);
    await expect(s).toContainText(pendiente.adultos[0].dni_nie);
    await expect(s).toContainText('600000000');
    await expect(s).toContainText('Alumno1');
  });

  test('Activar solicitud → cuenta activa con número de socio', async ({ page }) => {
    await page.goto('/admin-socios.html');
    const s = solicitudDe(page, pendiente);
    await s.locator('.activarBtn').click();
    await expect(s.locator('.msg-linea')).toContainText('Cuenta activada');
    const { data } = await admin.from('socios').select('estado, numero_socio_completo').eq('id', pendiente.socio.id).single();
    expect(data.estado).toBe('activa');
    expect(data.numero_socio_completo).toBeTruthy();
  });

  test('Rechazar sin motivo no deja; con motivo → baja y motivo guardado', async ({ page }) => {
    await page.goto('/admin-socios.html');
    const s = solicitudDe(page, pendiente2);
    await s.locator('.rechazarAbrirBtn').click();
    await s.locator('.confirmarRechazoBtn').click();
    await expect(s.locator('.motivoTxt')).toHaveClass(/campo-error/);
    await s.locator('.motivoTxt').fill('Prueba automática: comprobante ilegible');
    await s.locator('.confirmarRechazoBtn').click();
    await expect(s.locator('.msg-linea')).toContainText('rechazada');
    const { data } = await admin.from('socios').select('estado, motivo_rechazo').eq('id', pendiente2.socio.id).single();
    expect(data.estado).toBe('baja');
    expect(data.motivo_rechazo).toContain('ilegible');
  });

  test('Lista: buscar y filtrar por estado', async ({ page }) => {
    await page.goto('/admin-socios.html');
    await page.click('.tab-btn[data-tab="socios"]');
    await page.fill('#filtroTexto', apellido(pendiente2));
    await expect(page.locator(`tr[data-id="${pendiente2.socio.id}"]`)).toBeVisible();
    await page.selectOption('#filtroEstado', 'activa');
    await expect(page.locator(`tr[data-id="${pendiente2.socio.id}"]`)).toHaveCount(0);
    await page.selectOption('#filtroEstado', 'baja');
    await expect(page.locator(`tr[data-id="${pendiente2.socio.id}"]`)).toBeVisible();
  });

  test('Editar nº de socio: repetido → error; libre → guardado', async ({ page }) => {
    const ficha = await abrirFicha(page, otra);
    const cuenta = ficha.locator('[data-b="cuenta"]');
    await cuenta.locator('[data-f="anio_ultima_cuota"]').fill(String(conNumero.socio.anio_ultima_cuota));
    await cuenta.locator('[data-f="numero_secuencial"]').fill(conNumero.socio.numero_secuencial);
    await cuenta.locator('.guardarCuentaBtn').click();
    await expect(cuenta.locator('.msg-linea')).toContainText('ya lo tiene otra cuenta');

    const libre = await siguienteNumeroLibre();
    await cuenta.locator('[data-f="numero_secuencial"]').fill(libre);
    await cuenta.locator('.guardarCuentaBtn').click();
    await expect(cuenta.locator('.msg-linea')).toContainText('Guardado');
    const { data } = await admin.from('socios').select('numero_secuencial').eq('id', otra.socio.id).single();
    expect(data.numero_secuencial).toBe(libre);
  });

  test('Editar email de un adulto → también cambia su usuario de acceso', async ({ page, browser }) => {
    const nuevo = emailPrueba('cambiado');
    const ficha = await abrirFicha(page, otra);
    const persona = ficha.locator('[data-b="adultos"] .persona').first();
    await persona.locator('[data-f="email"]').fill(nuevo);
    await persona.locator('[data-f="movil"]').fill('699123456');
    await persona.locator('.guardarBtn').click();
    await expect(persona.locator('.msg-linea')).toContainText('Guardado');

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await entrar(p2, nuevo, PASSWORD);
    await expect(p2).toHaveURL(/dashboard\.html/);
    await ctx.close();
  });

  test('Añadir alumno solo con nombre, apellidos y etapa; quitar otro alumno', async ({ page }) => {
    let ficha = await abrirFicha(page, otra);
    const bloque = ficha.locator('[data-b="alumnos"]');
    await bloque.locator('.addAlumnoBtn').click();
    const nuevo = bloque.locator('.persona').last();
    await nuevo.locator('.guardarBtn').click();
    await expect(nuevo.locator('[data-f="nombre"]')).toHaveClass(/campo-error/);
    await nuevo.locator('[data-f="nombre"]').fill('Mínimo');
    await nuevo.locator('[data-f="apellidos"]').fill('Prueba');
    await nuevo.locator('[data-f="etapa"]').selectOption('ESO');
    await nuevo.locator('.guardarBtn').click();
    await expect.poll(async () => {
      const { data } = await admin.from('alumnos').select('id').eq('socio_id', otra.socio.id).eq('nombre', 'Mínimo');
      return data.length;
    }).toBe(1);

    ficha = await abrirFicha(page, otra);
    await ficha.locator('[data-b="alumnos"] .persona', { hasText: 'Alumno1' }).locator('.quitarBtn').click();
    await expect.poll(async () => {
      const { data } = await admin.from('alumnos').select('id').eq('id', otra.alumnos[0].id);
      return data.length;
    }).toBe(0);
  });

  test('Quitar el segundo adulto', async ({ page }) => {
    const ficha = await abrirFicha(page, otra);
    await ficha.locator('[data-b="adultos"] .persona').nth(1).locator('.quitarBtn').click();
    await expect.poll(async () => {
      const { data } = await admin.from('adultos').select('id').eq('socio_id', otra.socio.id);
      return data.length;
    }).toBe(1);
  });

  test('Dar de baja → la familia ve "dado de baja" al entrar; reactivar desde admin', async ({ page, browser }) => {
    let ficha = await abrirFicha(page, otra);
    await ficha.locator('[data-b="estado"] .bajaBtn').click();
    await expect(ficha.locator('[data-b="estado"] .msg-linea')).toContainText('dada de baja');

    const { data: ad } = await admin.from('adultos').select('email').eq('socio_id', otra.socio.id).limit(1);
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await entrar(p2, ad[0].email, PASSWORD);
    await expect(p2.locator('#inactivaTitulo')).toHaveText('Usuario dado de baja');
    await ctx.close();

    await page.waitForTimeout(1500);
    ficha = await abrirFicha(page, otra);
    await ficha.locator('[data-b="estado"] .activarBtn').click();
    await expect(ficha.locator('[data-b="estado"] .msg-linea')).toContainText('Cuenta activada');
    const { data } = await admin.from('socios').select('estado').eq('id', otra.socio.id).single();
    expect(data.estado).toBe('activa');
  });

  test('Alta manual: alumno solo con nombre, apellidos y etapa, y fecha de nacimiento', async ({ page }) => {
    const email = emailPrueba('manual');
    await page.goto('/admin-importar.html');
    await page.fill('#mAnio', String(new Date().getFullYear()));
    for (const [id, v] of [['a1Nombre', 'Prueba'], ['a1Apellidos', 'Manual'], ['a1Email', email], ['a1Dni', '12345678Z'],
      ['a1Direccion', 'Calle 3'], ['a1Ciudad', 'Madrid'], ['a1Provincia', 'Madrid'], ['a1Cp', '28022'], ['a1Movil', '622222222']]) {
      await page.fill('#' + id, v);
    }
    await page.click('#addAlumnoBtn');
    await page.click('#addAlumnoBtn');
    const cards = page.locator('#alumnosWrap .hijo-card');
    await cards.nth(0).locator('input[id^="al_nombre_"]').fill('SoloMinimo');
    await cards.nth(0).locator('input[id^="al_apellidos_"]').fill('Prueba');
    await cards.nth(0).locator('select[id^="al_etapa_"]').selectOption('Infantil');
    await cards.nth(1).locator('input[id^="al_nombre_"]').fill('ConFecha');
    await cards.nth(1).locator('input[id^="al_apellidos_"]').fill('Prueba');
    await cards.nth(1).locator('select[id^="al_etapa_"]').selectOption('Primaria');
    await cards.nth(1).locator('input[id^="al_fecha_"]').fill('2018-01-20');
    await page.click('#manualBtn');
    await expect(page.locator('#manualMsg')).toContainText('Alta completada', { timeout: 45_000 });

    const { data: ad } = await admin.from('adultos').select('socio_id').ilike('email', email).single();
    const { data: al } = await admin.from('alumnos').select('nombre, curso, fecha_nacimiento').eq('socio_id', ad.socio_id).order('nombre');
    expect(al.length).toBe(2);
    expect(al.find(a => a.nombre === 'SoloMinimo').curso).toBeNull();
    expect(al.find(a => a.nombre === 'ConFecha').fecha_nacimiento).toBe('2018-01-20');
  });
});
