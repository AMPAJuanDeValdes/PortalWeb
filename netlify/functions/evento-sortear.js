// El admin pulsa "Sortear" en un evento con metodo_asignacion='sorteo'.
// Tres variantes, según cómo esté configurado el evento:
//
//   - Simple: sorteo aleatorio puro entre todas las inscripciones
//     pendientes, hasta cubrir el aforo.
//   - Por pareja (requiere_pareja_adulto_alumno, ej. Cabalgata): las
//     inscripciones vienen agrupadas por grupo_id (un adulto + un
//     alumno de la misma familia); se sortea por GRUPO completo, nunca
//     por persona suelta — si pierde la pareja, pierden los dos.
//   - Con prioridad histórica (usa_prioridad_historial, ej. Comedor):
//     quienes no han participado antes (adultos.ya_visito_comedor =
//     false) entran primero al sorteo; los que ya participaron solo
//     compiten por las plazas que sobren. Los ganadores nuevos quedan
//     marcados como "ya visitó" de cara a futuras ediciones.
//
// Solo puede ejecutarse una vez por evento (reclamo atómico), igual que
// los repartos de préstamo y uniformes.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mezclar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function actualizarEnLotes(filas, fn, tamanoLote = 25) {
  for (let i = 0; i < filas.length; i += tamanoLote) {
    await Promise.all(filas.slice(i, i + tamanoLote).map(fn));
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Falta token de sesión' }) };
  }
  const accessToken = authHeader.replace('Bearer ', '');

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida' }) };
  }

  const { data: adulto } = await supabaseAdmin
    .from('adultos').select('role').eq('id', userData.user.id).single();
  if (!adulto || adulto.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo un admin puede hacer esto' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const eventoId = String(payload.eventoId || '').trim();
  if (!eventoId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el id del evento' }) };
  }

  // Reclamo atómico: si sorteo_realizado ya era true, esta actualización
  // no afecta a ninguna fila y sabemos que ya se sorteó antes.
  const { data: reclamado, error: claimError } = await supabaseAdmin
    .from('eventos')
    .update({ sorteo_realizado: true })
    .eq('id', eventoId)
    .eq('metodo_asignacion', 'sorteo')
    .eq('sorteo_realizado', false)
    .select('id, aforo_total, requiere_pareja_adulto_alumno, usa_prioridad_historial')
    .maybeSingle();

  if (claimError) {
    return { statusCode: 500, body: JSON.stringify({ error: claimError.message }) };
  }
  if (!reclamado) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Este evento no usa sorteo, o ya se sorteó antes.' }) };
  }

  const { data: inscripciones, error: insError } = await supabaseAdmin
    .from('evento_inscripciones')
    .select('id, tipo_miembro, adulto_id, grupo_id')
    .eq('evento_id', eventoId)
    .eq('estado', 'pendiente');
  if (insError) {
    return { statusCode: 500, body: JSON.stringify({ error: insError.message }) };
  }

  const cupo = reclamado.aforo_total; // null = sin límite (no debería pasar en un sorteo real, pero por si acaso)
  let ganadoresIds = [];
  let nuevosVisitantesAdultoIds = [];

  if (reclamado.requiere_pareja_adulto_alumno) {
    const grupos = {};
    for (const i of inscripciones) {
      const clave = i.grupo_id || i.id; // por si alguna fila quedó suelta sin grupo
      (grupos[clave] = grupos[clave] || []).push(i);
    }
    const gruposIds = mezclar(Object.keys(grupos));
    const gruposGanadores = cupo != null ? gruposIds.slice(0, cupo) : gruposIds;
    ganadoresIds = gruposGanadores.flatMap(g => grupos[g].map(i => i.id));

  } else if (reclamado.usa_prioridad_historial) {
    const adultoIds = inscripciones.map(i => i.adulto_id).filter(Boolean);
    const { data: adultosInfo } = await supabaseAdmin
      .from('adultos').select('id, ya_visito_comedor').in('id', adultoIds);
    const yaVisitoMap = {};
    (adultosInfo || []).forEach(a => { yaVisitoMap[a.id] = a.ya_visito_comedor; });

    const nuevos = mezclar(inscripciones.filter(i => !yaVisitoMap[i.adulto_id]));
    const repiten = mezclar(inscripciones.filter(i => yaVisitoMap[i.adulto_id]));

    const ganadoresNuevos = cupo != null ? nuevos.slice(0, cupo) : nuevos;
    const restante = cupo != null ? cupo - ganadoresNuevos.length : repiten.length;
    const ganadoresRepiten = restante > 0 ? repiten.slice(0, restante) : [];

    ganadoresIds = [...ganadoresNuevos, ...ganadoresRepiten].map(i => i.id);
    nuevosVisitantesAdultoIds = ganadoresNuevos.map(i => i.adulto_id).filter(Boolean);

  } else {
    const mezclados = mezclar([...inscripciones]);
    const ganadores = cupo != null ? mezclados.slice(0, cupo) : mezclados;
    ganadoresIds = ganadores.map(i => i.id);
  }

  const ganadoresSet = new Set(ganadoresIds);
  await actualizarEnLotes(inscripciones, async (i) => {
    await supabaseAdmin.from('evento_inscripciones')
      .update({ estado: ganadoresSet.has(i.id) ? 'ganador' : 'no_ganador' })
      .eq('id', i.id);
  });

  if (nuevosVisitantesAdultoIds.length > 0) {
    await supabaseAdmin.from('adultos')
      .update({ ya_visito_comedor: true })
      .in('id', nuevosVisitantesAdultoIds);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      totalInscripciones: inscripciones.length,
      ganadores: ganadoresIds.length,
      noGanadores: inscripciones.length - ganadoresIds.length
    })
  };
};
