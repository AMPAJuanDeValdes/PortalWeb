// Alta autoservicio ("Hazte socio"): crea socio (estado recien_creada),
// adulto principal (con la contraseña que él mismo eligió), adulto
// secundario opcional (contraseña generada y enviada por email) y sus
// alumnos. Es la ÚNICA función pública que no requiere sesión previa,
// porque es exactamente para gente que todavía no tiene cuenta.
//
// IMPORTANTE (bug corregido): antes se creaba primero la fila de `socios`
// y después el usuario de acceso. Con un email repetido, el segundo paso
// fallaba pero la fila de `socios` se quedaba creada, sin adultos ni
// comprobante, y aparecía en el panel del admin como una solicitud vacía.
// Ahora: (1) se comprueba si los emails ya existen, (2) se crea primero el
// usuario de acceso, (3) después el socio y los demás datos, y (4) si algo
// falla a mitad, se deshace todo lo ya creado.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaCredenciales } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ETAPAS_VALIDAS = ['Infantil', 'Primaria', 'ESO', 'Bachillerato'];
const FORMAS_PAGO_VALIDAS = ['Transferencia', 'Domiciliación Bancaria'];

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Busca si un email ya pertenece a un adulto, y en qué estado está su cuenta.
async function buscarCuentaPorEmail(supabaseAdmin, email) {
  const { data } = await supabaseAdmin
    .from('adultos')
    .select('id, socio_id, socios(estado)')
    .ilike('email', email)
    .limit(1);
  if (!data || data.length === 0) return null;
  return { adultoId: data[0].id, socioId: data[0].socio_id, estado: data[0].socios ? data[0].socios.estado : null };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return json(400, { error: 'JSON no válido' }); }

  const adulto1 = payload.adulto1;
  const adulto2 = payload.adulto2 || null;
  const alumnos = Array.isArray(payload.alumnos) ? payload.alumnos : [];
  const forma_pago = FORMAS_PAGO_VALIDAS.includes(payload.forma_pago) ? payload.forma_pago : null;
  // El comprobante lo sube antes el navegador a comprobantes/publico/...
  // y aquí se registra junto con el resto: así nunca puede quedar una
  // solicitud de alta sin comprobante.
  const archivoPath = String(payload.archivo_path || '').trim();
  if (!archivoPath || !archivoPath.startsWith('publico/')) {
    return json(400, { error: 'Falta el comprobante de pago.' });
  }

  if (!adulto1 || !adulto1.email || !adulto1.password || !adulto1.nombre || !adulto1.apellidos || !adulto1.dni_nie ||
      !adulto1.direccion || !adulto1.ciudad || !adulto1.provincia || !adulto1.codigo_postal) {
    return json(400, { error: 'Faltan datos obligatorios del adulto principal' });
  }
  if (adulto2) {
    if (!adulto2.nombre || !adulto2.apellidos || !adulto2.email || !adulto2.dni_nie ||
        !adulto2.direccion || !adulto2.ciudad || !adulto2.provincia || !adulto2.codigo_postal) {
      return json(400, { error: 'Faltan datos obligatorios del segundo adulto' });
    }
    if (adulto2.email.toLowerCase() === adulto1.email.toLowerCase()) {
      return json(400, { error: 'El segundo adulto debe tener un email distinto al principal' });
    }
  }
  for (const al of alumnos) {
    if (!al.nombre || !al.apellidos || !ETAPAS_VALIDAS.includes(al.etapa) || !al.curso) {
      return json(400, { error: 'Cada alumno necesita nombre, apellidos, etapa y curso válidos' });
    }
    if (!al.fecha_nacimiento) {
      return json(400, { error: 'La fecha de nacimiento de cada alumno es obligatoria' });
    }
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) ¿Ya existe una cuenta con alguno de los emails?
  const existente1 = await buscarCuentaPorEmail(supabaseAdmin, adulto1.email);
  if (existente1) {
    if (existente1.estado === 'baja' || existente1.estado === 'falta_pago') {
      return json(409, {
        codigo: 'cuenta_inactiva',
        error: 'Ya existe una cuenta con este email, pero está inactiva o dada de baja. Puedes reactivarla enviando el comprobante de pago.'
      });
    }
    if (existente1.estado === 'recien_creada') {
      return json(409, { codigo: 'solicitud_pendiente', error: 'Ya hay una solicitud de alta en revisión con este email. En cuanto un administrador la apruebe, recibirás un correo.' });
    }
    return json(409, { codigo: 'cuenta_activa', error: 'Ya existe una cuenta activa con este email. Inicia sesión (o recupera tu contraseña si no la recuerdas).' });
  }
  if (adulto2) {
    const existente2 = await buscarCuentaPorEmail(supabaseAdmin, adulto2.email);
    if (existente2) {
      return json(409, { codigo: 'email_segundo_adulto_existente', error: 'El email del segundo adulto ya pertenece a otra cuenta. Usa otro email o déjalo para añadirlo más tarde.' });
    }
  }

  const usuariosCreados = []; // para poder deshacerlo todo si algo falla
  let socioId = null;

  async function deshacer() {
    if (socioId) await supabaseAdmin.from('socios').delete().eq('id', socioId); // borra en cascada adultos y alumnos
    for (const uid of usuariosCreados) await supabaseAdmin.auth.admin.deleteUser(uid);
  }

  try {
    // 2) Primero el usuario de acceso del adulto principal
    const { data: created1, error: create1Error } = await supabaseAdmin.auth.admin.createUser({
      email: adulto1.email, password: adulto1.password, email_confirm: true
    });
    if (create1Error) {
      const yaExiste = /already|registered|exists/i.test(create1Error.message || '');
      return json(yaExiste ? 409 : 500, {
        codigo: yaExiste ? 'cuenta_activa' : undefined,
        error: yaExiste ? 'Ya existe una cuenta con este email. Inicia sesión (o recupera tu contraseña).' : create1Error.message
      });
    }
    usuariosCreados.push(created1.user.id);

    // 3) Ahora sí, el socio
    const { data: socio, error: socioError } = await supabaseAdmin.from('socios').insert({
      anio_ultima_cuota: new Date().getFullYear(), estado: 'recien_creada', forma_pago
    }).select('id').single();
    if (socioError) throw socioError;
    socioId = socio.id;

    const { error: ins1Error } = await supabaseAdmin.from('adultos').insert({
      id: created1.user.id, socio_id: socioId, role: 'socio', force_password_change: false,
      nombre: adulto1.nombre, apellidos: adulto1.apellidos, email: adulto1.email,
      dni_nie: adulto1.dni_nie, es_pasaporte: !!adulto1.es_pasaporte, sexo: adulto1.sexo || null,
      direccion: adulto1.direccion, ciudad: adulto1.ciudad, provincia: adulto1.provincia,
      codigo_postal: adulto1.codigo_postal, telefono_fijo: adulto1.telefono_fijo || null,
      movil: adulto1.movil || null, relacion_alumnos: adulto1.relacion_alumnos || null
    });
    if (ins1Error) throw ins1Error;

    const { error: compError } = await supabaseAdmin.from('comprobantes_pago').insert({
      tipo: 'cuota_socio', socio_id: socioId, archivo_url: archivoPath
    });
    if (compError) throw compError;

    let emailAdulto2Enviado = null;
    if (adulto2) {
      const password2 = generarPassword();
      const { data: created2, error: create2Error } = await supabaseAdmin.auth.admin.createUser({
        email: adulto2.email, password: password2, email_confirm: true
      });
      if (create2Error) throw create2Error;
      usuariosCreados.push(created2.user.id);

      const { error: ins2Error } = await supabaseAdmin.from('adultos').insert({
        id: created2.user.id, socio_id: socioId, role: 'socio', force_password_change: true,
        nombre: adulto2.nombre, apellidos: adulto2.apellidos, email: adulto2.email,
        dni_nie: adulto2.dni_nie, es_pasaporte: !!adulto2.es_pasaporte, sexo: adulto2.sexo || null,
        direccion: adulto2.direccion, ciudad: adulto2.ciudad, provincia: adulto2.provincia,
        codigo_postal: adulto2.codigo_postal, telefono_fijo: adulto2.telefono_fijo || null,
        movil: adulto2.movil || null, relacion_alumnos: adulto2.relacion_alumnos || null
      });
      if (ins2Error) throw ins2Error;

      const { subject, text } = plantillaCredenciales({ nombre: adulto2.nombre, email: adulto2.email, password: password2 });
      try { await enviarEmail({ to: adulto2.email, subject, text }); emailAdulto2Enviado = adulto2.email; } catch (e) { /* seguimos igual */ }
    }

    if (alumnos.length > 0) {
      const { error: alError } = await supabaseAdmin.from('alumnos').insert(alumnos.map(al => ({
        socio_id: socioId, nombre: al.nombre, apellidos: al.apellidos || '',
        fecha_nacimiento: al.fecha_nacimiento, sexo: al.sexo || null,
        etapa: al.etapa, curso: al.curso, aula: al.aula || null
      })));
      if (alError) throw alError;
    }

    return json(200, { ok: true, socio_id: socioId, email_adulto2: emailAdulto2Enviado });
  } catch (err) {
    await deshacer();
    return json(500, { error: err.message || 'Error desconocido' });
  }
};
