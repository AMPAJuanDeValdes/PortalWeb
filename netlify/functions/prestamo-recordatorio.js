// Envía por email el recordatorio de devolución de libros del préstamo.
// Solo admins. Body: { socioIds: [..] } para unas familias concretas, o
// { socioIds: null } para TODAS las que tienen libros entregados y sin
// devolver. A cada familia le llega la lista de sus libros (título,
// ejemplar y alumno/a), a todos los adultos de la cuenta.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaRecordatorioDevolucion } = require('./_lib/email');

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return json(401, { error: 'Falta token de sesión' });
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userError || !userData?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await supabaseAdmin.from('adultos').select('role').eq('id', userData.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo un admin puede hacer esto' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const filtro = Array.isArray(payload.socioIds) ? payload.socioIds.map(String) : null;

  let q = supabaseAdmin.from('prestamo_items')
    .select('socio_id, alumnos(nombre, apellidos), libros_catalogo(titulo), libros_ejemplares(codigo)')
    .eq('tipo', 'solicitud').eq('estado', 'asignado')
    .not('entregado_en', 'is', null).is('fecha_devolucion', null);
  if (filtro) q = q.in('socio_id', filtro);
  const { data: items, error } = await q;
  if (error) return json(500, { error: error.message });

  const porSocio = {};
  for (const it of items || []) {
    (porSocio[it.socio_id] = porSocio[it.socio_id] || []).push({
      titulo: it.libros_catalogo?.titulo || '', codigo: it.libros_ejemplares?.codigo || '',
      alumno: [it.alumnos?.nombre, it.alumnos?.apellidos].filter(Boolean).join(' ')
    });
  }
  const socioIds = Object.keys(porSocio);
  if (!socioIds.length) return json(200, { ok: true, enviados: 0, fallidos: 0 });

  const { data: adultos } = await supabaseAdmin.from('adultos').select('socio_id, nombre, email').in('socio_id', socioIds).order('created_at');
  let enviados = 0, fallidos = 0;
  for (const sid of socioIds) {
    const ad = (adultos || []).filter(a => a.socio_id === sid);
    const emails = ad.map(a => a.email).filter(Boolean);
    if (!emails.length) { fallidos++; continue; }
    const { subject, text } = plantillaRecordatorioDevolucion({ nombre: ad[0].nombre, libros: porSocio[sid] });
    try { await enviarEmail({ to: emails.join(', '), subject, text }); enviados++; }
    catch (e) { fallidos++; }
  }
  return json(200, { ok: true, enviados, fallidos });
};
