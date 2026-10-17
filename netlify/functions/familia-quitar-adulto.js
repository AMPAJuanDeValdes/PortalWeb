// Una familia quita a su segundo adulto (o él mismo se quita) desde Mis datos.
// Se borra su usuario de acceso (y con él su ficha y sus inscripciones).
// El adulto principal no se puede quitar: tiene que existir siempre.
//   POST { adultoId }  (con la sesión de un adulto de la misma familia)

const { createClient } = require('@supabase/supabase-js');
const { esAdultoPrincipal } = require('./_lib/familia');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return json(401, { error: 'Falta token de sesión' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const adultoId = String(p.adultoId || '');

  const { data: yo } = await sb.from('adultos').select('id, socio_id').eq('id', u.user.id).single();
  const { data: otro } = await sb.from('adultos').select('id, socio_id, role, nombre').eq('id', adultoId).single();
  if (!yo || !otro || otro.socio_id !== yo.socio_id) return json(403, { error: 'Ese adulto no es de tu familia.' });
  if (await esAdultoPrincipal(sb, otro)) {
    return json(400, { error: 'El adulto principal no se puede quitar: la cuenta del socio siempre tiene que tenerlo. Si queréis dejar el AMPA, dad de baja la cuenta.' });
  }
  if (otro.role === 'admin' && otro.id !== yo.id) {
    return json(400, { error: 'Es una cuenta de la Junta: pedídselo a la Junta.' });
  }

  const { error } = await sb.auth.admin.deleteUser(otro.id);
  if (error) return json(500, { error: 'No se pudo quitar: ' + error.message });
  return json(200, { ok: true, eraYo: otro.id === yo.id });
};
