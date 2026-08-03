// Alta autoservicio ("Hazte socio"): crea socio (estado recien_creada),
// adulto principal (con la contraseña que él mismo eligió), adulto
// secundario opcional (contraseña generada y enviada por email) y sus
// alumnos. Es la ÚNICA función pública que no requiere sesión previa,
// porque es exactamente para gente que todavía no tiene cuenta.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaCredenciales } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ETAPAS_VALIDAS = ['Infantil', 'Primaria', 'ESO', 'Bachillerato'];
const FORMAS_PAGO_VALIDAS = ['Transferencia', 'Domiciliación Bancaria'];

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const adulto1 = payload.adulto1;
  const adulto2 = payload.adulto2 || null;
  const alumnos = Array.isArray(payload.alumnos) ? payload.alumnos : [];
  const forma_pago = FORMAS_PAGO_VALIDAS.includes(payload.forma_pago) ? payload.forma_pago : null;

  if (!adulto1 || !adulto1.email || !adulto1.password || !adulto1.nombre || !adulto1.apellidos || !adulto1.dni_nie ||
      !adulto1.direccion || !adulto1.ciudad || !adulto1.provincia || !adulto1.codigo_postal) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos obligatorios del adulto principal' }) };
  }
  if (adulto2) {
    if (!adulto2.nombre || !adulto2.apellidos || !adulto2.email || !adulto2.dni_nie ||
        !adulto2.direccion || !adulto2.ciudad || !adulto2.provincia || !adulto2.codigo_postal) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos obligatorios del segundo adulto' }) };
    }
    if (adulto2.email.toLowerCase() === adulto1.email.toLowerCase()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'El segundo adulto debe tener un email distinto al principal' }) };
    }
  }
  for (const al of alumnos) {
    if (!al.nombre || !ETAPAS_VALIDAS.includes(al.etapa) || !al.curso) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cada alumno necesita nombre, etapa y curso válidos' }) };
    }
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: socio, error: socioError } = await supabaseAdmin.from('socios').insert({
      anio_ultima_cuota: new Date().getFullYear(),
      estado: 'recien_creada',
      forma_pago
    }).select('id').single();
    if (socioError) throw socioError;

    const { data: created1, error: create1Error } = await supabaseAdmin.auth.admin.createUser({
      email: adulto1.email, password: adulto1.password, email_confirm: true
    });
    if (create1Error) throw create1Error;

    const { error: ins1Error } = await supabaseAdmin.from('adultos').insert({
      id: created1.user.id, socio_id: socio.id, role: 'socio', force_password_change: false,
      nombre: adulto1.nombre, apellidos: adulto1.apellidos, email: adulto1.email,
      dni_nie: adulto1.dni_nie, es_pasaporte: !!adulto1.es_pasaporte, sexo: adulto1.sexo || null,
      direccion: adulto1.direccion || '', ciudad: adulto1.ciudad || '', provincia: adulto1.provincia || '',
      codigo_postal: adulto1.codigo_postal || '', telefono_fijo: adulto1.telefono_fijo || null,
      movil: adulto1.movil || null, relacion_alumnos: adulto1.relacion_alumnos || null
    });
    if (ins1Error) throw ins1Error;

    let emailAdulto2Enviado = null;
    if (adulto2 && adulto2.nombre && adulto2.email) {
      const password2 = generarPassword();
      const { data: created2, error: create2Error } = await supabaseAdmin.auth.admin.createUser({
        email: adulto2.email, password: password2, email_confirm: true
      });
      if (create2Error) throw create2Error;

      await supabaseAdmin.from('adultos').insert({
        id: created2.user.id, socio_id: socio.id, role: 'socio', force_password_change: true,
        nombre: adulto2.nombre, apellidos: adulto2.apellidos || '', email: adulto2.email,
        dni_nie: adulto2.dni_nie || 'PENDIENTE', es_pasaporte: !!adulto2.es_pasaporte, sexo: adulto2.sexo || null,
        direccion: adulto2.direccion || 'PENDIENTE', ciudad: adulto2.ciudad || 'PENDIENTE',
        provincia: adulto2.provincia || 'PENDIENTE', codigo_postal: adulto2.codigo_postal || '00000',
        telefono_fijo: adulto2.telefono_fijo || null, movil: adulto2.movil || null,
        relacion_alumnos: adulto2.relacion_alumnos || null
      });

      const { subject, text } = plantillaCredenciales({ nombre: adulto2.nombre, email: adulto2.email, password: password2 });
      try { await enviarEmail({ to: adulto2.email, subject, text }); } catch (e) { /* seguimos igual */ }
      emailAdulto2Enviado = adulto2.email;
    }

    for (const al of alumnos) {
      await supabaseAdmin.from('alumnos').insert({
        socio_id: socio.id, nombre: al.nombre, apellidos: al.apellidos || '',
        fecha_nacimiento: al.fecha_nacimiento || null, sexo: al.sexo || null,
        etapa: al.etapa, curso: al.curso, aula: al.aula || null
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, socio_id: socio.id, email_adulto2: emailAdulto2Enviado })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error desconocido' }) };
  }
};
