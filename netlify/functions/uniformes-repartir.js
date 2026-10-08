// El admin pulsa "Repartir" una vez cerrado el plazo de una convocatoria
// de uniformes. Reparte las prendas entre los alumnos mediante rondas de
// "aceptación diferida":
//
//   - Cada alumno "sostiene" su prioridad actual (empieza en la 1ª).
//   - Si una prenda+talla tiene más peticiones que stock, se sortea
//     aleatoriamente quién se queda; el resto pasa a su siguiente
//     prioridad y se vuelve a comprobar en la ronda siguiente.
//   - Se repite hasta que nadie más se mueve (nadie compite ya por nada).
//   - Un alumno que agota sus 3 prioridades sin conseguir hueco se queda
//     sin prenda esta vez.
//
// Solo puede ejecutarse una vez por convocatoria (reclamo atómico
// abierta -> repartida), igual que en el préstamo de libros.

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

// pedidos: [{ id, alumno_id, prioridad, prenda_id }] (prioridad 1, 2 o 3)
// capacidadPorPrenda: { [prenda_id]: stock }
function repartir(pedidos, capacidadPorPrenda) {
  const porAlumno = {};
  for (const p of pedidos) {
    (porAlumno[p.alumno_id] = porAlumno[p.alumno_id] || []).push(p);
  }
  for (const alumnoId in porAlumno) {
    porAlumno[alumnoId].sort((a, b) => a.prioridad - b.prioridad);
  }

  const estado = {};
  for (const alumnoId in porAlumno) estado[alumnoId] = { puntero: 0, descartado: false };

  function agruparActuales() {
    const grupos = {};
    for (const alumnoId in porAlumno) {
      const e = estado[alumnoId];
      if (e.descartado) continue;
      const opciones = porAlumno[alumnoId];
      if (e.puntero >= opciones.length) { e.descartado = true; continue; }
      const prendaId = opciones[e.puntero].prenda_id;
      (grupos[prendaId] = grupos[prendaId] || []).push(alumnoId);
    }
    return grupos;
  }

  let grupos = agruparActuales();
  while (true) {
    let huboMovimiento = false;
    for (const prendaId in grupos) {
      const lista = grupos[prendaId];
      const capacidad = capacidadPorPrenda[prendaId] || 0;
      if (lista.length > capacidad) {
        mezclar(lista);
        for (const alumnoId of lista.slice(capacidad)) {
          estado[alumnoId].puntero++;
          huboMovimiento = true;
        }
      }
    }
    if (!huboMovimiento) break;
    grupos = agruparActuales();
  }

  const asignaciones = []; // { pedidoId, prendaId }
  for (const prendaId in grupos) {
    for (const alumnoId of grupos[prendaId]) {
      const pedido = porAlumno[alumnoId][estado[alumnoId].puntero];
      asignaciones.push({ pedidoId: pedido.id, prendaId: pedido.prenda_id });
    }
  }

  const idsAsignados = new Set(asignaciones.map(a => a.pedidoId));
  const noAsignadosIds = pedidos.filter(p => !idsAsignados.has(p.id)).map(p => p.id);

  return { asignaciones, noAsignadosIds };
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
    .from('adultos').select('role, nombre, apellidos').eq('id', userData.user.id).single();
  if (!adulto || adulto.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo un admin puede hacer esto' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON no válido' }) }; }

  const convocatoriaId = String(payload.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el id de la convocatoria' }) };
  }

  const { data: reclamada, error: claimError } = await supabaseAdmin
    .from('uniformes_convocatorias')
    .update({ estado: 'repartida' })
    .eq('id', convocatoriaId)
    .eq('estado', 'abierta')
    .lte('fecha_cierre', new Date().toISOString())   // solo con el plazo ya cerrado
    .select('id')
    .maybeSingle();

  if (claimError) {
    return { statusCode: 500, body: JSON.stringify({ error: claimError.message }) };
  }
  if (!reclamada) {
    const { data: conv } = await supabaseAdmin.from('uniformes_convocatorias').select('estado, fecha_cierre').eq('id', convocatoriaId).maybeSingle();
    const msg = conv && conv.estado === 'abierta'
      ? 'El plazo de esta convocatoria todavía no ha cerrado (puedes cerrarlo ya con "Cerrar plazo ahora").'
      : 'Esta convocatoria ya se repartió (o no existe).';
    return { statusCode: 400, body: JSON.stringify({ error: msg }) };
  }

  const { data: pedidos, error: pedidosError } = await supabaseAdmin
    .from('uniformes_pedidos')
    .select('id, alumno_id, prioridad, prenda_id')
    .eq('convocatoria_id', convocatoriaId)
    .eq('estado', 'pendiente')
    .in('prioridad', [1, 2, 3]);
  if (pedidosError) {
    return { statusCode: 500, body: JSON.stringify({ error: pedidosError.message }) };
  }

  // Los alumnos/as a los que el admin ya les asignó una prenda a mano antes
  // de repartir NO vuelven a entrar en el sorteo (si no, podrían llevarse 2).
  const { data: yaAsignados } = await supabaseAdmin
    .from('uniformes_pedidos').select('alumno_id')
    .eq('convocatoria_id', convocatoriaId).eq('estado', 'asignado');
  const alumnosYaAsignados = new Set((yaAsignados || []).map(p => p.alumno_id));
  const pedidosSorteo = (pedidos || []).filter(p => !alumnosYaAsignados.has(p.alumno_id));

  const { data: prendas, error: prendasError } = await supabaseAdmin
    .from('prendas_catalogo')
    .select('id, stock');
  if (prendasError) {
    return { statusCode: 500, body: JSON.stringify({ error: prendasError.message }) };
  }

  const capacidadPorPrenda = {};
  for (const p of prendas) capacidadPorPrenda[p.id] = p.stock;

  const { asignaciones, noAsignadosIds } = repartir(pedidosSorteo, capacidadPorPrenda);

  await actualizarEnLotes(asignaciones, async ({ pedidoId }) => {
    await supabaseAdmin.from('uniformes_pedidos').update({ estado: 'asignado' }).eq('id', pedidoId);
  });

  // Descontar el stock consumido, agrupado por prenda. Se hace con la
  // Service Role directamente (sin pasar por una función is_admin()),
  // porque bajo Service Role auth.uid() es null y esa comprobación
  // fallaría; el permiso de admin ya se validó arriba en JavaScript.
  const consumoPorPrenda = {};
  for (const a of asignaciones) consumoPorPrenda[a.prendaId] = (consumoPorPrenda[a.prendaId] || 0) + 1;
  await actualizarEnLotes(Object.entries(consumoPorPrenda), async ([prendaId, cantidad]) => {
    const stockActual = capacidadPorPrenda[prendaId] || 0;
    await supabaseAdmin.from('prendas_catalogo')
      .update({ stock: stockActual - cantidad })
      .eq('id', prendaId);
  });

  if (noAsignadosIds.length > 0) {
    await supabaseAdmin.from('uniformes_pedidos').update({ estado: 'no_asignado' }).in('id', noAsignadosIds);
  }

  // Resumen del reparto (alumnos, no pedidos: cada alumno pide 3 prendas)
  const alumnosTotales = new Set((pedidos || []).map(p => p.alumno_id));
  alumnosYaAsignados.forEach(id => alumnosTotales.add(id));
  const asignadosTotal = alumnosYaAsignados.size + asignaciones.length;
  const resumen = {
    total_alumnos: alumnosTotales.size,
    asignados: asignadosTotal,
    asignados_a_mano_antes: alumnosYaAsignados.size,
    no_asignados: alumnosTotales.size - asignadosTotal,
    repartido_en: new Date().toISOString(),
    repartido_por: [adulto.nombre, adulto.apellidos].filter(Boolean).join(' ')
  };
  await supabaseAdmin.from('uniformes_convocatorias').update({ resumen_reparto: resumen }).eq('id', convocatoriaId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      totalAlumnos: resumen.total_alumnos,
      asignados: resumen.asignados,
      noAsignados: resumen.no_asignados
    })
  };
};
