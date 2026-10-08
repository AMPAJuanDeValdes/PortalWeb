// Solicitud de reactivación de una cuenta dada de baja o inactiva
// (impago). No requiere sesión: una cuenta de baja no puede iniciar
// sesión. Por eso se pide el email Y el DNI/NIE del adulto como
// comprobación mínima de que quien lo pide conoce los datos de la cuenta.
//
// El comprobante de pago ya viene subido por el navegador al bucket
// "comprobantes" (carpeta publico/, igual que hace publico.html con los
// comprobantes de invitados); aquí solo se valida la cuenta y se registra
// el comprobante. La cuenta NO se reactiva sola: queda en el panel del
// admin (admin-socios.html, pestaña Solicitudes) para que la revise
// y pulse "Activar", momento en el que se envía el email de bienvenida.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const normalizar = (s) => String(s || '').toUpperCase().replace(/[\s.\-]/g, '');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return json(400, { error: 'JSON no válido' }); }

  const email = String(payload.email || '').trim();
  const dni = normalizar(payload.dni);
  const archivoPath = String(payload.archivo_path || '').trim();

  if (!email || !dni || !archivoPath) {
    return json(400, { error: 'Faltan el email, el DNI/NIE o el comprobante.' });
  }
  if (!archivoPath.startsWith('publico/')) {
    return json(400, { error: 'Ruta de comprobante no válida.' });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await supabaseAdmin
    .from('adultos')
    .select('dni_nie, socio_id, socios(estado)')
    .ilike('email', email)
    .limit(1);

  const adulto = data && data[0];
  // Mismo mensaje si el email no existe o el DNI no coincide
  const NO_ENCONTRADA = 'No hemos encontrado ninguna cuenta con esos datos. Revisa el email y el DNI/NIE.';
  if (!adulto || normalizar(adulto.dni_nie) !== dni) return json(404, { error: NO_ENCONTRADA });

  const estado = adulto.socios ? adulto.socios.estado : null;
  if (estado === 'activa') return json(409, { error: 'Tu cuenta ya está activa. Puedes iniciar sesión directamente.' });
  if (estado === 'recien_creada') return json(409, { error: 'Tu solicitud de alta ya está en revisión. En cuanto se apruebe, recibirás un correo.' });
  if (estado !== 'baja' && estado !== 'falta_pago') return json(404, { error: NO_ENCONTRADA });

  const { error } = await supabaseAdmin.from('comprobantes_pago').insert({
    tipo: 'cuota_socio', socio_id: adulto.socio_id, archivo_url: archivoPath
  });
  if (error) return json(500, { error: error.message });

  // Marca la cuenta como "pide reactivar" para que aparezca en la
  // pestaña de Solicitudes de admin-socios.html
  await supabaseAdmin.from('socios').update({ reactivacion_solicitada_en: new Date().toISOString() }).eq('id', adulto.socio_id);

  return json(200, { ok: true });
};
