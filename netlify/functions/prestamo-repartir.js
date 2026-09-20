// El admin pulsa "Repartir" una vez que se cierra el plazo de una
// convocatoria de préstamo. Reparte los libros disponibles entre las
// familias siguiendo esta prioridad, un libro a la vez:
//
//   1. La familia con MENOS libros recibidos hasta el momento.
//   2. Empate → la que pidió MÁS libros en total (nunca al revés: quien
//      pide más nunca debe acabar con menos que quien pidió menos).
//   3. Empate todavía → sorteo aleatorio (nunca por orden de llegada).
//
// Dentro de la familia elegida, se le da primero el libro más escaso
// entre los que aún tiene pendientes, para no gastar innecesariamente
// un título abundante en alguien que probablemente lo consiga después.
//
// Solo puede ejecutarse una vez por convocatoria: el primer paso reclama
// la convocatoria de forma atómica (abierta -> repartida); si ya estaba
// repartida, se aborta sin tocar nada.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function elegirAlAzar(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// items: [{ id, socio_id, libro_id }]
// ejemplaresPorLibro: { [libro_id]: [ejemplar_id, ejemplar_id, ...] } — se
// va vaciando a medida que se reparte (mutado in-place).
function repartir(items, ejemplaresPorLibro) {
  const pendientes = items.map(it => ({ ...it, asignado: false }));
  const totalPedido = {};
  const recibido = {};
  for (const it of pendientes) {
    totalPedido[it.socio_id] = (totalPedido[it.socio_id] || 0) + 1;
    recibido[it.socio_id] = 0;
  }

  const disponibles = libroId => (ejemplaresPorLibro[libroId] || []).length;
  const asignaciones = []; // { itemId, ejemplarId }

  while (true) {
    const candidatos = pendientes.filter(it => !it.asignado && disponibles(it.libro_id) > 0);
    if (candidatos.length === 0) break;

    const socios = Array.from(new Set(candidatos.map(it => it.socio_id)));

    const minRecibido = Math.min(...socios.map(s => recibido[s]));
    const nivel1 = socios.filter(s => recibido[s] === minRecibido);
    const maxPedido = Math.max(...nivel1.map(s => totalPedido[s]));
    const nivel2 = nivel1.filter(s => totalPedido[s] === maxPedido);
    const socioElegido = elegirAlAzar(nivel2);

    const itemsDeSocio = candidatos.filter(it => it.socio_id === socioElegido);
    const minStock = Math.min(...itemsDeSocio.map(it => disponibles(it.libro_id)));
    const itemsEscasos = itemsDeSocio.filter(it => disponibles(it.libro_id) === minStock);
    const itemElegido = pendientes.find(it => it.id === elegirAlAzar(itemsEscasos).id);

    const ejemplarId = ejemplaresPorLibro[itemElegido.libro_id].pop();
    asignaciones.push({ itemId: itemElegido.id, ejemplarId });
    itemElegido.asignado = true;
    recibido[socioElegido]++;
  }

  const noAsignados = pendientes.filter(it => !it.asignado).map(it => it.id);
  return { asignaciones, noAsignados };
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

  const convocatoriaId = String(payload.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el id de la convocatoria' }) };
  }

  // Reclama la convocatoria de forma atómica: si ya no está "abierta",
  // el UPDATE no afecta a ninguna fila y sabemos que ya se repartió antes.
  const { data: reclamada, error: claimError } = await supabaseAdmin
    .from('prestamo_convocatorias')
    .update({ estado: 'repartida' })
    .eq('id', convocatoriaId)
    .eq('estado', 'abierta')
    .select('id')
    .maybeSingle();

  if (claimError) {
    return { statusCode: 500, body: JSON.stringify({ error: claimError.message }) };
  }
  if (!reclamada) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Esta convocatoria ya se repartió (o no existe).' }) };
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('prestamo_items')
    .select('id, socio_id, libro_id')
    .eq('convocatoria_id', convocatoriaId)
    .eq('tipo', 'solicitud')
    .eq('estado', 'pendiente');
  if (itemsError) {
    return { statusCode: 500, body: JSON.stringify({ error: itemsError.message }) };
  }

  const { data: ejemplares, error: ejemplaresError } = await supabaseAdmin
    .from('libros_ejemplares')
    .select('id, libro_id')
    .eq('estado', 'disponible');
  if (ejemplaresError) {
    return { statusCode: 500, body: JSON.stringify({ error: ejemplaresError.message }) };
  }

  const ejemplaresPorLibro = {};
  for (const e of ejemplares) {
    (ejemplaresPorLibro[e.libro_id] = ejemplaresPorLibro[e.libro_id] || []).push(e.id);
  }

  const { asignaciones, noAsignados } = repartir(items || [], ejemplaresPorLibro);
  const fecha = hoyISO();

  await actualizarEnLotes(asignaciones, async ({ itemId, ejemplarId }) => {
    await supabaseAdmin.from('prestamo_items')
      .update({ ejemplar_id: ejemplarId, estado: 'asignado', fecha_asignacion: fecha })
      .eq('id', itemId);
    await supabaseAdmin.from('libros_ejemplares')
      .update({ estado: 'prestado' })
      .eq('id', ejemplarId);
  });

  if (noAsignados.length > 0) {
    await supabaseAdmin.from('prestamo_items')
      .update({ estado: 'no_asignado' })
      .in('id', noAsignados);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      totalSolicitudes: (items || []).length,
      asignados: asignaciones.length,
      noAsignados: noAsignados.length
    })
  };
};
