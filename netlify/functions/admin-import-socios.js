// Netlify Function: alta de socios (cuenta + progenitor principal).
// Solo puede ejecutarla un usuario cuyo perfil tenga role = 'admin'.
// Usa la SERVICE ROLE KEY de Supabase, que solo vive aquí (variables
// de entorno de Netlify), nunca se envía al navegador.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CAMPOS_CUENTA_OBLIGATORIOS = ['anio_ultima_cuota', 'numero_secuencial'];
const CAMPOS_PROGENITOR_OBLIGATORIOS = [
  'nombre', 'apellidos', 'dni_nie', 'email', 'direccion', 'ciudad', 'provincia', 'codigo_postal'
];
const FORMAS_PAGO_VALIDAS = ['Metálico', 'Transferencia', 'Domiciliación Bancaria'];

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function esVerdadero(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return ['si', 'sí', 'true', '1', 'x', 'yes'].includes(v);
}

function normalizarFilaCuenta(fila) {
  const numero_secuencial = String(fila.numero_secuencial || '').trim().padStart(4, '0');
  const anio_ultima_cuota = parseInt(String(fila.anio_ultima_cuota || '').trim(), 10);
  const forma_pago = String(fila.forma_pago || '').trim();
  return {
    anio_ultima_cuota: Number.isFinite(anio_ultima_cuota) ? anio_ultima_cuota : null,
    codigo_asociacion: '0300',
    numero_secuencial,
    forma_pago: FORMAS_PAGO_VALIDAS.includes(forma_pago) ? forma_pago : null,
    iban: String(fila.iban || '').trim() || null
  };
}

function normalizarProgenitor(fila) {
  return {
    tipo: 'principal',
    nombre: String(fila.nombre || '').trim(),
    apellidos: String(fila.apellidos || '').trim(),
    es_pasaporte: esVerdadero(fila.es_pasaporte),
    dni_nie: String(fila.dni_nie || '').trim(),
    sexo: ['Masculino', 'Femenino', 'Otro'].includes(String(fila.sexo || '').trim())
      ? String(fila.sexo).trim() : null,
    email: String(fila.email || '').trim().toLowerCase(),
    direccion: String(fila.direccion || '').trim(),
    ciudad: String(fila.ciudad || '').trim(),
    provincia: String(fila.provincia || '').trim(),
    codigo_postal: String(fila.codigo_postal || '').trim(),
    telefono_fijo: String(fila.telefono_fijo || '').trim() || null,
    movil: String(fila.movil || '').trim() || null
  };
}

function validarFila(cuenta, progenitor) {
  if (!cuenta.anio_ultima_cuota) return 'anio_ultima_cuota no es válido';
  if (!/^[0-9]{4}$/.test(cuenta.numero_secuencial)) return 'numero_secuencial debe tener 4 cifras';
  for (const campo of CAMPOS_PROGENITOR_OBLIGATORIOS) {
    if (!progenitor[campo]) return `Falta el campo obligatorio: ${campo}`;
  }
  return null;
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

  const { data: adminProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profileError || adminProfile?.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo un administrador puede dar de alta socios' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON de entrada no válido' }) };
  }

  const socios = Array.isArray(payload.socios) ? payload.socios : [];
  if (socios.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No se han recibido filas de socios' }) };
  }

  const resultados = [];

  for (const filaOriginal of socios) {
    const cuenta = normalizarFilaCuenta(filaOriginal);
    const progenitor = normalizarProgenitor(filaOriginal);

    const errorValidacion = validarFila(cuenta, progenitor);
    if (errorValidacion) {
      resultados.push({
        numero_secuencial: cuenta.numero_secuencial,
        nombre_titular: `${progenitor.nombre} ${progenitor.apellidos}`.trim(),
        email: progenitor.email,
        ok: false,
        error: errorValidacion
      });
      continue;
    }

    const password = generarPassword();

    try {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: progenitor.email,
        password,
        email_confirm: true
      });
      if (createError) throw createError;

      const { error: insertProfileError } = await supabaseAdmin.from('profiles').insert({
        id: created.user.id,
        ...cuenta,
        email: progenitor.email,
        role: 'socio',
        force_password_change: true
      });
      if (insertProfileError) throw insertProfileError;

      const { error: insertProgenitorError } = await supabaseAdmin.from('progenitores').insert({
        profile_id: created.user.id,
        ...progenitor
      });
      if (insertProgenitorError) throw insertProgenitorError;

      resultados.push({
        numero_secuencial: cuenta.numero_secuencial,
        nombre_titular: `${progenitor.nombre} ${progenitor.apellidos}`,
        email: progenitor.email,
        password,
        ok: true
      });
    } catch (err) {
      resultados.push({
        numero_secuencial: cuenta.numero_secuencial,
        nombre_titular: `${progenitor.nombre} ${progenitor.apellidos}`.trim(),
        email: progenitor.email,
        ok: false,
        error: err.message || 'Error desconocido'
      });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resultados })
  };
};
