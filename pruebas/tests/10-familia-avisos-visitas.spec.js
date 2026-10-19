// 10. Mis datos (borrar alumnos, quitar al segundo adulto), avisos en el
//     móvil, estadísticas de visitas y volver a la página tras entrar.
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, clienteComo, llamarFuncion, entrar, aceptarDialogos, MARCA, CIERRE_PRUEBA } = require('../ayudantes/datos');

test.describe.configure({ mode: 'default' });

test.describe('Mis datos: borrar alumnos y quitar adultos', () => {
  test('La familia borra a un alumno/a y se van con él sus inscripciones', async () => {
    const fam = await crearFamilia({ etiqueta: 'borraral', alumnos: 2 });
    const { cliente } = await clienteComo(fam.adultos[0].email);
    const { data: ev } = await admin.from('eventos').insert({ titulo: `${MARCA}${process.env.RUN_ID} Borrar alumno`, fecha: '2099-03-01T10:00:00Z',
      activo: true, tipo_elegibilidad: 'alumnos', elegibilidad_modo: 'curso', cursos_permitidos: [{ etapa: 'Primaria', curso: '3º' }] }).select().single();
    const ins = await cliente.from('evento_inscripciones').insert({ evento_id: ev.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id });
    expect(ins.error).toBeNull();
    const { data, error } = await cliente.from('alumnos').delete().eq('id', fam.alumnos[0].id).select('id');
    expect(error).toBeNull();
    expect(data.length).toBe(1);
    const { data: quedan } = await admin.from('evento_inscripciones').select('id').eq('alumno_id', fam.alumnos[0].id);
    expect(quedan).toEqual([]);
    // El otro alumno sigue ahí
    const { data: resto } = await admin.from('alumnos').select('id').eq('socio_id', fam.socio.id);
    expect(resto.map(a => a.id)).toEqual([fam.alumnos[1].id]);
    await admin.from('eventos').delete().eq('id', ev.id);
  });

  test('No se puede borrar a un alumno/a con libros del Banco de Libros sin devolver', async () => {
    const { data: libro } = await admin.from('libros_catalogo').select('id').limit(1);
    test.skip(!libro || !libro.length, 'El catálogo del Banco de Libros está vacío');
    const fam = await crearFamilia({ etiqueta: 'conlibro', alumnos: 1 });
    // Convocatoria ya repartida (no se ve como abierta en la web)
    const { data: conv, error: e1 } = await admin.from('prestamo_convocatorias').insert({ fecha_cierre: CIERRE_PRUEBA, estado: 'repartida' }).select().single();
    expect(e1).toBeNull();
    const { error: e2 } = await admin.from('prestamo_items').insert({ alumno_id: fam.alumnos[0].id, socio_id: fam.socio.id, libro_id: libro[0].id,
      convocatoria_id: conv.id, estado: 'asignado', entregado_en: new Date().toISOString().slice(0, 10) });
    expect(e2).toBeNull();
    const { cliente } = await clienteComo(fam.adultos[0].email);
    const { error } = await cliente.from('alumnos').delete().eq('id', fam.alumnos[0].id);
    expect(error?.message).toContain('libro(s) del Banco de Libros sin devolver');
    // Devuelto: ya se puede
    await admin.from('prestamo_items').update({ fecha_devolucion: new Date().toISOString().slice(0, 10) }).eq('alumno_id', fam.alumnos[0].id);
    const r = await cliente.from('alumnos').delete().eq('id', fam.alumnos[0].id).select('id');
    expect(r.error).toBeNull();
    expect(r.data.length).toBe(1);
    await admin.from('prestamo_convocatorias').delete().eq('id', conv.id);
  });

  test('El adulto principal no se puede quitar; el segundo sí, y deja de poder entrar', async () => {
    const fam = await crearFamilia({ etiqueta: 'quitarad', adultos: 2 });
    const { token } = await clienteComo(fam.adultos[0].email);
    let r = await llamarFuncion('familia-quitar-adulto', { adultoId: fam.adultos[0].id }, token);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('adulto principal');
    // Tampoco desde la cuenta del segundo adulto
    const { token: t2 } = await clienteComo(fam.adultos[1].email);
    r = await llamarFuncion('familia-quitar-adulto', { adultoId: fam.adultos[0].id }, t2);
    expect(r.status).toBe(400);
    r = await llamarFuncion('familia-quitar-adulto', { adultoId: fam.adultos[1].id }, token);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, eraYo: false });
    const { data } = await admin.from('adultos').select('id').eq('socio_id', fam.socio.id);
    expect(data.map(a => a.id)).toEqual([fam.adultos[0].id]);
    await expect(clienteComo(fam.adultos[1].email)).rejects.toThrow();
  });

  test('El segundo adulto puede quitarse a sí mismo', async () => {
    const fam = await crearFamilia({ etiqueta: 'quitarme', adultos: 2 });
    const { token } = await clienteComo(fam.adultos[1].email);
    const r = await llamarFuncion('familia-quitar-adulto', { adultoId: fam.adultos[1].id }, token);
    expect(r.status).toBe(200);
    expect(r.json.eraYo).toBe(true);
  });

  test('No se puede quitar a un adulto de otra familia', async () => {
    const a = await crearFamilia({ etiqueta: 'quitarA' });
    const b = await crearFamilia({ etiqueta: 'quitarB', adultos: 2 });
    const { token } = await clienteComo(a.adultos[0].email);
    const r = await llamarFuncion('familia-quitar-adulto', { adultoId: b.adultos[1].id }, token);
    expect(r.status).toBe(403);
    const { data } = await admin.from('adultos').select('id').eq('id', b.adultos[1].id);
    expect(data.length).toBe(1);
  });

  test('Mis datos muestra «Adulto principal» y los botones de quitar y borrar', async ({ page }) => {
    const fam = await crearFamilia({ etiqueta: 'misdatosq', adultos: 2, alumnos: 1 });
    aceptarDialogos(page);
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/mis-datos.html');
    await expect(page.locator('#adultosWrap .hijo-rol').first()).toHaveText('Adulto principal');
    await expect(page.locator('#adultosWrap .nota-principal')).toHaveCount(1);
    await expect(page.locator('#adultosWrap .quitar-persona')).toHaveText(['Quitar a este adulto']);
    await page.locator('#alumnosWrap .hijo-card .hijo-head').first().click();
    await page.locator('#alumnosWrap .quitar-persona').first().click();
    await expect(page.locator('#alumnosWrap .hijo-card')).toHaveCount(0);
    const { data } = await admin.from('alumnos').select('id').eq('socio_id', fam.socio.id);
    expect(data).toEqual([]);
  });
});

test.describe('Avisos en el móvil', () => {
  test('Cada adulto guarda sus dispositivos y nadie más los ve', async () => {
    const a = await crearFamilia({ etiqueta: 'pushA' });
    const b = await crearFamilia({ etiqueta: 'pushB' });
    const { cliente: ca } = await clienteComo(a.adultos[0].email);
    const { cliente: cb } = await clienteComo(b.adultos[0].email);
    const endpoint = `https://push.example.com/${MARCA}${process.env.RUN_ID}-${Date.now()}`;
    let r = await ca.rpc('push_guardar_suscripcion', { p_endpoint: 'http://inseguro', p_p256dh: 'x', p_auth: 'y' });
    expect(r.error?.message).toContain('no ha dado los datos');
    r = await ca.rpc('push_guardar_suscripcion', { p_endpoint: endpoint, p_p256dh: 'clave', p_auth: 'secreto', p_dispositivo: 'Prueba' });
    expect(r.error).toBeNull();
    const { data: mias } = await ca.from('push_suscripciones').select('endpoint').eq('endpoint', endpoint);
    expect(mias.length).toBe(1);
    const { data: ajenas } = await cb.from('push_suscripciones').select('endpoint').eq('endpoint', endpoint);
    expect(ajenas).toEqual([]);
    // Otra familia no puede borrarla
    await cb.rpc('push_quitar_suscripcion', { p_endpoint: endpoint });
    expect((await admin.from('push_suscripciones').select('endpoint').eq('endpoint', endpoint)).data.length).toBe(1);
    await ca.rpc('push_quitar_suscripcion', { p_endpoint: endpoint });
    expect((await admin.from('push_suscripciones').select('endpoint').eq('endpoint', endpoint)).data).toEqual([]);
  });

  test('Solo la Junta puede avisar a las familias de un evento', async () => {
    const fam = await crearFamilia({ etiqueta: 'pushsocio' });
    const { token } = await clienteComo(fam.adultos[0].email);
    const r = await llamarFuncion('push-avisar-evento', { eventoId: '00000000-0000-0000-0000-000000000000', soloContar: true }, token);
    expect(r.status).toBe(403);
    expect((await llamarFuncion('push-avisar-evento', { soloContar: true })).status).toBe(401);
  });

  test('La Junta cuenta a quién llegaría el aviso sin enviar nada', async () => {
    const jefe = await crearFamilia({ etiqueta: 'pushjunta', esAdmin: true });
    const { token } = await clienteComo(jefe.adultos[0].email);
    const { data: ev } = await admin.from('eventos').insert({ titulo: `${MARCA}${process.env.RUN_ID} Aviso`, fecha: '2099-04-01T10:00:00Z',
      activo: true, tipo_elegibilidad: 'alumnos', elegibilidad_modo: 'curso', cursos_permitidos: [{ etapa: 'Primaria', curso: '3º' }] }).select().single();
    const r = await llamarFuncion('push-avisar-evento', { eventoId: ev.id, soloContar: true }, token);
    expect(r.status).toBe(200);
    expect(r.json).toEqual(expect.objectContaining({ familias: expect.any(Number), dispositivos: expect.any(Number) }));
    const { data: tras } = await admin.from('eventos').select('aviso_push_en').eq('id', ev.id).single();
    expect(tras.aviso_push_en).toBeNull();
    await admin.from('eventos').delete().eq('id', ev.id);
  });
});

test.describe('Visitas a la web', () => {
  test('Solo la Junta ve el resumen de visitas', async () => {
    const fam = await crearFamilia({ etiqueta: 'visitasoc' });
    const { cliente } = await clienteComo(fam.adultos[0].email);
    const hoy = new Date().toISOString().slice(0, 10);
    const r = await cliente.rpc('visitas_resumen', { p_desde: hoy, p_hasta: hoy });
    expect(r.error?.message).toContain('Solo la Junta');
    const { data } = await cliente.from('visitas').select('id').limit(1);
    expect(data).toEqual([]);
    const jefe = await crearFamilia({ etiqueta: 'visitajun', esAdmin: true });
    const { cliente: cj } = await clienteComo(jefe.adultos[0].email);
    const ok = await cj.rpc('visitas_resumen', { p_desde: hoy, p_hasta: hoy });
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual(expect.objectContaining({ totales: expect.any(Array), por_pagina: expect.any(Array) }));
  });

  test('Las visitas de las pruebas, de robots y de páginas raras no se apuntan', async () => {
    const fam = await crearFamilia({ etiqueta: 'visitapru' });
    const { token } = await clienteComo(fam.adultos[0].email);
    const antes = (await admin.from('visitas').select('id', { count: 'exact', head: true }).eq('pagina', 'mis-datos.html')).count;
    // Cuenta ficticia de prueba (email con «ampa-prueba-»)
    expect((await llamarFuncion('visita', { pagina: '/mis-datos.html' }, token)).status).toBe(204);
    // Página que no existe
    expect((await llamarFuncion('visita', { pagina: '/../../etc/passwd' })).status).toBe(204);
    const despues = (await admin.from('visitas').select('id', { count: 'exact', head: true }).eq('pagina', 'mis-datos.html')).count;
    expect(despues).toBe(antes);
    const { data: raras } = await admin.from('visitas').select('id').ilike('pagina', '%passwd%');
    expect(raras).toEqual([]);
  });

  test('La página de visitas carga para la Junta', async ({ page }) => {
    const jefe = await crearFamilia({ etiqueta: 'visitapag', esAdmin: true });
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/admin-visitas.html');
    await expect(page.locator('#cifras')).toContainText('Páginas vistas');
    await page.click('#periodo [data-d="7"]');
    await expect(page.locator('#paginas thead')).toContainText('No socios');
  });
});

test.describe('Entrar y volver', () => {
  test('«Soy socio» desde Lotería: tras entrar vuelve a Lotería', async ({ page }) => {
    const fam = await crearFamilia({ etiqueta: 'volver' });
    await page.goto('/login.html?volver=loteria.html');
    await page.fill('#email', fam.adultos[0].email);
    await page.fill('#password', fam.adultos[0].password);
    await page.click('#submitBtn');
    await expect(page).toHaveURL(/loteria\.html/);
  });

  test('Un «volver» a otra web se ignora y va a Mi perfil', async ({ page }) => {
    const fam = await crearFamilia({ etiqueta: 'volverx' });
    await page.goto('/login.html?volver=' + encodeURIComponent('https://ejemplo.com/robar.html'));
    await page.fill('#email', fam.adultos[0].email);
    await page.fill('#password', fam.adultos[0].password);
    await page.click('#submitBtn');
    await expect(page).toHaveURL(/dashboard\.html/);
  });
});
