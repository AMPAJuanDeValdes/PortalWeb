// 8. Donaciones (con y sin cuenta), stock donado de la Junta, venta de
//    lotería con varias fechas y los huecos de seguridad cerrados en la
//    revisión de octubre de 2026.
const { test, expect } = require('@playwright/test');
const { admin, MARCA, crearFamilia, entrar, aceptarDialogos, emailPrueba, clienteComo, llamarFuncion } = require('../ayudantes/datos');

test.describe.configure({ mode: 'default' });

test.describe('Donaciones', () => {
  test('Sin cuenta: se anuncia una donación con prenda, flauta y «otra cosa»', async ({ page }) => {
    const { data: prendas } = await admin.from('prendas_catalogo').select('tipo').limit(1);
    test.skip(!prendas || !prendas.length, 'No hay prendas en el catálogo de uniformes');
    aceptarDialogos(page);
    const email = emailPrueba('donar');
    await page.goto('/donar.html');
    await expect(page.locator('.es-donacion')).toContainText('Es una donación');
    await page.click('[data-add=uniformes]');
    await page.selectOption('#instrumento', 'Flauta');
    await page.fill('#instrumentoCant', '2');
    await page.click('[data-add=instrumentos]');
    await page.fill('#otros', 'Una mesa pequeña');
    await expect(page.locator('#cesta li')).toHaveCount(3);
    await page.fill('#nombre', 'Prueba Donación');
    await page.fill('#email', email);
    // Sin marcar la casilla no deja
    await page.click('#enviarBtn');
    await expect(page.locator('#msg')).toContainText('es una donación');
    await page.check('#acepto');
    await page.click('#enviarBtn');
    await expect(page.locator('.hecho')).toContainText('caja de donaciones', { timeout: 30_000 });
    await expect(page.locator('.hecho')).toContainText('no lo dejes todavía');
    const { data } = await admin.from('donaciones').select('items, otros, socio_id, estado').eq('email', email).single();
    expect(data.items.map(i => i.categoria).sort()).toEqual(['instrumentos', 'uniformes']);
    expect(data.items.find(i => i.categoria === 'instrumentos').cantidad).toBe(2);
    expect(data.otros).toBe('Una mesa pequeña');
    expect(data.socio_id).toBeNull();
    expect(data.estado).toBe('pendiente');
  });

  test('La función rechaza lo que no se recoge', async () => {
    const base = { nombre: 'Prueba', email: emailPrueba('donarmal'), aceptaDonacion: true };
    let r = await llamarFuncion('donacion', { ...base, items: [{ categoria: 'instrumentos', articulo: 'Guitarra', cantidad: 1 }] });
    expect(r.status).toBe(400);
    r = await llamarFuncion('donacion', { ...base, items: [{ categoria: 'libros', libro_id: '00000000-0000-0000-0000-000000000000', cantidad: 1 }] });
    expect(r.status).toBe(400);
    r = await llamarFuncion('donacion', { ...base, items: [], otros: '' });
    expect(r.status).toBe(400);
    r = await llamarFuncion('donacion', { ...base, aceptaDonacion: false, otros: 'algo' });
    expect(r.status).toBe(400);
  });

  test('Con cuenta: los datos salen rellenos y la donación queda unida a la familia', async ({ page }) => {
    const fam = await crearFamilia({ etiqueta: 'donsocio' });
    aceptarDialogos(page);
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/donar.html');
    await expect(page.locator('#email')).toHaveValue(fam.adultos[0].email);
    await page.click('[data-add=instrumentos]');
    await page.check('#acepto');
    await page.click('#enviarBtn');
    await expect(page.locator('.hecho')).toBeVisible({ timeout: 30_000 });
    const { data } = await admin.from('donaciones').select('socio_id').eq('email', fam.adultos[0].email).single();
    expect(data.socio_id).toBe(fam.socio.id);
  });
});

test.describe('Stock donado (Junta)', () => {
  let jefe, libro, donacionId, stockAntes;
  const codigo = () => `${MARCA}${process.env.RUN_ID}`.slice(0, 40);

  test.beforeAll(async () => {
    jefe = await crearFamilia({ etiqueta: 'donjunta', esAdmin: true });
    const { data: libros } = await admin.from('libros_catalogo').select('id, titulo').limit(1);
    libro = libros && libros[0];
    const { data: d } = await admin.from('donaciones').insert({
      nombre: 'Prueba caja', email: emailPrueba('caja'),
      items: [
        { categoria: 'uniformes', tipo: 'Camiseta', talla: '20', cantidad: 2 },
        ...(libro ? [{ categoria: 'libros', libro_id: libro.id, titulo: libro.titulo, cantidad: 1 }] : [])
      ]
    }).select('id').single();
    donacionId = d.id;
    const { data: p } = await admin.from('prendas_catalogo').select('stock').eq('tipo', 'Camiseta').eq('talla', '20').maybeSingle();
    stockAntes = p ? p.stock : null;
  });

  test.afterAll(async () => {
    // Deja el stock real de uniformes como estaba
    if (stockAntes === null) await admin.from('prendas_catalogo').delete().eq('tipo', 'Camiseta').eq('talla', '20');
    else await admin.from('prendas_catalogo').update({ stock: stockAntes }).eq('tipo', 'Camiseta').eq('talla', '20');
    await admin.from('prendas_movimientos').delete().eq('tipo', 'Camiseta').eq('talla', '20').ilike('creado_por_nombre', '%Automática donjunta%');
  });

  test('Ha llegado a la caja → stock donado → banco o descartar', async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await page.goto('/admin-donaciones.html');
    const fila = page.locator(`.don[data-id="${donacionId}"]`);
    await fila.getByRole('button', { name: 'Ha llegado a la caja' }).click();
    await fila.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('#lista')).not.toContainText('Prueba caja', { timeout: 30_000 });
    const { data: don } = await admin.from('donaciones').select('estado, recibida_en').eq('id', donacionId).single();
    expect(don.estado).toBe('recibida');
    expect(don.recibida_en).not.toBeNull();

    // Una camiseta al Banco de Uniformes y la otra descartada (rota)
    const camisetas = page.locator('.stock-fila', { hasText: 'Camiseta, talla 20' });
    await camisetas.locator('input.n').fill('1');
    await camisetas.getByRole('button', { name: 'Pasar al Banco de Uniformes' }).click();
    await expect(page.locator('#movs')).toContainText('Pasa al banco', { timeout: 30_000 });
    const { data: p } = await admin.from('prendas_catalogo').select('stock').eq('tipo', 'Camiseta').eq('talla', '20').single();
    expect(p.stock).toBe((stockAntes || 0) + 1);
    await page.locator('.stock-fila', { hasText: 'Camiseta, talla 20' }).locator('input.n').fill('1');
    await page.locator('.stock-fila', { hasText: 'Camiseta, talla 20' }).getByRole('button', { name: 'Descartar' }).click();
    await expect(page.locator('#movs')).toContainText('Descartado', { timeout: 30_000 });

    if (libro) {
      const fl = page.locator('.stock-fila', { hasText: libro.titulo });
      await fl.locator('input.cod').fill(codigo());
      await fl.getByRole('button', { name: 'Pasar al Banco de Libros' }).click();
      await expect(page.locator('#movs')).toContainText('Códigos', { timeout: 30_000 });
      const { data: ej } = await admin.from('libros_ejemplares').select('libro_id').eq('codigo', codigo()).single();
      expect(ej.libro_id).toBe(libro.id);
    }
  });
});

test.describe('Venta de Lotería', () => {
  test('La Junta crea dos fechas de venta de una vez y salen en la web pública', async ({ page }) => {
    const jefe = await crearFamilia({ etiqueta: 'loteria', esAdmin: true });
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await page.goto('/admin-eventos.html');
    await page.selectOption('#ePlantilla', 'loteria');
    const titulo = `${MARCA}${process.env.RUN_ID} Venta de Lotería`;
    await page.fill('#eTitulo', titulo);
    await page.fill('#eFecha', '2099-11-20T17:00');
    await page.fill('#eLugar', 'Entrada del colegio');
    await page.click('#masFechaBtn');
    await page.locator('#masFechas .mf-fecha').fill('2099-11-27T10:00');
    await page.locator('#masFechas .mf-lugar').fill('Patio');
    await page.click('#crearEventoBtn');
    await expect(page.locator('#crearMsg')).toContainText('Creados 2 eventos', { timeout: 30_000 });
    const { data } = await admin.from('eventos').select('lugar, sin_inscripcion, abierto_no_socios').eq('titulo', titulo).order('fecha');
    expect(data).toEqual([
      { lugar: 'Entrada del colegio', sin_inscripcion: true, abierto_no_socios: true },
      { lugar: 'Patio', sin_inscripcion: true, abierto_no_socios: true }
    ]);
    await page.goto('/publico.html');
    const tarjetas = page.locator('.evento-card', { hasText: titulo });
    await expect(tarjetas).toHaveCount(2);
    await expect(tarjetas.first()).toContainText('Entrada del colegio');
    await expect(tarjetas.first()).toContainText('No hace falta apuntarse');
  });
});

test.describe('Seguridad: lo que una familia no puede hacer desde la consola', () => {
  let fam, otra, cli;
  test.beforeAll(async () => {
    fam = await crearFamilia({ etiqueta: 'segA', alumnos: 1 });
    otra = await crearFamilia({ etiqueta: 'segB', alumnos: 1 });
    ({ cliente: cli } = await clienteComo(fam.adultos[0].email));
  });

  test('No puede apuntar a otra familia ni cambiar su inscripción', async () => {
    const { data: ev } = await admin.from('eventos').insert({
      titulo: `${MARCA}${process.env.RUN_ID} Seguridad`, fecha: '2099-01-10T10:00:00Z', activo: true,
      tipo_elegibilidad: 'adultos', metodo_asignacion: 'sorteo', aforo_total: 5
    }).select('id').single();
    const ajena = await cli.from('evento_inscripciones').insert({ evento_id: ev.id, tipo_miembro: 'adulto', socio_id: fam.socio.id, adulto_id: otra.adultos[0].id });
    expect(ajena.error).not.toBeNull();
    const propia = await cli.from('evento_inscripciones').insert({ evento_id: ev.id, tipo_miembro: 'adulto', socio_id: fam.socio.id, adulto_id: fam.adultos[0].id }).select('id').single();
    expect(propia.error).toBeNull();
    const trampa = await cli.from('evento_inscripciones').update({ estado: 'ganador' }).eq('id', propia.data.id);
    expect(trampa.error).not.toBeNull();
  });

  test('No puede marcar sus datos como revisados ni colarse en la Mochila', async () => {
    const r = await cli.from('socios').update({ datos_revisados_en: new Date().toISOString() }).eq('id', fam.socio.id);
    expect(r.error).not.toBeNull();
    await cli.from('mochila_cola').insert({ tipo: 'socio', socio_id: fam.socio.id, estado: 'asignada', notificado_en: new Date().toISOString() });
    const { data } = await admin.from('mochila_cola').select('estado, notificado_en').eq('socio_id', fam.socio.id).single();
    expect(data).toEqual({ estado: 'espera', notificado_en: null });
  });
});
