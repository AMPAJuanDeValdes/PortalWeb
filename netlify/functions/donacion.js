// Anunciar una donación (donar.html). No requiere sesión: puede donar
// cualquiera, sea socio o no. Solo se admite lo que el AMPA recoge
// (catálogo del Banco de Libros, prendas del Banco de Uniformes en
// cualquier talla, carillones y flautas, kimonos y ropa de fútbol) y,
// aparte, «otra cosa» que la Junta revisa y puede rechazar.
// Si llega con la sesión de un socio, se anota su familia.

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaDonacion } = require('./_lib/email');
const D = require('./_lib/donaciones');

const resp = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });
const corto = (v, n) => String(v ?? '').trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  let p;
  try { p = JSON.parse(event.body); } catch { return resp(400, { error: 'JSON no válido' }); }

  const nombre = corto(p.nombre, 120);
  const email = corto(p.email, 200).toLowerCase();
  const telefono = corto(p.telefono, 30);
  const otros = corto(p.otros, 2000);
  const entrada = Array.isArray(p.items) ? p.items.slice(0, 60) : [];

  if (!nombre) return resp(400, { error: 'Escribe tu nombre.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resp(400, { error: 'Escribe un email válido.' });
  if (p.aceptaDonacion !== true) return resp(400, { error: 'Marca la casilla para confirmar que es una donación.' });
  if (!entrada.length && !otros) return resp(400, { error: 'Añade al menos una cosa a la donación.' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Catálogos actuales para comprobar que lo donado es lo que se recoge
  const [{ data: libros }, { data: prendas }] = await Promise.all([
    admin.from('libros_catalogo').select('id, titulo, etapa, curso'),
    admin.from('prendas_catalogo').select('tipo')
  ]);
  const librosPorId = new Map((libros || []).map(l => [l.id, l]));
  const tiposUniforme = new Set((prendas || []).map(x => x.tipo));

  const items = [];
  for (const i of entrada) {
    const cantidad = Math.trunc(Number(i && i.cantidad));
    if (!(cantidad >= 1 && cantidad <= D.maxCantidad)) return resp(400, { error: 'Cantidad no válida.' });
    let it = null;
    if (i.categoria === 'libros') {
      const l = librosPorId.get(i.libro_id);
      if (!l) return resp(400, { error: 'Uno de los libros ya no está en el catálogo del Banco de Libros. Recarga la página.' });
      it = { categoria: 'libros', libro_id: l.id, titulo: l.titulo, curso: `${l.curso} de ${l.etapa}` };
    } else if (i.categoria === 'uniformes') {
      const tallas = i.tipo === 'Baby' ? D.tallasBaby : D.tallas;
      if (!tiposUniforme.has(i.tipo) || !tallas.includes(String(i.talla))) return resp(400, { error: 'Esa prenda o talla no se recoge en el Banco de Uniformes.' });
      it = { categoria: 'uniformes', tipo: i.tipo, talla: String(i.talla) };
    } else if (i.categoria === 'instrumentos') {
      if (!D.instrumentos.includes(i.articulo)) return resp(400, { error: 'Solo se recogen carillones y flautas.' });
      it = { categoria: 'instrumentos', articulo: i.articulo };
    } else if (i.categoria === 'extraescolares') {
      if (!D.extraescolares.includes(i.articulo)) return resp(400, { error: 'Esa ropa de extraescolares no se recoge.' });
      it = { categoria: 'extraescolares', articulo: i.articulo, talla: corto(i.talla, 20) || null };
    } else {
      return resp(400, { error: 'Hay algo en la donación que no se recoge. Ponlo en «Otra cosa».' });
    }
    it.cantidad = cantidad;
    items.push(it);
  }

  // ¿Viene de una familia socia con la sesión iniciada?
  let socioId = null;
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const { data: u } = await admin.auth.getUser(token);
      if (u && u.user) {
        const { data: ad } = await admin.from('adultos').select('socio_id').eq('id', u.user.id).maybeSingle();
        socioId = ad ? ad.socio_id : null;
      }
    } catch (e) { /* sin sesión válida: se guarda igual, sin familia */ }
  }

  const { error } = await admin.from('donaciones').insert({ items, otros: otros || null, nombre, email, telefono: telefono || null, socio_id: socioId });
  if (error) return resp(500, { error: 'No se pudo guardar. Inténtalo de nuevo en unos minutos.' });

  try {
    const url = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') + '/admin-donaciones.html' : '';
    const { subject, text } = plantillaDonacion({
      items: items.map(i => ({ texto: D.texto(i), cantidad: i.cantidad })),
      otros, nombre, email, telefono, esSocio: !!socioId, urlAdmin: url
    });
    await enviarEmail({ to: process.env.SMTP_USER, replyTo: email, subject, text });
  } catch (e) { /* ya está guardada: la Junta la ve en el panel */ }

  return resp(200, { ok: true });
};
