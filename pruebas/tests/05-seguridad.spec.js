// 5. Seguridad: una familia no puede ver ni tocar lo que no es suyo
const { test, expect } = require('@playwright/test');
const { crearFamilia, clienteComo, llamarFuncion, entrar } = require('../ayudantes/datos');

// Si una prueba falla, las demás del grupo se siguen ejecutando
test.describe.configure({ mode: 'default' });

test.describe('Seguridad', () => {
  let a, b, impago;
  test.beforeAll(async () => {
    a = await crearFamilia({ etiqueta: 'segA', alumnos: 1 });
    b = await crearFamilia({ etiqueta: 'segB', alumnos: 1 });
    impago = await crearFamilia({ etiqueta: 'segImpago', estado: 'falta_pago' });
  });

  test('Un socio no puede hacerse admin', async () => {
    const { cliente } = await clienteComo(a.adultos[0].email);
    const { error } = await cliente.from('adultos').update({ role: 'admin' }).eq('id', a.adultos[0].id);
    expect(error && error.message).toMatch(/rol/i);
  });

  test('Un socio no puede reactivar su propia cuenta', async () => {
    const { cliente } = await clienteComo(impago.adultos[0].email);
    const { error } = await cliente.from('socios').update({ estado: 'activa' }).eq('id', impago.socio.id);
    expect(error && error.message).toMatch(/estado/i);
  });

  test('Un socio no puede cambiarse el número de socio', async () => {
    const { cliente } = await clienteComo(a.adultos[0].email);
    const { error } = await cliente.from('socios').update({ numero_secuencial: '0001' }).eq('id', a.socio.id);
    expect(error).not.toBeNull();
  });

  test('Un socio no ve los datos de otra familia', async () => {
    const { cliente } = await clienteComo(a.adultos[0].email);
    for (const [tabla, filtro] of [['adultos', 'socio_id'], ['alumnos', 'socio_id'], ['socios', 'id'], ['mandatos_sepa', 'socio_id'], ['comprobantes_pago', 'socio_id']]) {
      const { data } = await cliente.from(tabla).select('*').eq(filtro, b.socio.id);
      expect(data || [], `tabla ${tabla}`).toHaveLength(0);
    }
  });

  test('Un socio no puede modificar otra familia', async () => {
    const { cliente } = await clienteComo(a.adultos[0].email);
    const { data } = await cliente.from('adultos').update({ movil: '666' }).eq('id', b.adultos[0].id).select('id');
    expect(data || []).toHaveLength(0);
  });

  test('Funciones de admin: 403 con un socio, 401 sin sesión', async () => {
    const { token } = await clienteComo(a.adultos[0].email);
    for (const f of ['admin-gestionar-cuenta', 'admin-import-socios', 'enviar-email-masivo', 'prestamo-repartir', 'uniformes-repartir', 'evento-sortear']) {
      const conSocio = await llamarFuncion(f, { accion: 'baja', socioId: b.socio.id }, token);
      expect(conSocio.status, f + ' con socio').toBe(403);
      const sinToken = await llamarFuncion(f, {}, null);
      expect(sinToken.status, f + ' sin sesión').toBe(401);
    }
  });

  test('Un socio normal no ve la Administración ni entra en sus páginas', async ({ page }) => {
    await entrar(page, a.adultos[0].email);
    await expect(page).toHaveURL(/dashboard\.html/);
    await expect(page.locator('#adminSection')).toBeHidden();
    await page.goto('/admin-socios.html');
    await expect(page).toHaveURL(/dashboard(\.html)?$/);
    await page.goto('/admin.html');
    await expect(page).toHaveURL(/dashboard(\.html)?$/);
  });
});
