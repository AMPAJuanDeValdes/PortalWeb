// 7. Eventos: reglas de inscripción (alergias, niños con adulto, aforo,
//    voluntarios, externos) comprobadas con permisos reales de familia y
//    de visitante sin cuenta. Los eventos de prueba se crean con la MARCA
//    en el título y se borran al terminar.
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { admin, crearFamilia, clienteComo, entrar, aceptarDialogos, MARCA } = require('../ayudantes/datos');

test.describe.configure({ mode: 'serial' });

const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString();
let fam, cli, choco, taller;

async function crearEvento(campos) {
  const { data, error } = await admin.from('eventos').insert({ fecha: enUnMes, activo: true, ...campos, titulo: MARCA + campos.titulo }).select().single();
  if (error) throw error;
  return data;
}

test.describe('Eventos', () => {
  test.beforeAll(async () => {
    fam = await crearFamilia({ etiqueta: 'eventos', alumnos: 2, conNumero: true });
    cli = (await clienteComo(fam.adultos[0].email)).cliente;
    choco = await crearEvento({ titulo: 'Chocolatada', tipo_elegibilidad: 'toda_familia', pide_alergias: true,
      alumnos_requieren_adulto: true, voluntariado_modo: 'adultos_y_ninos', permite_invitados: true, precio_invitado: 3 });
    taller = await crearEvento({ titulo: 'Taller', tipo_elegibilidad: 'alumnos', elegibilidad_modo: 'curso',
      cursos_permitidos: [{ etapa: 'Primaria', curso: '3º' }], aforo_total: 2, abierto_no_socios: true,
      voluntariado_modo: 'adultos', precio_invitado: 5 });
  });
  test.afterAll(async () => {
    await admin.from('eventos').delete().in('id', [choco?.id, taller?.id].filter(Boolean));
  });

  const base = () => ({ evento_id: choco.id, socio_id: fam.socio.id });

  test('Chocolatada: un alumno solo necesita adulto encargado y todos indican alergias', async () => {
    let r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id, tiene_alergias: false });
    expect(r.error?.message).toContain('adulto socio de otra familia');
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id });
    expect(r.error?.message).toContain('alergias');
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id, tiene_alergias: true, alergias: 'Gluten' });
    expect(r.error).toBeNull();
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id, tiene_alergias: false });
    expect(r.error).toBeNull();
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id, tiene_alergias: false });
    expect(r.error?.message).toContain('Ya está apuntado');
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'invitado', nombre_invitado: 'Abuela', apellidos_invitado: 'Prueba', edad: 70, tiene_alergias: false });
    expect(r.error).toBeNull();
  });

  test('Chocolatada: alumnos de otra familia sin adulto van con un socio ya apuntado', async () => {
    const otra = await crearFamilia({ etiqueta: 'acompana', alumnos: 1 });
    const c2 = (await clienteComo(otra.adultos[0].email)).cliente;
    const numero = fam.socio.numero_secuencial;
    let r = await c2.rpc('evento_buscar_acompanante', { p_evento_id: choco.id, p_numero: numero, p_nombre: 'Nadie' });
    expect(r.error?.message).toContain('no hay ningún adulto');
    r = await c2.rpc('evento_buscar_acompanante', { p_evento_id: choco.id, p_numero: numero, p_nombre: fam.adultos[0].nombre });
    expect(r.error).toBeNull();
    const acompanante = r.data[0].adulto_id;
    expect(acompanante).toBe(fam.adultos[0].id);
    r = await c2.from('evento_inscripciones').insert({ evento_id: choco.id, socio_id: otra.socio.id, tipo_miembro: 'alumno',
      alumno_id: otra.alumnos[0].id, tiene_alergias: false, responsable_adulto_id: acompanante, responsable_nombre: 'Prueba' });
    expect(r.error).toBeNull();
  });

  test('Chocolatada: un alumno solo puede ser voluntario con un adulto de su familia', async () => {
    let r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'alumno', alumno_id: fam.alumnos[1].id, es_voluntario: true });
    expect(r.error).not.toBeNull();
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id, es_voluntario: true });
    expect(r.error).toBeNull();
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'alumno', alumno_id: fam.alumnos[1].id, es_voluntario: true });
    expect(r.error).toBeNull();
  });

  test('Taller: aforo, curso de los externos y voluntarios solo adultos', async () => {
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const externo = (curso) => ({ nombre_contacto: 'Madre Prueba', email_contacto: MARCA + 'ext@example.com', telefono_contacto: '600000000',
      alumno_nombre: 'Externo', alumno_apellidos: 'Prueba', alumno_etapa: 'Primaria', alumno_curso: curso });

    let r = await anon.rpc('evento_inscribir_publico', { p_evento_id: taller.id, p_datos: externo('6º'), p_actividades: [] });
    expect(r.error?.message).toContain('curso');
    r = await anon.rpc('evento_inscribir_publico', { p_evento_id: taller.id, p_datos: externo('3º'), p_actividades: [] });
    expect(r.error).toBeNull();
    r = await cli.from('evento_inscripciones').insert({ evento_id: taller.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id });
    expect(r.error).toBeNull();
    // 2 de 2: el siguiente no cabe
    r = await anon.rpc('evento_inscribir_publico', { p_evento_id: taller.id, p_datos: externo('3º'), p_actividades: [] });
    expect(r.error?.message).toContain('completo');
    // los voluntarios no ocupan plaza, pero aquí solo pueden ser adultos
    r = await cli.from('evento_inscripciones').insert({ evento_id: taller.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[1].id, es_voluntario: true });
    expect(r.error?.message).toContain('adultos');
    r = await cli.from('evento_inscripciones').insert({ evento_id: taller.id, socio_id: fam.socio.id, tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id, es_voluntario: true });
    expect(r.error).toBeNull();
  });

  test('Editar un evento con inscritos no borra las inscripciones', async () => {
    const { error } = await admin.from('eventos').update({ titulo: MARCA + 'Taller corregido', aforo_total: 3 }).eq('id', taller.id);
    expect(error).toBeNull();
    const { count } = await admin.from('evento_inscripciones').select('id', { count: 'exact', head: true }).eq('evento_id', taller.id).eq('es_voluntario', false);
    expect(count).toBe(2);
  });

  test('Premios: la Junta los añade y la familia los ve con el ganador', async () => {
    const { error } = await admin.from('evento_premios').insert({ evento_id: choco.id, puesto: '1er premio', premio: 'Trofeo', ganador: 'Alumno1 Prueba' });
    expect(error).toBeNull();
    const { data } = await cli.from('evento_premios').select('puesto, ganador').eq('evento_id', choco.id);
    expect(data).toEqual([{ puesto: '1er premio', ganador: 'Alumno1 Prueba' }]);
    const r = await cli.from('evento_premios').insert({ evento_id: choco.id, puesto: 'Trampa' });
    expect(r.error).not.toBeNull();   // una familia no puede crear premios
  });

  test('Página de eventos: la familia ve su Chocolatada con las alergias', async ({ page }) => {
    aceptarDialogos(page);
    await entrar(page, fam.adultos[0].email);
    // Esperar a que el Inicio termine de cargar antes de cambiar de página
    await expect(page.locator('#saludo')).toContainText('Hola, ', { timeout: 15_000 });
    await page.goto('/eventos.html');
    const card = page.locator('.evento-card', { hasText: MARCA + 'Chocolatada' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Alergias: Gluten');
    await expect(card).toContainText('Abuela Prueba');
    await expect(card).toContainText('Ganador/a: Alumno1 Prueba');
  });
});
