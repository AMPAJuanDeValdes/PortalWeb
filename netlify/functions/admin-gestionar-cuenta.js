// Acciones de administración sobre una cuenta de socio que necesitan
// servidor (envío de emails o borrado de usuarios de acceso):
//
//   activar      -> pasa la cuenta a "activa" (alta nueva o reactivación),
//                   asigna número de socio si todavía no tiene, marca los
//                   comprobantes como verificados y envía email de bienvenida.
//   rechazar     -> pasa la cuenta a "baja" guardando el motivo (obligatorio)
//                   y lo envía por email a la familia.
//   baja         -> pasa la cuenta a "baja" sin enviar email.
//   eliminar     -> borra del todo una cuenta mal creada: la familia, sus
//                   adultos (con su usuario de acceso), alumnos, inscripciones,
//                   peticiones y justificantes. Sin email. No se puede con la
//                   cuenta principal (0000), la propia, una con adultos de la
//                   Junta, libros del Banco de Libros sin devolver o
//                   talonarios de lotería.
//   quitar_adulto-> borra un adulto (su usuario de acceso incluido). No deja
//                   quitar al último adulto de una familia ni a uno mismo.
//   guardar_adulto -> guarda los datos de un adulto. Pasa por aquí (y no
//                   directamente desde el navegador) porque si cambia el
//                   email hay que cambiar también el usuario de acceso, o
//                   esa persona dejaría de poder entrar.
//
// El resto de la edición (número de socio, alumnos, forma de pago...) la
// hace admin-socios.html directamente desde el navegador (políticas RLS).

const { createClient } = require('@supabase/supabase-js');
const { enviarEmail, plantillaBienvenida, plantillaRechazo } = require('./_lib/email');
const { anioCuotaActual } = require('./_lib/cuota');
const { esAdultoPrincipal } = require('./_lib/familia');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return json(401, { error: 'Falta token de sesión' });
  const accessToken = authHeader.replace('Bearer ', '');

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return json(401, { error: 'Sesión no válida' });

  const { data: quien } = await supabaseAdmin.from('adultos').select('role').eq('id', userData.user.id).single();
  if (!quien || quien.role !== 'admin') return json(403, { error: 'Solo un admin puede hacer esto' });

  let payload;
  try { payload = JSON.parse(event.body); } catch { return json(400, { error: 'JSON no válido' }); }
  const accion = String(payload.accion || '');

  /* ---------- quitar un adulto ---------- */
  if (accion === 'quitar_adulto') {
    const adultoId = String(payload.adultoId || '');
    if (!adultoId) return json(400, { error: 'Falta adultoId' });
    if (adultoId === userData.user.id) return json(400, { error: 'No puedes quitarte a ti mismo.' });

    const { data: adulto } = await supabaseAdmin.from('adultos').select('id, socio_id').eq('id', adultoId).single();
    if (!adulto) return json(404, { error: 'Ese adulto no existe.' });
    if (await esAdultoPrincipal(supabaseAdmin, adulto)) {
      return json(400, { error: 'Es el adulto principal: tiene que existir siempre mientras exista la cuenta. Si se cierra la cuenta, dala de baja.' });
    }

    const { count } = await supabaseAdmin.from('adultos').select('id', { count: 'exact', head: true }).eq('socio_id', adulto.socio_id);
    if ((count || 0) <= 1) {
      return json(400, { error: 'Es el único adulto de la familia. Si quieres cerrar la cuenta, dala de baja en vez de quitar al adulto.' });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(adultoId);
    if (error) return json(500, { error: 'No se pudo quitar al adulto: ' + error.message });
    return json(200, { ok: true });
  }

  /* ---------- guardar datos de un adulto ---------- */
  if (accion === 'guardar_adulto') {
    const adultoId = String(payload.adultoId || '');
    const d = payload.datos || {};
    if (!adultoId) return json(400, { error: 'Falta adultoId' });
    const txt = (v) => String(v == null ? '' : v).trim();
    const datos = {
      nombre: txt(d.nombre), apellidos: txt(d.apellidos), email: txt(d.email).toLowerCase(),
      dni_nie: txt(d.dni_nie), es_pasaporte: !!d.es_pasaporte,
      sexo: ['Masculino', 'Femenino', 'Otro'].includes(d.sexo) ? d.sexo : null,
      direccion: txt(d.direccion), ciudad: txt(d.ciudad), provincia: txt(d.provincia),
      codigo_postal: txt(d.codigo_postal), telefono_fijo: txt(d.telefono_fijo) || null,
      movil: txt(d.movil) || null, relacion_alumnos: txt(d.relacion_alumnos) || null,
      // Visita al comedor: la marca la Junta (por ejemplo, quien fue antes de la web)
      ya_visito_comedor: !!d.ya_visito_comedor
    };
    if (!datos.nombre || !datos.apellidos || !datos.email || !datos.dni_nie || !datos.movil ||
        !datos.direccion || !datos.ciudad || !datos.provincia || !datos.codigo_postal) {
      return json(400, { error: 'Faltan datos obligatorios del adulto.' });
    }

    const { data: actual } = await supabaseAdmin.from('adultos').select('id, email').eq('id', adultoId).single();
    if (!actual) return json(404, { error: 'Ese adulto no existe.' });

    if (datos.email !== String(actual.email || '').toLowerCase()) {
      const { data: otro } = await supabaseAdmin.from('adultos').select('id').ilike('email', datos.email).neq('id', adultoId).limit(1);
      if (otro && otro.length) return json(409, { error: 'Ese email ya lo usa otro adulto.' });
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(adultoId, { email: datos.email, email_confirm: true });
      if (authErr) return json(500, { error: 'No se pudo cambiar el email de acceso: ' + authErr.message });
    }

    const { error } = await supabaseAdmin.from('adultos').update(datos).eq('id', adultoId);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  /* ---------- acciones sobre la cuenta (socio) ---------- */
  const socioId = String(payload.socioId || '');
  if (!socioId) return json(400, { error: 'Falta socioId' });

  const { data: socio, error: socioError } = await supabaseAdmin.from('socios').select('*').eq('id', socioId).single();
  if (socioError || !socio) return json(404, { error: 'Esa cuenta no existe.' });

  const { data: adultos } = await supabaseAdmin.from('adultos').select('nombre, email').eq('socio_id', socioId).order('created_at');
  const emails = (adultos || []).map(a => a.email).filter(Boolean);
  const nombre = adultos && adultos[0] ? adultos[0].nombre : '';

  async function intentarEmail(plantilla) {
    if (emails.length === 0) return false;
    try {
      await enviarEmail({ to: emails.join(', '), subject: plantilla.subject, text: plantilla.text });
      return true;
    } catch (e) { return false; }
  }

  if (accion === 'activar') {
    const eraNuevaOReactivacion = socio.estado !== 'activa';
    let numero = socio.numero_secuencial;
    if (!numero) {
      const { data: siguiente, error: rpcError } = await supabaseAdmin.rpc('siguiente_numero_secuencial');
      if (rpcError) return json(500, { error: 'No se pudo asignar número de socio: ' + rpcError.message });
      numero = siguiente;
    }

    const cambios = { estado: 'activa', numero_secuencial: numero, motivo_rechazo: null, reactivacion_solicitada_en: null };
    if (eraNuevaOReactivacion) cambios.anio_ultima_cuota = anioCuotaActual();   // la cuota del curso que se paga (2026-2027 → 2027)

    const { data: actualizado, error } = await supabaseAdmin.from('socios').update(cambios).eq('id', socioId).select('numero_socio_completo').single();
    if (error) return json(500, { error: error.message });

    await supabaseAdmin.from('comprobantes_pago').update({ verificado: true }).eq('socio_id', socioId).eq('tipo', 'cuota_socio');

    const emailEnviado = await intentarEmail(plantillaBienvenida({
      nombre, numeroSocio: actualizado.numero_socio_completo, reactivacion: socio.estado !== 'recien_creada'
    }));
    return json(200, { ok: true, emailEnviado });
  }

  if (accion === 'rechazar') {
    const motivo = String(payload.motivo || '').trim();
    if (!motivo) return json(400, { error: 'Tienes que escribir el motivo del rechazo.' });

    const { error } = await supabaseAdmin.from('socios').update({ estado: 'baja', motivo_rechazo: motivo, reactivacion_solicitada_en: null }).eq('id', socioId);
    if (error) return json(500, { error: error.message });

    const emailEnviado = await intentarEmail(plantillaRechazo({ nombre, motivo }));
    return json(200, { ok: true, emailEnviado });
  }

  // Lo mismo que hace el reseteo anual del 31 de julio, para una sola cuenta
  if (accion === 'desactivar') {
    if (socio.estado !== 'activa') return json(400, { error: 'Solo se puede desactivar una cuenta activa.' });
    const { count } = await supabaseAdmin.from('adultos').select('id', { count: 'exact', head: true }).eq('socio_id', socioId).eq('role', 'admin');
    if (count) return json(400, { error: 'Es una cuenta de la Junta: no se desactiva (tampoco lo hace el reseteo del 31 de julio).' });
    const { error } = await supabaseAdmin.from('socios').update({ estado: 'falta_pago', datos_revisados_en: null }).eq('id', socioId);
    if (error) return json(500, { error: error.message });
    const { error: errAl } = await supabaseAdmin.from('alumnos').update({ verificado: false }).eq('socio_id', socioId);
    if (errAl) return json(500, { error: errAl.message });
    return json(200, { ok: true });
  }

  if (accion === 'eliminar') {
    if (socio.numero_secuencial === '0000') return json(400, { error: 'Es la cuenta principal del AMPA: no se puede eliminar.' });
    const { data: delSocio } = await supabaseAdmin.from('adultos').select('id, role').eq('socio_id', socioId);
    const adultosIds = (delSocio || []).map(a => a.id);
    if (adultosIds.includes(userData.user.id)) return json(400, { error: 'Es tu propia cuenta: no puedes eliminarla.' });
    if ((delSocio || []).some(a => a.role === 'admin')) return json(400, { error: 'Tiene adultos de la Junta (Admin). Quítales antes el Admin.' });
    const { count: libros } = await supabaseAdmin.from('prestamo_items').select('id', { count: 'exact', head: true })
      .eq('socio_id', socioId).not('entregado_en', 'is', null).is('fecha_devolucion', null).eq('perdido', false);
    if (libros) return json(400, { error: `Tiene ${libros} libro(s) del Banco de Libros sin devolver. Marcadlos como devueltos o perdidos antes de eliminarla.` });
    const { count: talonarios } = await supabaseAdmin.from('loteria_talonarios').select('id', { count: 'exact', head: true }).eq('socio_id', socioId);
    if (talonarios) return json(400, { error: `Tiene ${talonarios} talonario(s) de lotería asignados. Reasignadlos antes de eliminarla.` });

    // Archivos de sus justificantes (se borran después, si la cuenta se ha podido borrar)
    const { data: comps } = await supabaseAdmin.from('comprobantes_pago').select('archivo_url').eq('socio_id', socioId);
    const { error } = await supabaseAdmin.from('socios').delete().eq('id', socioId);
    if (error) return json(500, { error: 'No se pudo eliminar la cuenta: ' + error.message });
    // Usuarios de acceso de sus adultos (la fila de adultos ya se borró con la cuenta)
    const fallos = [];
    for (const id of adultosIds) {
      const { error: e } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (e && !/not.?found/i.test(e.message || '')) fallos.push(e.message);
    }
    const archivos = [...new Set((comps || []).map(c => c.archivo_url).filter(Boolean))];
    if (archivos.length) await supabaseAdmin.storage.from('comprobantes').remove(archivos);
    return json(200, { ok: true, avisoAcceso: fallos.length ? 'La cuenta se ha eliminado, pero no se pudo borrar algún usuario de acceso: ' + fallos[0] : null });
  }

  if (accion === 'baja') {
    const { error } = await supabaseAdmin.from('socios').update({ estado: 'baja', reactivacion_solicitada_en: null }).eq('id', socioId);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: 'Acción no reconocida.' });
};
