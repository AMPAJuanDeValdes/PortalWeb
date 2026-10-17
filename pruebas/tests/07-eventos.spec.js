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
    fam = await crearFamilia({ etiqueta: 'eventos', adultos: 2, alumnos: 2, conNumero: true });
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

  test('Chocolatada: un alumno puede ser voluntario si un adulto de su familia va o es voluntario', async () => {
    const sola = await crearFamilia({ etiqueta: 'voluntaria', alumnos: 1 });
    const c3 = (await clienteComo(sola.adultos[0].email)).cliente;
    const suya = { evento_id: choco.id, socio_id: sola.socio.id };
    let r = await c3.from('evento_inscripciones').insert({ ...suya, tipo_miembro: 'alumno', alumno_id: sola.alumnos[0].id, es_voluntario: true });
    expect(r.error?.message).toContain('adulto de la familia');
    // El adulto va al evento (no como voluntario): basta para que el alumno sea voluntario
    r = await c3.from('evento_inscripciones').insert({ ...suya, tipo_miembro: 'adulto', adulto_id: sola.adultos[0].id, tiene_alergias: false });
    expect(r.error).toBeNull();
    r = await c3.from('evento_inscripciones').insert({ ...suya, tipo_miembro: 'alumno', alumno_id: sola.alumnos[0].id, es_voluntario: true });
    expect(r.error).toBeNull();
  });

  test('Quien está apuntado no puede ser voluntario, y al revés', async () => {
    // adultos[0] ya está apuntado a la Chocolatada
    let r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id, es_voluntario: true });
    expect(r.error?.message).toContain('voluntario');
    // adultos[1] se apunta como voluntario: ya no puede apuntarse como asistente
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[1].id, es_voluntario: true });
    expect(r.error).toBeNull();
    r = await cli.from('evento_inscripciones').insert({ ...base(), tipo_miembro: 'adulto', adulto_id: fam.adultos[1].id, tiene_alergias: false });
    expect(r.error?.message).toContain('voluntario');
  });

  test('Eventos a la misma hora: un alumno apuntado a uno no puede apuntarse al otro', async () => {
    const [x, y] = [await crearEvento({ titulo: 'Simultaneo 1', tipo_elegibilidad: 'alumnos' }), await crearEvento({ titulo: 'Simultaneo 2', tipo_elegibilidad: 'alumnos' })];
    try {
      const [a, b] = [x.id, y.id].sort();
      let r = await admin.from('evento_incompatibles').insert({ evento_a: a, evento_b: b });
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert({ evento_id: x.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id });
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert({ evento_id: y.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id });
      expect(r.error?.message).toContain('a la misma hora');
      // Otro alumno de la familia sí puede ir al segundo
      r = await cli.from('evento_inscripciones').insert({ evento_id: y.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[1].id });
      expect(r.error).toBeNull();
    } finally {
      await admin.from('eventos').delete().in('id', [x.id, y.id]);
    }
  });

  test('Curso de Warhammer: se crea con sus 12 sesiones y el alumno se apunta al curso entero', async () => {
    const curso = await crearEvento({ titulo: 'Warhammer', plantilla: 'warhammer', cursos_permitidos: [], elegibilidad_modo: null });
    try {
      expect(curso.abierto_no_socios).toBe(true);
      expect(Number(curso.precio_invitado)).toBe(48);
      const { data: ses } = await admin.from('evento_sesiones').select('numero, fecha').eq('evento_id', curso.id).order('numero');
      expect(ses.map(s => s.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(ses.every(s => s.fecha === null)).toBe(true);
      const alumno = { evento_id: curso.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[0].id };
      // Hay que decir quién lo recoge, o marcar que sale solo/a
      let r = await cli.from('evento_inscripciones').insert(alumno);
      expect(r.error?.message).toContain('persona diferente');
      r = await cli.from('evento_inscripciones').insert({ ...alumno, sale_solo: true });
      expect(r.error).toBeNull();
    } finally {
      await admin.from('eventos').delete().eq('id', curso.id);
    }
  });

  test('Talleres: Sí/No a si lo recoge otra persona (y sus datos), e instrucciones especiales', async () => {
    const t = await crearEvento({ titulo: 'Taller recogida', plantilla: 'taller', cursos_permitidos: [], elegibilidad_modo: null, pide_instrucciones: true });
    try {
      const alumno = (k) => ({ evento_id: t.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[k].id });
      let r = await cli.from('evento_inscripciones').insert(alumno(0));
      expect(r.error?.message).toContain('persona diferente');
      r = await cli.from('evento_inscripciones').insert({ ...alumno(0), recoge_otra: true, recoge_nombre: 'Ana' });
      expect(r.error?.message).toContain('móvil');
      r = await cli.from('evento_inscripciones').insert({ ...alumno(0), recoge_otra: true, recoge_nombre: 'Ana', recoge_apellidos: 'Prueba', recoge_movil: '123' });
      expect(r.error?.message).toContain('no es válido');
      // Salir solo/a es solo del Curso de Warhammer: aquí no cuenta
      r = await cli.from('evento_inscripciones').insert({ ...alumno(0), sale_solo: true });
      expect(r.error?.message).toContain('persona diferente');
      r = await cli.from('evento_inscripciones').insert({ ...alumno(0), recoge_otra: true, recoge_nombre: 'Ana', recoge_apellidos: 'Prueba',
        recoge_movil: '600 000 000', instrucciones: 'Sale a las 17:00' }).select().single();
      expect(r.error).toBeNull();
      expect(r.data.instrucciones).toBe('Sale a las 17:00');
      r = await cli.from('evento_inscripciones').insert({ ...alumno(1), recoge_otra: false, recoge_nombre: 'Se ignora' }).select().single();
      expect(r.error).toBeNull();
      expect(r.data.recoge_nombre).toBeNull();
    } finally {
      await admin.from('eventos').delete().eq('id', t.id);
    }
  });

  test('Curso de Warhammer y talleres que coinciden con una sesión', async () => {
    const curso = await crearEvento({ titulo: 'Warhammer coincide', plantilla: 'warhammer', cursos_permitidos: [], elegibilidad_modo: null });
    const futuro = await crearEvento({ titulo: 'Taller coincide', plantilla: 'taller', cursos_permitidos: [], elegibilidad_modo: null });
    try {
      const { data: ses } = await admin.from('evento_sesiones').select('id, numero').eq('evento_id', curso.id).order('numero');
      // La Junta marca que el taller coincide con la sesión 5 (con su cliente, como en el panel)
      const jefe = await crearFamilia({ etiqueta: 'jefecoincide', esAdmin: true });
      const cj = (await clienteComo(jefe.adultos[0].email)).cliente;
      let r = await cj.rpc('evento_guardar_sesiones_incompatibles', { p_evento: futuro.id, p_sesiones: [ses[4].id] });
      expect(r.error).toBeNull();
      const al = (k, ev) => ({ evento_id: ev.id, socio_id: fam.socio.id, tipo_miembro: 'alumno', alumno_id: fam.alumnos[k].id, recoge_otra: false });

      // En el taller (que no ha pasado) → no puede entrar al curso
      r = await cli.from('evento_inscripciones').insert(al(0, futuro));
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert({ ...al(0, curso), sale_solo: true });
      expect(r.error?.message).toContain('coincide con la sesión 5');

      // En el curso → no puede ir al taller
      r = await cli.from('evento_inscripciones').insert({ ...al(1, curso), sale_solo: true });
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert(al(1, futuro));
      expect(r.error?.message).toContain('sesión 5 es a la misma hora');

      // Sale del curso → ya puede ir al taller, pero no volver al curso
      r = await cli.from('evento_inscripciones').delete().eq('evento_id', curso.id).eq('alumno_id', fam.alumnos[1].id);
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert(al(1, futuro));
      expect(r.error).toBeNull();
      await cli.from('evento_inscripciones').delete().eq('evento_id', futuro.id).eq('alumno_id', fam.alumnos[1].id);
      r = await cli.from('evento_inscripciones').insert({ ...al(1, curso), sale_solo: true });
      expect(r.error?.message).toContain('ya no puede volver');
    } finally {
      await admin.from('eventos').delete().in('id', [curso.id, futuro.id]);
    }
  });

  test('Visita al comedor: como mucho un adulto por familia', async () => {
    const comedor = await crearEvento({ titulo: 'Comedor', plantilla: 'comedor', aforo_total: 2 });
    try {
      let r = await cli.from('evento_inscripciones').insert({ evento_id: comedor.id, socio_id: fam.socio.id, tipo_miembro: 'adulto', adulto_id: fam.adultos[0].id });
      expect(r.error).toBeNull();
      r = await cli.from('evento_inscripciones').insert({ evento_id: comedor.id, socio_id: fam.socio.id, tipo_miembro: 'adulto', adulto_id: fam.adultos[1].id });
      expect(r.error?.message).toContain('uno por familia');
    } finally {
      await admin.from('eventos').delete().eq('id', comedor.id);
    }
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
