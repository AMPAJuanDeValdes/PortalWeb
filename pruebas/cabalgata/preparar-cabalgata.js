// Prepara una Cabalgata DE PRUEBA en la base de datos real para probarla
// entera en tu ordenador (herramientas\probar-cabalgata.bat).
//
// · El evento lleva «solo_pruebas»: solo lo ven la Junta y las cuentas de
//   prueba (email con «ampa-prueba-»). Las familias reales no lo ven.
// · Crea una cuenta de la Junta de prueba y varias familias de prueba, 12
//   parejas ya apuntadas y algunas postulaciones a Rey, Paje y Responsable,
//   y le añade los dos documentos (autorización y cordón de seguridad).
// · Todo se borra con borrar-cabalgata.js (lo hace el .bat al terminar).
// Las cuentas y su contraseña se guardan en cuentas-de-prueba.txt (aquí al lado).
const fs = require('fs');
const path = require('path');
const { admin, crearFamilia, PASSWORD } = require('../ayudantes/datos');

const RAIZ = path.join(__dirname, '..', '..');
const SALIDA = path.join(__dirname, 'cuentas-de-prueba.txt');

// Las plantillas de documentos de la web (las mismas que usa el panel)
function plantillas() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'web', 'shared', 'plantillas-documentos.js'), 'utf8');
  return new Function(codigo + '; return PLANTILLAS_DOCUMENTOS;')();
}

async function ok(promesa, que) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${que}: ${error.message}`);
  return data;
}

// Antes de nada: que estén ejecutadas las migraciones que necesita la Cabalgata
async function comprobarMigraciones() {
  const pruebas = [
    ['migracion-cabalgata-puestos.sql', () => admin.from('eventos').select('puestos').limit(1)],
    ['migracion-cabalgata-reservas.sql', () => admin.from('eventos').select('plazas_reservadas, pajes_reservados').limit(1)],
    ['migracion-documentos-pareja.sql', () => admin.from('evento_inscripciones').select('parentesco, movil_invitado').limit(1)],
    ['migracion-eventos-prueba.sql', () => admin.from('eventos').select('solo_pruebas').limit(1)],
    ['migracion-pruebas-familia-real.sql', () => admin.from('pruebas_familias').select('socio_id').limit(1)]
  ];
  const faltan = [];
  for (const [archivo, consulta] of pruebas) { const { error } = await consulta(); if (error) faltan.push(archivo); }
  if (faltan.length) throw new Error('Antes hay que ejecutar en Supabase (supabase/pendientes): ' + faltan.join(', '));
}

const nacido = (edad) => `${2027 - edad - 1}-0${1 + (edad % 9)}-15`;   // tendrá «edad» años el 4 de enero de 2027

async function familia(etiqueta, adultos, alumnos, opciones = {}) {
  const f = await crearFamilia({ etiqueta, adultos: adultos.length, alumnos: alumnos.length, conNumero: true, ...opciones });
  for (let i = 0; i < adultos.length; i++) {
    await ok(admin.from('adultos').update({ nombre: adultos[i][0], apellidos: adultos[i][1] }).eq('id', f.adultos[i].id), 'nombre adulto');
    Object.assign(f.adultos[i], { nombre: adultos[i][0], apellidos: adultos[i][1] });
  }
  for (let i = 0; i < alumnos.length; i++) {
    const [nombre, apellidos, edad, curso, aula] = alumnos[i];
    const al = await ok(admin.from('alumnos').update({ nombre, apellidos, fecha_nacimiento: nacido(edad), etapa: 'Primaria', curso, aula })
      .eq('id', f.alumnos[i].id).select('*').single(), 'alumno');
    f.alumnos[i] = al;
  }
  return f;
}

(async () => {
  await comprobarMigraciones();

  // Si quedó una Cabalgata de prueba de otra vez, fuera (con sus inscripciones)
  await admin.from('eventos').delete().eq('solo_pruebas', true).ilike('titulo', 'Cabalgata%');

  const ahora = Date.now();
  const ev = await ok(admin.from('eventos').insert({
    titulo: 'Cabalgata de Reyes 2027 (PRUEBA)', plantilla: 'cabalgata', solo_pruebas: true, activo: true,
    tipo_elegibilidad: 'toda_familia', metodo_asignacion: 'sorteo', requiere_pareja_adulto_alumno: true,
    elegibilidad_modo: 'edad', edad_min: 6, edad_max: 12,
    // Como la de verdad: 12 alumnos/as con 12 adultos, 1 Rey (Gaspar) y 2 Pajes.
    // Edades: de 6 a 12 años el 4/1/2027 = nacidos del 5/1/2014 al 4/1/2021
    aforo_total: 12, plazas_reservadas: 0, pajes_reservados: 0,
    puestos: ['gaspar', 'paje'],
    fecha: '2027-01-04T15:00:00Z', lugar: 'Centro Cultural Antonio Machado',
    fecha_apertura_socios: new Date(ahora - 3600e3).toISOString(),
    fecha_cierre_inscripcion: new Date(ahora + 14 * 86400e3).toISOString(),
    descripcion: 'Evento de prueba: solo lo ven la Junta y las cuentas de prueba.'
  }).select('*').single(), 'crear el evento');

  // Los dos documentos, ya preparados
  for (const t of plantillas()) {
    const archivo = fs.readFileSync(path.join(RAIZ, 'web', t.archivo));
    const ruta = `${ev.id}/${Date.now()}-${path.basename(t.archivo)}`;
    await ok(admin.storage.from('documentos-evento').upload(ruta, archivo, { contentType: 'application/pdf' }), 'subir ' + t.titulo);
    await ok(admin.from('documentos_evento').insert({ evento_id: ev.id, titulo: t.titulo, aplica_a: t.aplica_a,
      tipo_documento: 'plantilla_firma', pagina_rellenable: t.pagina, archivo_base_url: ruta, campos: t.campos }), 'documento ' + t.titulo);
  }

  // Cuentas para probar a mano
  const junta = await crearFamilia({ etiqueta: 'junta', esAdmin: true, conNumero: true });
  await ok(admin.from('adultos').update({ nombre: 'Junta', apellidos: 'De Prueba' }).eq('id', junta.adultos[0].id), 'junta');
  const garcia = await familia('garcia', [['Ana', 'García Ruiz'], ['Pedro', 'Martín Sanz']],
    [['Lucas', 'Martín García', 7, '2º', 'A'], ['Sofía', 'Martín García', 10, '5º', 'B']]);
  const lopez = await familia('lopez', [['Elena', 'López Gil']], [['Hugo', 'Pérez López', 13, '6º', 'C'], ['Lía', 'Pérez López', 5, '1º', 'A']]);
  const sinConfirmar = await familia('sinconfirmar', [['Raúl', 'Soler Díaz']], [['Nora', 'Soler Vega', 9, '4º', 'A']], { datosRevisados: false });

  // 12 familias ya apuntadas (la de 3 y la de 9, con un adulto no socio) y postulaciones
  const nombres = ['Álvarez', 'Benítez', 'Castro', 'Delgado', 'Escobar', 'Fuentes', 'Gómez', 'Herrera', 'Iglesias', 'Jiménez', 'Lara', 'Molina'];
  const puestos = ['gaspar', 'paje', 'paje', 'gaspar', 'paje'];
  const apuntadas = [];
  for (let k = 0; k < 12; k++) {
    const ap = nombres[k];
    const f = await familia('cab' + (k + 1), [['Madre', ap + ' Prueba'], ['Padre', ap + ' Ensayo']], [['Alumno', ap + ' Prueba', 6 + (k % 7), (1 + (k % 6)) + 'º', 'A']]);
    const base = { evento_id: ev.id, socio_id: f.socio.id, grupo_id: require('crypto').randomUUID() };
    await ok(admin.from('evento_inscripciones').insert({ ...base, tipo_miembro: 'alumno', alumno_id: f.alumnos[0].id }), 'apuntar alumno');
    const noSocio = k === 2 || k === 8;
    await ok(admin.from('evento_inscripciones').insert(noSocio
      ? { ...base, tipo_miembro: 'invitado', nombre_invitado: 'Abuela', apellidos_invitado: ap + ' Mayor', dni_invitado: '00000000T', movil_invitado: '600000001', parentesco: 'Abuelo/a' }
      : { ...base, tipo_miembro: 'adulto', adulto_id: f.adultos[0].id, parentesco: 'Madre' }), 'apuntar adulto');
    if (puestos[k]) await ok(admin.from('evento_postulaciones').insert({ evento_id: ev.id, puesto: puestos[k], socio_id: f.socio.id, adulto_id: f.adultos[1].id }), 'postulación');
    apuntadas.push(f);
  }

  // Tu familia real (si pusiste su email): ve la Cabalgata de prueba mientras dura
  let tuFamilia = '';
  const email = (process.env.AMPA_FAMILIA_PRUEBA || '').trim();
  if (email) {
    const { data: ad } = await admin.from('adultos').select('socio_id, nombre, apellidos').ilike('email', email).limit(1);
    if (!ad || !ad.length) throw new Error('No hay ningún adulto con el email ' + email);
    await ok(admin.from('pruebas_familias').upsert({ socio_id: ad[0].socio_id }), 'añadir tu familia');
    const { data: s } = await admin.from('socios').select('datos_revisados_en, estado').eq('id', ad[0].socio_id).single();
    tuFamilia = `TU FAMILIA (${ad[0].nombre} ${ad[0].apellidos}, ${email}): entra con tu contraseña de siempre; ve la Cabalgata de prueba.` +
      (s && s.estado !== 'activa' ? ' OJO: la cuenta no está activa.' : '') +
      (s && !s.datos_revisados_en ? ' OJO: no tiene los datos confirmados, así que no podrá apuntarse.' : '') +
      '\n  Al terminar se borran sus inscripciones y documentos de la prueba (nada más de tu familia).\n';
  }

  const linea = (quien, f, para) => `${quien}\n  Email: ${f.adultos[0].email}\n  Contraseña: ${PASSWORD}\n  Para probar: ${para}\n`;
  const texto = [
    'CABALGATA DE PRUEBA — cuentas para entrar en http://localhost:8888/login.html',
    `(se crearon el ${new Date().toLocaleString('es-ES')}; todas se borran al terminar)\n`,
    tuFamilia,
    linea('JUNTA (administración)', junta, 'Panel → Eventos → «Cabalgata de Reyes 2027 (PRUEBA)»: Inscritos, Plazas reservadas, Postulaciones, Documentos, Listado (Excel), Sortear (antes cambia la fecha de cierre a una pasada).'),
    linea('Familia García (2 adultos, Lucas 7 años y Sofía 10)', garcia, 'apuntar a un alumno con un adulto socio y otro con un adulto no socio; postularse a Rey Gaspar o Paje Real con el adulto que no acompaña; firmar los documentos y descargarlos.'),
    `  Segundo adulto de la familia García: ${garcia.adultos[1].email} (misma contraseña)\n`,
    linea('Familia López (Hugo 13 años y Lía 5)', lopez, 'que no deja apuntar a alumnos fuera de 6 a 12 años.'),
    linea('Familia sin datos confirmados', sinConfirmar, 'que no puede apuntarse ni postularse hasta confirmar sus datos.'),
    `Además hay 12 familias ya apuntadas (2 con un adulto no socio) y 5 postulaciones (Rey Gaspar y Paje Real).`,
    `Ejemplo de familia ya apuntada: ${apuntadas[0].adultos[0].email} (misma contraseña).`
  ].join('\n');
  fs.writeFileSync(SALIDA, texto, 'utf8');
  console.log('\n' + texto + '\n\nGuardado en ' + SALIDA + '\n');
})().catch(e => { console.error('\n[!] ' + e.message + '\n'); process.exit(1); });
