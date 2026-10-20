// La Junta avisa en el móvil de una convocatoria del Banco de Uniformes o
// del Banco de Libros (familias socias activas con algún alumno/a; en el
// Banco de Libros, con algún alumno/a de un curso que tiene libros).
//   POST { tipo: 'uniformes' | 'libros', convocatoriaId, soloContar }  (con la sesión de un admin)

const { createClient } = require('@supabase/supabase-js');
const { familiasActivas, avisarFamilias, comoJunta, todas, registrarDifusion } = require('./_lib/avisos');
const { BANCOS, fechaHoraTexto } = require('./_lib/bancos');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const listaNombres = (n) => n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0] || '';

function mensajeDe(tipo, conv, nombres) {
  const b = BANCOS[tipo];
  const plazo = `Podéis pedir hasta el ${fechaHoraTexto(conv.fecha_cierre)}.`;
  const quien = nombres.length ? ` ${tipo === 'libros' ? 'Libros para' : 'Para'} ${listaNombres(nombres)}.` : '';
  return { title: b.tituloAviso, body: plazo + quien, url: '/' + b.pagina, tag: 'convocatoria-' + tipo + '-' + conv.id };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const { sb, error, adultoId } = await comoJunta(event, createClient);
  if (error) return error;
  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON no válido' }); }
  const b = BANCOS[p.tipo];
  if (!b) return json(400, { error: 'Tipo de convocatoria no válido.' });
  const { data: conv } = await sb.from(b.tabla).select('*').eq('id', String(p.convocatoriaId || '')).single();
  if (!conv) return json(404, { error: 'La convocatoria no existe.' });
  if (conv.estado !== 'abierta' || new Date(conv.fecha_cierre) <= new Date()) {
    return json(400, { error: 'La convocatoria no está abierta: solo se avisa mientras las familias pueden pedir.' });
  }
  try {
    const { alumnos } = await familiasActivas(sb);
    let elegibles = alumnos;
    if (p.tipo === 'libros') {
      // Solo alumnos/as de cursos con libros en el catálogo
      const libros = await todas(() => sb.from('libros_catalogo').select('etapa, curso, cursos'));
      const cursos = new Set(libros.flatMap(l => (l.cursos && l.cursos.length) ? l.cursos : [l.etapa + '|' + l.curso]));
      elegibles = alumnos.filter(a => cursos.has(a.etapa + '|' + a.curso));
    }
    const nombres = new Map();
    elegibles.forEach(a => { if (!nombres.has(a.socio_id)) nombres.set(a.socio_id, []); nombres.get(a.socio_id).push(a.nombre); });
    const familias = new Map([...nombres].map(([id, n]) => [id, mensajeDe(p.tipo, conv, n)]));
    const r = await avisarFamilias(sb, familias, { soloContar: !!p.soloContar });
    if (!p.soloContar) {
      await sb.from(b.tabla).update({ aviso_push_en: new Date().toISOString(), aviso_push_familias: r.familiasConAviso }).eq('id', conv.id);
      await registrarDifusion(sb, { tipo: p.tipo, refId: conv.id, canal: 'aviso', familias: r.familiasConAviso, adultoId });
    }
    return json(200, r);
  } catch (e) {
    return json(e.status || 500, { error: e.message || 'No se pudo avisar.' });
  }
};

module.exports.mensajeDe = mensajeDe;
