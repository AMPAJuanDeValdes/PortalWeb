// 9. Lotería: campañas, talonarios, ventas, ingresos y mensajes.
//    Las campañas de prueba llevan la MARCA en el nombre y NUNCA se comienzan
//    (no salen en la web ni chocan con la campaña real). Se borran al terminar.
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, clienteComo, llamarFuncion, entrar, aceptarDialogos, MARCA } = require('../ayudantes/datos');

test.describe.configure({ mode: 'serial' });

let jefe, junta, fam, cliFam, camp;

test.describe('Lotería (Junta)', () => {
  test.beforeAll(async () => {
    jefe = await crearFamilia({ etiqueta: 'lotjunta', esAdmin: true });
    junta = (await clienteComo(jefe.adultos[0].email)).cliente;
    fam = await crearFamilia({ etiqueta: 'lotfam', conNumero: true });
    cliFam = (await clienteComo(fam.adultos[0].email)).cliente;
    const { data, error } = await junta.from('loteria_campanas')
      .insert({ nombre: `${MARCA}${process.env.RUN_ID} Lotería`, precio: 5, donativo: 1, participaciones_por_talonario: 25 })
      .select().single();
    if (error) throw error;
    camp = data;
  });
  test.afterAll(async () => {
    if (camp) await admin.from('loteria_campanas').delete().eq('id', camp.id);
  });

  const talonario = async (n) => (await admin.from('loteria_talonarios').select('*').eq('campana_id', camp.id).eq('numero', n).single()).data;

  test('Crear talonarios: salen numerados seguidos y se pueden añadir más', async () => {
    let r = await junta.rpc('loteria_crear_talonarios', { p_campana: camp.id, p_cuantos: 48 });
    expect(r.error).toBeNull();
    r = await junta.rpc('loteria_crear_talonarios', { p_campana: camp.id, p_cuantos: 2 });
    expect(r.error).toBeNull();
    const { data } = await admin.from('loteria_talonarios').select('numero').eq('campana_id', camp.id).order('numero');
    expect(data.map(t => t.numero)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  test('Asignar un grupo por participaciones: 1-300 son los talonarios 1 a 12, y solo talonarios enteros', async () => {
    let r = await junta.rpc('loteria_asignar', { p_campana: camp.id, p_desde: 10, p_hasta: 300, p_socio: null, p_nombre: 'X', p_movil: null });
    expect(r.error?.message).toContain('talonarios enteros');
    r = await junta.rpc('loteria_asignar', { p_campana: camp.id, p_desde: 1, p_hasta: 1300, p_socio: null, p_nombre: 'X', p_movil: null });
    expect(r.error?.message).toContain('no existen');
    // El 3 ya lo tiene otra persona: sin reasignar no se toca
    await junta.from('loteria_talonarios').update({ titular_nombre: 'Otra Persona' }).eq('campana_id', camp.id).eq('numero', 3);
    r = await junta.rpc('loteria_asignar', { p_campana: camp.id, p_desde: 1, p_hasta: 300, p_socio: fam.socio.id, p_nombre: 'Prueba Automática', p_movil: '600000000', p_reasignar: false });
    expect(r.error).toBeNull();
    expect(r.data).toBe(11);
    expect((await talonario(3)).titular_nombre).toBe('Otra Persona');
    expect((await talonario(12)).socio_id).toBe(fam.socio.id);
    expect((await talonario(13)).titular_nombre).toBeNull();
    // Reasignando, también el 3
    r = await junta.rpc('loteria_asignar', { p_campana: camp.id, p_desde: 51, p_hasta: 75, p_socio: fam.socio.id, p_nombre: 'Prueba Automática', p_movil: null, p_reasignar: true });
    expect(r.data).toBe(1);
    expect((await talonario(3)).titular_nombre).toBe('Prueba Automática');
  });

  test('Ventas e ingresos: no se vende más de 25 ni se ingresa más de lo vendido', async () => {
    const t1 = await talonario(1);
    let r = await junta.from('loteria_talonarios').update({ vendidas: 26 }).eq('id', t1.id);
    expect(r.error?.message).toContain('25 participaciones');
    r = await junta.from('loteria_talonarios').update({ vendidas: 20 }).eq('id', t1.id);
    expect(r.error).toBeNull();
    r = await junta.from('loteria_ingresos').insert({ talonario_id: t1.id, importe: 125 });
    expect(r.error?.message).toContain('como mucho se pueden ingresar 100 €');
    r = await junta.from('loteria_ingresos').insert({ talonario_id: t1.id, importe: 100 });
    expect(r.error).toBeNull();
    // Ya ingresado: no se puede bajar de 20 vendidas ni dejarlo sin nadie
    r = await junta.from('loteria_talonarios').update({ vendidas: 10 }).eq('id', t1.id);
    expect(r.error?.message).toContain('no puede tener menos de 20 vendidas');
    r = await junta.from('loteria_talonarios').update({ titular_nombre: null, socio_id: null }).eq('id', t1.id);
    expect(r.error?.message).toMatch(/no se puede dejar sin nadie/);
    // Un talonario sin asignar no puede tener ventas
    const t40 = await talonario(40);
    r = await junta.from('loteria_talonarios').update({ vendidas: 1 }).eq('id', t40.id);
    expect(r.error?.message).toContain('no lo tiene nadie');
  });

  test('Historial: cada entrega, venta e ingreso queda apuntado con quién lo hizo', async () => {
    const { data } = await admin.from('loteria_movimientos').select('texto, creado_por_nombre, talonario_numero').eq('campana_id', camp.id);
    const textos = data.filter(m => m.talonario_numero === 1).map(m => m.texto);
    expect(textos.some(t => t.startsWith('Se entrega a Prueba Automática'))).toBe(true);
    expect(textos).toContain('Vendidas: 0 → 20 (Prueba Automática)');
    expect(textos.some(t => t.startsWith('Ingreso de 100 €'))).toBe(true);
    expect(data.every(m => m.creado_por_nombre && m.creado_por_nombre.includes('Prueba'))).toBe(true);
  });

  test('Campaña: el donativo tiene que ser menor que el precio y, con ventas, el precio no cambia', async () => {
    let r = await junta.from('loteria_campanas').update({ donativo: 5 }).eq('id', camp.id);
    expect(r.error).not.toBeNull();
    r = await junta.from('loteria_campanas').update({ precio: 6 }).eq('id', camp.id);
    expect(r.error?.message).toContain('no se puede cambiar el precio');
  });

  test('Comenzar una campaña con otra ya abierta no se puede', async () => {
    const { data: abierta } = await admin.from('loteria_campanas').select('id, nombre').not('inicio', 'is', null).is('cerrada_en', null).limit(1);
    test.skip(!abierta || !abierta.length, 'Ahora no hay ninguna campaña real abierta (y no abro una de prueba para no mostrarla en la web).');
    const r = await junta.from('loteria_campanas').update({ inicio: '2099-01-01' }).eq('id', camp.id);
    expect(r.error?.message).toContain('Ya hay otra campaña abierta');
  });

  test('Una familia no ve la lotería de la Junta ni puede tocarla', async () => {
    const { data: c } = await cliFam.from('loteria_campanas').select('id').eq('id', camp.id);
    expect(c).toEqual([]);
    const { data: t } = await cliFam.from('loteria_talonarios').select('id').eq('campana_id', camp.id);
    expect(t).toEqual([]);
    const r = await cliFam.rpc('loteria_asignar', { p_campana: camp.id, p_desde: 1, p_hasta: 25, p_socio: null, p_nombre: 'Yo', p_movil: null });
    expect(r.error?.message).toContain('Solo la Junta');
    const r2 = await cliFam.rpc('loteria_crear_talonarios', { p_campana: camp.id, p_cuantos: 1 });
    expect(r2.error?.message).toContain('Solo la Junta');
  });

  test('Panel: asignar un grupo con un talonario ya asignado avisa de quién lo tiene', async ({ page }) => {
    aceptarDialogos(page);
    await junta.from('loteria_talonarios').update({ titular_nombre: 'Persona Con Talonario' }).eq('campana_id', camp.id).eq('numero', 42);
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/admin-loteria.html');
    await page.selectOption('#campSel', camp.id);
    await expect(page.locator('#campEstado')).toContainText('Sin comenzar');
    await page.fill('#grupoForm [name=desde]', '1001');
    await page.fill('#grupoForm [name=hasta]', '1060');
    await expect(page.locator('#grupoPista')).toContainText('No se puede asignar parte de un talonario');
    await page.fill('#grupoForm [name=hasta]', '1075');
    await expect(page.locator('#grupoPista')).toContainText('Talonarios 41 a 43');
    await page.fill('#grupoForm [name=nombre]', 'Grupo De Prueba');
    await page.click('#grupoForm button[type=submit]');
    await expect(page.locator('#grupoAviso')).toContainText('Talonario 42 (1026–1050): Persona Con Talonario');
    await page.click('#grupoAviso [data-g=libres]');
    await expect(page.locator('#grupoOk')).toContainText('Asignados 2 talonarios a Grupo De Prueba');
    expect((await talonario(42)).titular_nombre).toBe('Persona Con Talonario');
    expect((await talonario(41)).titular_nombre).toBe('Grupo De Prueba');
  });

  test('Panel: crear un día de venta pide hora de fin y lo crea como Venta de Lotería', async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/admin-loteria.html');
    await page.selectOption('#campSel', camp.id);
    await page.fill('#ventaForm [name=dia]', '2099-12-05');
    await page.fill('#ventaForm [name=hora]', '17:00');
    await page.fill('#ventaForm [name=lugar]', 'Entrada del colegio');
    await page.click('#ventaForm button');
    await expect(page.locator('#ventaMsg')).toContainText('horas de comienzo y fin');
    await page.fill('#ventaForm [name=fin]', '16:00');
    await page.click('#ventaForm button');
    await expect(page.locator('#ventaMsg')).toContainText('después de la de comienzo');
    await page.fill('#ventaForm [name=fin]', '19:00');
    await page.click('#ventaForm button');
    await expect(page.locator('#ventas')).toContainText('de 17:00 a 19:00');
    const { data } = await admin.from('eventos').select('id, plantilla, sin_inscripcion, abierto_no_socios, titulo').eq('titulo', 'Venta de ' + camp.nombre);
    expect(data.length).toBe(1);
    expect(data[0]).toMatchObject({ plantilla: 'loteria', sin_inscripcion: true, abierto_no_socios: true });
    await admin.from('eventos').delete().eq('id', data[0].id);
  });
});

test.describe('Quiero comprar Lotería', () => {
  test('La función de mensajes pide los datos a quien no es socio (o dice que no hay lotería)', async () => {
    const { data: abierta } = await admin.rpc('loteria_publica');
    const r = await llamarFuncion('loteria-mensaje', { mensaje: 'Quiero 2 participaciones', nombre: 'Sin', apellidos: '', email: 'x@x.es', movil: '600000000' });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain(abierta && abierta.length ? 'nombre y tus apellidos' : 'no hay lotería a la venta');
  });

  test('Sin campaña abierta la página lo dice; con campaña, sale el reparto 4 € + 1 € de donativo', async ({ page }) => {
    const { data: abierta } = await admin.rpc('loteria_publica');
    await page.goto('/loteria.html');
    if (!abierta || !abierta.length) {
      await expect(page.locator('#cerrada')).toBeVisible();
      await expect(page.locator('#cerrada')).toContainText('no hay lotería a la venta');
    } else {
      const c = abierta[0];
      await expect(page.locator('#titulo')).toHaveText(c.nombre);
      if (Number(c.donativo)) await expect(page.locator('#subtitulo')).toContainText('es donativo para el AMPA');
      await expect(page.locator('#soySocio a')).toHaveAttribute('href', 'login.html?volver=loteria.html');
      // El calendario solo tiene ventas de lotería
      const { data: otros } = await admin.from('eventos').select('titulo').eq('activo', true).neq('plantilla', 'loteria').gte('fecha', c.inicio).limit(20);
      for (const o of otros || []) await expect(page.locator('#fechas')).not.toContainText(o.titulo);
    }
  });

  test('En la portada, «Quiero comprar Lotería» solo sale con la campaña abierta', async ({ page }) => {
    const { data: abierta } = await admin.rpc('loteria_publica');
    await page.goto('/index.html');
    await page.waitForTimeout(1500);
    await expect(page.locator('#heroLoteria')).toBeVisible({ visible: !!(abierta && abierta.length) });
  });
});
