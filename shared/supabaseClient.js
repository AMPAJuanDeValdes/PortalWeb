// ============================================================
// CONFIGURA AQUÍ TUS CLAVES DE SUPABASE
// (Supabase → Project Settings → API Keys / Data API)
// ============================================================
const SUPABASE_URL = 'https://wvqthtfxvcwsdbwbwadb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AGFoOoVCOHsH_n5RTWv24A_iTb5xCn2';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

// Fila del adulto autenticado (login individual)
async function getAdulto() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from('adultos')
    .select('*')
    .eq('id', session.user.id)
    .single();
  if (error) return null;
  return data;
}

// Fila del socio (cuenta familiar) al que pertenece el adulto
async function getSocio(socioId) {
  const { data, error } = await sb
    .from('socios')
    .select('*')
    .eq('id', socioId)
    .single();
  if (error) return null;
  return data;
}

// Redirige según el estado de la cuenta. Devuelve true si el estado es
// 'activa' (puede continuar), false si ya ha redirigido a otro sitio.
function redirigirPorEstado(socio) {
  if (!socio) return true;
  const destinos = {
    recien_creada: 'estado-recien-creada.html',
    falta_pago: 'estado-falta-pago.html',
    baja: null // se trata como login inválido, ver login.html
  };
  if (socio.estado === 'activa') return true;
  const destino = destinos[socio.estado];
  if (destino) window.location.href = destino;
  return false;
}

// Llamar al principio de cada página que requiera sesión iniciada.
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  const adulto = await getAdulto();
  if (!adulto) {
    await sb.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }
  if (adulto.force_password_change && !window.location.pathname.endsWith('cambiar-clave.html')) {
    window.location.href = 'cambiar-clave.html';
    return null;
  }
  const socio = await getSocio(adulto.socio_id);
  const estadoOk = window.location.pathname.match(/estado-.*\.html$/) || redirigirPorEstado(socio);
  if (!estadoOk) return null;

  return { session, adulto, socio };
}

// Llamar al principio de cada página exclusiva de administradores.
async function requireAdmin() {
  const ctx = await requireAuth();
  if (!ctx) return null;
  if (!ctx.adulto || ctx.adulto.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return null;
  }
  return ctx;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// Calcula la edad a partir de una fecha de nacimiento (para elegibilidad por edad)
function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}
