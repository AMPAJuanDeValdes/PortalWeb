// «Quiero comprar Lotería» (loteria.html): un mensaje para la Junta
// mientras la campaña de lotería está abierta. No requiere sesión.
//  · Con la sesión de un socio, los datos salen de su ficha (no se
//    pueden cambiar desde aquí).
//  · Sin sesión, nombre, apellidos, email y móvil son obligatorios.
// Se guarda en loteria_mensajes y se avisa por email a la Junta.
//   POST { mensaje, nombre, apellidos, email, movil, web }  (web: campo trampa)

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaLoteria } = require('./_lib/email');

const resp = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });
const corto = (v, n) => String(v ?? '').trim().slice(0, n);
const movilValido = (v) => /^\d{9}$/.test(String(v || '').replace(/[\s.\-()]/g, '').replace(/^(\+34|0034)/, ''));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  let p;
  try { p = JSON.parse(event.body); } catch { return resp(400, { error: 'JSON no válido' }); }
  if (p.web) return resp(200, { ok: true });   // lo ha rellenado un robot

  const mensaje = corto(p.mensaje, 2000);
  if (mensaje.length < 3) return resp(400, { error: 'Escribe tu mensaje.' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: abiertas } = await admin.rpc('loteria_publica');
  const campana = abiertas && abiertas[0];
  if (!campana) return resp(400, { error: 'Ahora mismo no hay lotería a la venta.' });

  // ¿Socio con la sesión iniciada? Entonces, sus datos
  let socioId = null, d = null;
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const { data: u } = await admin.auth.getUser(token);
      if (u && u.user) {
        const { data: ad } = await admin.from('adultos').select('socio_id, nombre, apellidos, email, movil, telefono_fijo').eq('id', u.user.id).maybeSingle();
        if (ad) { socioId = ad.socio_id; d = { nombre: ad.nombre, apellidos: ad.apellidos || '', email: ad.email, movil: ad.movil || ad.telefono_fijo || '' }; }
      }
    } catch (e) { /* sin sesión válida: se piden los datos */ }
  }
  if (!d) {
    d = { nombre: corto(p.nombre, 80), apellidos: corto(p.apellidos, 120), email: corto(p.email, 200).toLowerCase(), movil: corto(p.movil, 30) };
    if (!d.nombre || !d.apellidos) return resp(400, { error: 'Escribe tu nombre y tus apellidos.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return resp(400, { error: 'Escribe un email válido.' });
    if (!movilValido(d.movil)) return resp(400, { error: 'Escribe un móvil válido (9 cifras).' });
    // Como mucho 5 mensajes al día desde el mismo email
    const desde = new Date(Date.now() - 864e5).toISOString();
    const { count } = await admin.from('loteria_mensajes').select('id', { count: 'exact', head: true }).eq('email', d.email).gte('created_at', desde);
    if ((count || 0) >= 5) return resp(429, { error: 'Ya nos has escrito varias veces hoy. Te contestaremos pronto.' });
  }

  const { error } = await admin.from('loteria_mensajes').insert({ campana_id: campana.id, socio_id: socioId, ...d, mensaje });
  if (error) return resp(500, { error: 'No se pudo enviar. Inténtalo de nuevo en unos minutos.' });

  try {
    const url = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') + '/admin-loteria.html#mensajes' : '';
    const { subject, text } = plantillaLoteria({ campana: campana.nombre, ...d, mensaje, esSocio: !!socioId, urlAdmin: url });
    await enviarEmail({ to: process.env.SMTP_USER, replyTo: d.email, subject, text });
  } catch (e) { /* ya está guardado: la Junta lo ve en el panel */ }

  return resp(200, { ok: true, email: d.email });
};
