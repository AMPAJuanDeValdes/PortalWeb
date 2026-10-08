// Invita a un segundo adulto de la misma familia (mismo socio_id).
// El adulto que llama debe estar autenticado y pertenecer a un socio con
// menos de 2 adultos todavía. Usa la SERVICE ROLE KEY (variables de
// entorno de Netlify), nunca expuesta al navegador.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaCredenciales } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) };
  }
  const accessToken = authHeader.replace('Bearer ', '');
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) };
  }

  const { data: adultoActual, error: adultoError } = await supabaseAdmin
    .from('adultos')
    .select('socio_id')
    .eq('id', userData.user.id)
    .single();
  if (adultoError || !adultoActual) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No se encontró tu ficha de adulto' }) };
  }

  const { count } = await supabaseAdmin
    .from('adultos')
    .select('id', { count: 'exact', head: true })
    .eq('socio_id', adultoActual.socio_id);
  if (count >= 2) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Esta familia ya tiene 2 adultos registrados' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const email = String(payload.email || '').trim().toLowerCase();
  const nombre = String(payload.nombre || '').trim();
  const apellidos = String(payload.apellidos || '').trim();
  const movil = String(payload.movil || '').trim();

  if (!email || !nombre || !apellidos || !movil) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan nombre, apellidos, email o móvil' }) };
  }

  if (email === String(userData.user.email || '').trim().toLowerCase()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'El segundo adulto debe tener un email distinto al tuyo' }) };
  }

  const { data: yaExiste } = await supabaseAdmin.from('adultos').select('id').ilike('email', email).limit(1);
  if (yaExiste && yaExiste.length) {
    return { statusCode: 409, body: JSON.stringify({ error: 'Ese email ya pertenece a otra cuenta del portal.' }) };
  }

  const password = generarPassword();

  try {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (createError) throw createError;

    const t = (v) => String(v || '').trim();
    const { error: insertError } = await supabaseAdmin.from('adultos').insert({
      id: created.user.id,
      socio_id: adultoActual.socio_id,
      nombre, apellidos, email, movil,
      dni_nie: t(payload.dni_nie) || 'PENDIENTE',
      es_pasaporte: !!payload.es_pasaporte,
      direccion: t(payload.direccion) || 'PENDIENTE',
      ciudad: t(payload.ciudad) || 'PENDIENTE',
      provincia: t(payload.provincia) || 'PENDIENTE',
      codigo_postal: t(payload.codigo_postal) || '00000',
      telefono_fijo: t(payload.telefono_fijo) || null,
      relacion_alumnos: t(payload.relacion_alumnos) || null,
      role: 'socio',
      force_password_change: true
    });
    if (insertError) {
      // Sin esto, el usuario de auth quedaba huérfano (existiendo, pero sin
      // ficha de adulto) y ese email ya no se podía volver a usar.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw insertError;
    }

    // El adulto ya está creado: si el correo falla, no devolvemos error
    // (antes se mostraba "no se pudo invitar" y al reintentar decía que el
    // email ya existía).
    let emailEnviado = true;
    try {
      const { subject, text } = plantillaCredenciales({ nombre, email, password });
      await enviarEmail({ to: email, subject, text });
    } catch (e) { emailEnviado = false; }

    return { statusCode: 200, body: JSON.stringify({ ok: true, emailEnviado }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error desconocido' }) };
  }
};
