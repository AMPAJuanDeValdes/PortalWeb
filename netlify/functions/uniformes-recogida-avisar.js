// Banco de Uniformes (Panel → Banco de Uniformes), con los resultados ya
// publicados: manda a cada familia que pidió uniformes un email con cuándo y
// dónde recogerlos y qué ha recibido cada alumno/a. A las que no han recibido
// nada, si se marca, un email diciéndoselo.
//   POST { convocatoriaId, dia: 'YYYY-MM-DD', desde: 'HH:MM', hasta: 'HH:MM', lugar, nota, incluirSinPrenda,
//          envioId: uuid, inicio: 0 }
//   → { ok, total, siguiente (null al terminar), enviados, sinPrenda, fallos: [emails] }
//   Se envía por tandas (cada llamada a Netlify tiene 10 s): la pantalla llama
//   con inicio = 0, TANDA, 2·TANDA… hasta que «siguiente» es null. Cada familia
//   enviada queda en uniformes_recogida_enviados (envioId): repetir una tanda
//   no la vuelve a enviar.
//   Con { vista: true }: no envía nada; devuelve cada email tal como saldrá
//   → { ok, vista: [{ familia, a, asunto, html, sinPrenda }] }

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, conFirma, plantillaUniformesRecogida } = require('./_lib/email');
const { registrarDifusion } = require('./_lib/avisos');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const ZONA = { timeZone: 'Europe/Madrid' };
const TANDA = 2;   // familias por llamada (cada email, con su copia en Enviados, tarda 2–4 s y Netlify corta a los 10 s)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Falta token de sesión' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: u, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !u?.user) return json(401, { error: 'Sesión no válida' });
  const { data: quien } = await sb.from('adultos').select('role').eq('id', u.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo la Junta puede hacer esto.' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const dia = String(p.dia || ''), desde = String(p.desde || ''), hasta = String(p.hasta || '');
  const lugar = String(p.lugar || '').trim().slice(0, 200), nota = String(p.nota || '').trim().slice(0, 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return json(400, { error: 'Pon el día de recogida.' });
  if (!/^\d{2}:\d{2}$/.test(desde) || (hasta && !/^\d{2}:\d{2}$/.test(hasta))) return json(400, { error: 'Pon la hora de recogida.' });
  if (hasta && hasta <= desde) return json(400, { error: 'La hora de fin tiene que ser después de la de inicio.' });

  const { data: conv } = await sb.from('uniformes_convocatorias').select('id, estado').eq('id', String(p.convocatoriaId || '')).maybeSingle();
  if (!conv) return json(404, { error: 'La convocatoria no existe.' });
  if (conv.estado !== 'finalizada') return json(400, { error: 'Primero publica los resultados del reparto.' });

  const { data: pedidos, error } = await sb.from('uniformes_pedidos')
    .select('socio_id, alumno_id, estado, alumnos(nombre), prendas_catalogo(tipo, talla)').eq('convocatoria_id', conv.id);
  if (error) return json(500, { error: error.message });
  const socios = [...new Set((pedidos || []).map(x => x.socio_id))].sort();   // orden fijo: las tandas no cambian
  if (!socios.length) return json(400, { error: 'Nadie pidió uniformes en esta convocatoria.' });
  const { data: adultos } = await sb.from('adultos').select('socio_id, nombre, email, created_at').in('socio_id', socios).order('created_at');

  const diaTxt = new Date(dia + 'T12:00:00Z').toLocaleDateString('es-ES', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  const cuando = `${diaTxt}, ${hasta ? `de ${desde} a ${hasta}` : `a partir de las ${desde}`}`;
  // Primero se preparan todos los emails (los mismos para la vista previa y para el envío)
  const mensajes = [];
  for (const sid of socios) {
    const suyos = (pedidos || []).filter(x => x.socio_id === sid && x.estado === 'asignado');
    if (!suyos.length && !p.incluirSinPrenda) continue;
    const ads = (adultos || []).filter(a => a.socio_id === sid && a.email);
    if (!ads.length) continue;
    const prendas = suyos.map(x => `${x.alumnos?.nombre || 'Alumno/a'}: ${x.prendas_catalogo?.tipo || 'prenda'} talla ${x.prendas_catalogo?.talla || ''}`.trim());
    const pl = plantillaUniformesRecogida({ nombre: ads.length === 1 ? ads[0].nombre : '', prendas, cuando, lugar, nota });
    mensajes.push({ socio: sid, familia: ads.map(a => a.nombre).join(' y '), a: ads.map(a => a.email).join(', '), sinPrenda: !suyos.length, ...pl });
  }
  if (!mensajes.length) return json(400, { error: 'No hay ninguna familia a la que enviarlo.' });

  if (p.vista) {
    const web = (process.env.SITE_URL || '').replace(/\/$/, '');
    return json(200, { ok: true, vista: mensajes.map(m => ({
      familia: m.familia, a: m.a, asunto: m.subject, sinPrenda: m.sinPrenda,
      html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`)
    })) });
  }

  const envioId = String(p.envioId || '');
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) return json(400, { error: 'Falta el identificador del envío.' });
  const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);
  const tanda = mensajes.slice(inicio, inicio + TANDA);
  const { data: ya } = await sb.from('uniformes_recogida_enviados').select('socio_id').eq('envio_id', envioId);
  const hechos = new Set((ya || []).map(x => x.socio_id));
  let enviados = 0, sinPrenda = 0; const fallos = [];
  for (const m of tanda) {
    if (hechos.has(m.socio)) { enviados++; if (m.sinPrenda) sinPrenda++; continue; }
    try {
      await enviarEmail({ to: m.a, subject: m.subject, text: m.text });
      await sb.from('uniformes_recogida_enviados').insert({ envio_id: envioId, convocatoria_id: conv.id, socio_id: m.socio });
      enviados++; if (m.sinPrenda) sinPrenda++;
    } catch (e) { fallos.push(m.a); }
  }
  const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
  // Al terminar, al historial (con el total de familias de este envío)
  if (siguiente === null) {
    const { count } = await sb.from('uniformes_recogida_enviados').select('socio_id', { count: 'exact', head: true }).eq('envio_id', envioId);
    if (count) await registrarDifusion(sb, { tipo: 'uniformes', refId: conv.id, canal: 'recogida', familias: count, adultoId: u.user.id });
  }
  return json(200, { ok: true, total: mensajes.length, siguiente, enviados, sinPrenda, fallos });
};

