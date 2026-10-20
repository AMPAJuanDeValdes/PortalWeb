// 11. Eventos terminados (familias y Junta), hora de fin, calendario y
//     portada. Los eventos de prueba llevan la MARCA y se borran al terminar.
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, entrar, aceptarDialogos, MARCA } = require('../ayudantes/datos');

test.describe.configure({ mode: 'serial' });

const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let fam, jefe, pasado, futuro, enCurso;

async function evento(titulo, campos) {
  const { data, error } = await admin.from('eventos').insert({
    titulo: `${MARCA}${process.env.RUN_ID} ${titulo}`, activo: true, tipo_elegibilidad: 'toda_familia', sin_inscripcion: true, ...campos
  }).select().single();
  if (error) throw error;
  return data;
}

test.describe('Eventos terminados', () => {
  test.beforeAll(async () => {
    fam = await crearFamilia({ etiqueta: 'pasados', alumnos: 1 });
    jefe = await crearFamilia({ etiqueta: 'pasadosj', esAdmin: true });
    // Empezó hace 3 horas y terminó hace 1: ya ha pasado
    pasado = await evento('Ya pasado', { fecha: iso(ahora - 3 * 3600e3), fecha_fin: iso(ahora - 3600e3) });
    futuro = await evento('Por venir', { fecha: iso(ahora + 5 * 86400e3) });
    // Empezó hace 2 horas sin hora de fin: aún no cuenta como terminado (3 horas)
    enCurso = await evento('En curso', { fecha: iso(ahora - 2 * 3600e3) });
  });
  test.afterAll(async () => {
    await admin.from('eventos').delete().in('id', [pasado?.id, futuro?.id, enCurso?.id].filter(Boolean));
  });

  test('La hora de fin tiene que ser después de la de comienzo', async () => {
    const { error } = await admin.from('eventos').update({ fecha_fin: iso(ahora + 4 * 86400e3) }).eq('id', futuro.id);
    expect(error?.message).toMatch(/después de la de comienzo|fecha_fin_check/);
  });

  test('Familias: los terminados solo salen en «Eventos terminados», en gris', async ({ page }) => {
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/eventos.html');
    await expect(page.locator('#ev-' + futuro.id)).toBeVisible();
    await expect(page.locator('#ev-' + enCurso.id)).toBeVisible();
    await expect(page.locator('#ev-' + pasado.id)).toBeHidden();
    await page.click('#filtros [data-f=terminado]');
    await expect(page.locator('#ev-' + pasado.id)).toBeVisible();
    await expect(page.locator('#ev-' + pasado.id)).toHaveClass(/terminado/);
    await expect(page.locator('#ev-' + futuro.id)).toBeHidden();
  });

  test('Familias: desde el calendario a un evento pasado se abre «Eventos terminados»', async ({ page }) => {
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/eventos.html#ev-' + pasado.id);
    await expect(page.locator('#filtros [data-f=terminado]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ev-' + pasado.id)).toBeVisible();
  });

  test('Mi perfil: en el calendario el evento pasado sale al final, en gris', async ({ page }) => {
    // Si se ejecuta justo a principio de mes, el evento pasado puede quedar en el mes anterior
    test.skip(new Date(ahora - 3 * 3600e3).getMonth() !== new Date(ahora).getMonth(), 'El evento pasado cae en el mes anterior');
    await entrar(page, fam.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    const fila = page.locator('#calendarioWrap .cal-ev', { hasText: pasado.titulo });
    await expect(fila).toHaveClass(/pasado/);
    await expect(fila).toContainText('Ya pasado');
    await expect(page.locator('#calendarioWrap .cal-pasados')).toBeVisible();
  });

  test('Junta: pestañas «Eventos existentes» y «Eventos pasados»', async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, jefe.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/admin-eventos.html');
    await expect(page.locator('#adm-ev-' + futuro.id)).toBeVisible();
    await expect(page.locator('#adm-ev-' + pasado.id)).toBeHidden();
    await page.click('#pestanasEventos [data-p=pasados]');
    await expect(page.locator('#adm-ev-' + pasado.id)).toBeVisible();
    await expect(page.locator('#adm-ev-' + futuro.id)).toBeHidden();
    // De un evento pasado no se avisa a las familias
    await expect(page.locator('#adm-ev-' + pasado.id + ' .avisarBtn')).toHaveCount(0);
  });

  test('El horario sale con la hora de fin («de … a …»)', async ({ page }) => {
    const conFin = await evento('Con hora de fin', { fecha: '2099-05-10T15:00:00Z', fecha_fin: '2099-05-10T17:00:00Z', abierto_no_socios: true });
    try {
      await entrar(page, fam.adultos[0].email);
      await expect(page).toHaveURL(/dashboard\.html/);
      await page.goto('/eventos.html');
      await expect(page.locator('#ev-' + conFin.id + ' .ev-hora')).toContainText('de 17:00 a 19:00');
    } finally {
      await admin.from('eventos').delete().eq('id', conFin.id);
    }
  });
});

test.describe('Portada y Banco de Uniformes', () => {
  test('«Qué hacemos»: la caja de Eventos lleva a los eventos', async ({ page }) => {
    await page.goto('/index.html');
    const caja = page.locator('#pista a.p-eventos');
    // (Netlify reescribe los enlaces «x.html» como «/x»)
    await expect(caja).toHaveAttribute('href', /publico(\.html)?$/);
    await expect(caja).toHaveAttribute('data-socio', 'eventos.html');
    await expect(page.locator('#pista a.p-libros')).toHaveAttribute('href', /login(\.html)?\?volver=prestamo\.html$/);
    // Sin sesión, al pulsarla se llega a los eventos abiertos a no socios
    await caja.click();
    await expect(page).toHaveURL(/publico(\.html)?$/);
  });

  test('Banco de Uniformes: queda claro que se regala una prenda por alumno/a', async ({ page }) => {
    const f = await crearFamilia({ etiqueta: 'unaprenda', alumnos: 1 });
    await entrar(page, f.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await page.goto('/uniformes.html');
    await expect(page.locator('.una-prenda')).toContainText('Cada alumno o alumna recibe una sola prenda');
  });
});
