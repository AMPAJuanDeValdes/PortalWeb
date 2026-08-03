// Alta de socios: crea la cuenta (socios), 1 o 2 adultos (con login propio
// y contraseña provisional enviada por email) y sus alumnos.
// Solo puede ejecutarla un adulto con role = 'admin'.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaCredenciales } = require('./_lib/email');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ETAPAS_VALIDAS = ['Infantil', 'Primaria', 'ESO', 'Bachillerato'];
const AULAS_VALIDAS = ['A', 'B', 'C', 'D'];
const FORMAS_PAGO_VALIDAS = ['Transferencia', 'Domiciliación Bancaria'];

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function esVerdadero(v) { return ['si', 'sí', 'true', '1', 'x', 'yes'].includes(String(v || '').trim().toLowerCase()); }

function normalizarAdulto(fila, prefijo) {
  const g = (campo) => fila[`${prefijo}_${campo}`];
  const nombre = String(g('nombre') || '').trim();
  if (!nombre) return null;
  return {
    nombre,
    apellidos: String(g('apellidos') || '').trim(),
    es_pasaporte: esVerdadero(g('es_pasaporte')),
    dni_nie: String(g('dni_nie') || '').trim(),
    sexo: ['Masculino', 'Femenino', 'Otro'].includes(String(g('sexo') || '').trim()) ? String(g('sexo')).trim() : null,
    email: String(g('email') || '').trim().toLowerCase(),
    direccion: String(g('direccion') || '').trim(),
    ciudad: String(g('ciudad') || '').trim(),
    provincia: String(g('provincia') || '').trim(),
    codigo_postal: String(g('codigo_postal') || '').trim(),
    telefono_fijo: String(g('telefono_fijo') || '').trim() || null,
    movil: String(g('movil') || '').trim() || null,
    relacion_alumnos: String(g('relacion_alumnos') || '').trim() || null
  };
}

function normalizarAlumno(fila, prefijo) {
  const g = (campo) => fila[`${prefijo}_${campo}`];
  const nombre = String(g('nombre') || '').trim();
  if (!nombre) return null;
  return {
    nombre,
    apellidos: String(g('apellidos') || '').trim(),
    fecha_nacimiento: String(g('fecha_nacimiento') || '').trim() || null,
    sexo: ['Masculino', 'Femenino', 'Otro'].includes(String(g('sexo') || '').trim()) ? String(g('sexo')).trim() : null,
    etapa: ETAPAS_VALIDAS.includes(String(g('etapa') || '').trim()) ? String(g('etapa')).trim() : null,
    curso: String(g('curso') || '').trim() || null,
    aula: AULAS_VALIDAS.includes(String(g('aula') || '').trim().toUpperCase()) ? String(g('aula')).trim().toUpperCase() : null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) };
  const accessToken = authHeader.replace('Bearer ', '');
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) };

  const { data: adminAdulto } = await supabaseAdmin.from('adultos').select('role').eq('id', userData.user.id).single();
  if (adminAdulto?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Solo un administrador puede dar de alta socios' }) };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }
  const filas = Array.isArray(payload.socios) ? payload.socios : [];
  if (filas.length === 0) return { statusCode: 400, body: JSON.stringify({ error: 'No se han recibido filas' }) };

  const resultados = [];

  for (const fila of filas) {
    const anio_ultima_cuota = parseInt(String(fila.anio_ultima_cuota || '').trim(), 10);
    const numeroDado = String(fila.numero_secuencial || '').trim();
    const forma_pago = FORMAS_PAGO_VALIDAS.includes(String(fila.forma_pago || '').trim()) ? String(fila.forma_pago).trim() : null;
    const iban = String(fila.iban || '').trim() || null;

    const adulto1 = normalizarAdulto(fila, 'adulto1');
    const adulto2 = normalizarAdulto(fila, 'adulto2');
    const alumnosFila = [];
    for (let i = 1; i <= 6; i++) {
      const al = normalizarAlumno(fila, `alumno${i}`);
      if (al) alumnosFila.push(al);
    }

    if (!Number.isFinite(anio_ultima_cuota) || !adulto1 || !adulto1.email || !adulto1.dni_nie) {
      resultados.push({ ok: false, error: 'Faltan anio_ultima_cuota o los datos obligatorios del adulto 1', nombre_titular: adulto1?.nombre || '' });
      continue;
    }
    if (adulto2 && adulto2.email && adulto2.email === adulto1.email) {
      resultados.push({ ok: false, error: 'El adulto 2 no puede tener el mismo email que el adulto 1', nombre_titular: adulto1.nombre });
      continue;
    }

    try {
      const numero_secuencial = numeroDado || (await supabaseAdmin.rpc('siguiente_numero_secuencial')).data;

      const { data: socio, error: socioError } = await supabaseAdmin.from('socios').insert({
        anio_ultima_cuota, numero_secuencial, forma_pago, iban, estado: 'activa'
      }).select('id').single();
      if (socioError) throw socioError;

      const credencialesEnviadas = [];
      for (const adulto of [adulto1, adulto2].filter(Boolean)) {
        const password = generarPassword();
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: adulto.email, password, email_confirm: true
        });
        if (createError) throw createError;

        const { error: insAdultoError } = await supabaseAdmin.from('adultos').insert({
          id: created.user.id, socio_id: socio.id, role: 'socio', force_password_change: true, ...adulto
        });
        if (insAdultoError) throw insAdultoError;

        const { subject, text } = plantillaCredenciales({ nombre: adulto.nombre, email: adulto.email, password });
        try { await enviarEmail({ to: adulto.email, subject, text }); } catch (e) { /* seguimos aunque falle el envío */ }
        credencialesEnviadas.push(adulto.email);
      }

      for (const alumno of alumnosFila) {
        if (!alumno.etapa || !alumno.curso) continue;
        await supabaseAdmin.from('alumnos').insert({ socio_id: socio.id, ...alumno });
      }

      resultados.push({
        ok: true,
        nombre_titular: adulto1.nombre + ' ' + adulto1.apellidos,
        numero_secuencial,
        emails: credencialesEnviadas.join(', '),
        alumnos_creados: alumnosFila.filter(a => a.etapa && a.curso).length
      });
    } catch (err) {
      resultados.push({ ok: false, error: err.message || 'Error desconocido', nombre_titular: adulto1.nombre + ' ' + adulto1.apellidos });
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultados }) };
};
