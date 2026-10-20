// 5. Seguridad: una familia no puede ver ni tocar lo que no es suyo
const { test, expect } = require('@playwright/test');
const { admin, crearFamilia, clienteComo, llamarFuncion, entrar } = require('../ayudantes/datos');

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

  test('Solo la cuenta principal (socio 0000) hace Admin: el resto de la Junta no puede', async () => {
    const jefe = await crearFamilia({ etiqueta: 'noprincipal', esAdmin: true });
    const { cliente } = await clienteComo(jefe.adultos[0].email);
    const { data: soy } = await cliente.rpc('es_admin_principal');
    expect(soy).toBe(false);
    let r = await cliente.rpc('adulto_cambiar_admin', { p_adulto: a.adultos[0].id, p_admin: true });
    expect(r.error?.message).toContain('cuenta principal');
    r = await cliente.from('adultos').update({ role: 'admin' }).eq('id', a.adultos[0].id);
    expect(r.error?.message).toContain('cuenta principal');
    const { data } = await admin.from('adultos').select('role').eq('id', a.adultos[0].id).single();
    expect(data.role).toBe('socio');
    // Y nadie de la Junta puede quedarse con el número 0000
    r = await cliente.from('socios').update({ numero_secuencial: '0000' }).eq('id', a.socio.id);
    expect(r.error?.message).toContain('0000');
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

  test('Domiciliación ⇔ IBAN: la familia no cambia el pago a mano y no hay una cosa sin la otra', async () => {
    const { cliente } = await clienteComo(a.adultos[0].email);
    let r = await cliente.from('socios').update({ forma_pago: 'Domiciliación Bancaria', iban: 'ES9121000418450200051332' }).eq('id', a.socio.id);
    expect(r.error && r.error.message).toMatch(/orden SEPA/);
    r = await admin.from('socios').update({ forma_pago: 'Domiciliación Bancaria', iban: null }).eq('id', a.socio.id);
    expect(r.error && r.error.message).toMatch(/hace falta el IBAN/);
    r = await admin.from('socios').update({ forma_pago: 'Transferencia', iban: 'ES9121000418450200051332' }).eq('id', a.socio.id);
    expect(r.error && r.error.message).toMatch(/Con IBAN/);
    // Eligió domiciliación sin firmar: puede pasar a transferencia
    await admin.from('socios').update({ forma_pago: null, iban: null, sepa_pendiente: true }).eq('id', a.socio.id);
    r = await cliente.rpc('socio_pagar_por_transferencia');
    expect(r.error).toBeNull();
    const { data } = await admin.from('socios').select('forma_pago, iban, sepa_pendiente').eq('id', a.socio.id).single();
    expect(data).toEqual({ forma_pago: 'Transferencia', iban: null, sepa_pendiente: false });
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
    for (const f of ['admin-gestionar-cuenta', 'admin-import-socios', 'enviar-email-masivo', 'prestamo-repartir', 'uniformes-repartir', 'evento-sortear', 'circular-borrador', 'push-avisar-evento', 'push-avisar-convocatoria']) {
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
