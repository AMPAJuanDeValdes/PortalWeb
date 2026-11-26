// Panel → Eventos → «Resultado del sorteo» (eventos con sorteo, menos la Cabalgata).
//   POST { eventoId, accion: 'ver' }                       → { ok, filas: [{ id, nombre, estado, suplente_orden }] }   (Junta)
//   (vista y enviar aceptan textoPlaza: texto que se añade solo a las familias con alguien con plaza)
//   POST { eventoId, accion: 'vista' }                     → { ok, vista: [{ familia, a, asunto, html, resumen }] }   (Junta; no envía nada)
//   POST { eventoId, accion: 'enviar', envioId, inicio }   → email con el resultado a todos los inscritos, por tandas (Junta)
//        → { ok, total, siguiente, enviados, fallos }
// Solo la cuenta principal (superadmin):
//   POST { eventoId, accion: 'suplentes' }                 → saca al azar los suplentes que faltan (hasta «Suplentes» del evento)
//   POST { eventoId, accion: 'resortear' }                 → quita a todos los suplentes y los vuelve a sacar desde cero
//   POST { eventoId, accion: 'cambiar', id, a: 'plaza' | 'suplente' | 'sin' }
//   POST { eventoId, accion: 'mover', id, dir: -1 | 1 }    → sube o baja un suplente
//   POST { eventoId, accion: 'deshacer' }                  → deshace el sorteo: todos vuelven a «pendiente»
// Al cambiar un resultado, si queda una plaza libre entra el primer suplente (con email).

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, conFirma } = require('./_lib/email');
const { esSuperadmin, SOLO_SUPERADMIN } = require('./_lib/superadmin');
const { cargar, nombre, suplentesDe, renumerar, sacarSuplentes, promover, mensajesResultado } = require('./_lib/sorteo');

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });
const TANDA = 2;

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
  const eventoId = String(p.eventoId || '');
  const accion = String(p.accion || '');
  try {
    const { ev, filas } = await cargar(sb, eventoId);
    if (ev.metodo_asignacion !== 'sorteo') return json(400, { error: 'Este evento no es por sorteo.' });
    const soloSuper = ['suplentes', 'resortear', 'cambiar', 'mover', 'deshacer'].includes(accion);
    if (soloSuper && !(await esSuperadmin(sb, u.user.id))) return json(403, { error: SOLO_SUPERADMIN });
    if (accion !== 'deshacer' && !ev.sorteo_realizado) return json(400, { error: 'Todavía no se ha hecho el sorteo.' });
    if (ev.requiere_pareja_adulto_alumno) {
      return json(400, { error: 'La Cabalgata se gestiona en su propia página.' });
    }

    if (accion === 'ver') {
      return json(200, { ok: true, numSuplentes: ev.num_suplentes || 0, aforo: ev.aforo_total,
        filas: filas.map(f => ({ id: f.id, nombre: nombre(f), estado: f.estado, suplente_orden: f.suplente_orden, promovido: !!f.promovido_en })) });
    }

    if (accion === 'suplentes') {
      const n = await sacarSuplentes(sb, ev.id);
      const entran = await promover(sb, ev.id);
      return json(200, { ok: true, sacados: n, entran: entran.length });
    }

    // Vuelve a sacar a todos los suplentes desde cero (con la prioridad del evento, si la tiene)
    if (accion === 'resortear') {
      const ids = suplentesDe(filas).map(f => f.id);
      if (ids.length) { const { error } = await sb.from('evento_inscripciones').update({ suplente_orden: null }).in('id', ids); if (error) throw error; }
      const n = await sacarSuplentes(sb, ev.id);
      return json(200, { ok: true, sacados: n });
    }

    if (accion === 'cambiar') {
      const f = filas.find(x => x.id === String(p.id || ''));
      if (!f) return json(404, { error: 'Esa inscripción no está en este evento.' });
      const ultimo = Math.max(0, ...suplentesDe(filas).filter(x => x.id !== f.id).map(x => x.suplente_orden));
      const cambio = p.a === 'plaza' ? { estado: 'ganador', suplente_orden: null }
        : p.a === 'suplente' ? { estado: 'no_ganador', suplente_orden: ultimo + 1 }
        : p.a === 'sin' ? { estado: 'no_ganador', suplente_orden: null }
        : null;
      if (!cambio) return json(400, { error: 'Cambio no válido.' });
      const { error } = await sb.from('evento_inscripciones').update(cambio).eq('id', f.id);
      if (error) throw error;
      Object.assign(f, cambio);
      await renumerar(sb, filas);
      const entran = await promover(sb, ev.id);   // si ha quedado una plaza libre, entra el primer suplente
      return json(200, { ok: true, entran: entran.map(nombre) });
    }

    if (accion === 'mover') {
      const sup = suplentesDe(filas);
      const k = sup.findIndex(x => x.id === String(p.id || ''));
      const j = k + (Number(p.dir) < 0 ? -1 : 1);
      if (k < 0 || j < 0 || j >= sup.length) return json(400, { error: 'No se puede mover.' });
      const a = sup[k], b = sup[j];
      // Intercambio en dos pasos (sin repetir número a la vez)
      for (const [x, n] of [[a, -1], [b, a.suplente_orden], [a, b.suplente_orden]]) {
        const { error } = await sb.from('evento_inscripciones').update({ suplente_orden: n }).eq('id', x.id);
        if (error) throw error;
      }
      return json(200, { ok: true });
    }

    if (accion === 'deshacer') {
      if (!ev.sorteo_realizado) return json(400, { error: 'Este evento no está sorteado.' });
      const ids = filas.filter(f => !f.asignada_a_mano).map(f => f.id);
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await sb.from('evento_inscripciones').update({
          estado: 'pendiente', suplente_orden: null, promovido_en: null, asistencia: null, asistencia_en: null, confirmar_hasta: null
        }).in('id', ids.slice(i, i + 100));
        if (error) throw error;
      }
      const { error } = await sb.from('eventos').update({ sorteo_realizado: false }).eq('id', ev.id);
      if (error) throw error;
      return json(200, { ok: true, inscripciones: ids.length });
    }

    // El email con el resultado, a todos los inscritos
    if (accion === 'vista' || accion === 'enviar') {
      let mensajes = await mensajesResultado(sb, ev, filas, String(p.textoPlaza || '').slice(0, 3000));
      if (ev.solo_pruebas) {
        const { data: prueba } = await sb.from('adultos').select('socio_id').ilike('email', '%ampa-prueba-%');
        const { data: reales } = await sb.from('pruebas_familias').select('socio_id');
        const ok = new Set([...(prueba || []), ...(reales || [])].map(a => a.socio_id));
        mensajes = mensajes.filter(m => m.socio && ok.has(m.socio));
      }
      if (!mensajes.length) return json(400, { error: 'No hay inscritos con email.' });
      const web = (process.env.SITE_URL || '').replace(/\/$/, '');
      if (accion === 'vista') {
        return json(200, { ok: true, vista: mensajes.map(m => ({
          familia: m.familia, a: m.a, asunto: m.subject, resumen: m.resumen,
          html: conFirma({ subject: m.subject, text: m.text }).html.replace(/src="cid:[^"]+"/g, `src="${web}/assets/logo-ampa-email.jpg"`)
        })) });
      }
      const envioId = String(p.envioId || '');
      if (!/^[0-9a-f-]{36}$/i.test(envioId)) return json(400, { error: 'Falta el identificador del envío.' });
      const inicio = Math.max(0, parseInt(p.inicio, 10) || 0);
      const { data: ya } = await sb.from('avisos_enviados').select('socio_id').eq('envio_id', envioId);
      const hechos = new Set((ya || []).map(x => x.socio_id));
      let enviados = 0; const fallos = [];
      for (const m of mensajes.slice(inicio, inicio + TANDA)) {
        if (m.socio && hechos.has(m.socio)) { enviados++; continue; }
        try {
          await enviarEmail({ to: m.a, subject: m.subject, text: m.text });
          if (m.socio) await sb.from('avisos_enviados').insert({ envio_id: envioId, ref_id: ev.id, socio_id: m.socio });
          enviados++;
        } catch (e) { fallos.push(m.a); }
      }
      const siguiente = inicio + TANDA < mensajes.length ? inicio + TANDA : null;
      return json(200, { ok: true, total: mensajes.length, siguiente, enviados, fallos });
    }

    return json(400, { error: 'Acción no válida.' });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
