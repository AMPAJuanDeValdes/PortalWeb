// ============================================================
// CONFIGURA AQUÍ TUS CLAVES DE SUPABASE
// (Supabase → Project Settings → API)
// La "anon key" es pública por diseño: la seguridad real la dan
// las políticas de RLS definidas en supabase/schema.sql.
// ============================================================
const SUPABASE_URL = 'https://wvqthtfxvcwsdbwbwadb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AGFoOoVCOHsH_n5RTWv24A_iTb5xCn2';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  if (error) return null;

  const { data: principal } = await sb
    .from('progenitores')
    .select('nombre, apellidos')
    .eq('profile_id', data.id)
    .eq('tipo', 'principal')
    .maybeSingle();

  data.nombre_mostrar = principal ? `${principal.nombre} ${principal.apellidos}` : data.email;
  return data;
}

// Llamar al principio de cada página que requiera sesión iniciada.
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  const profile = await getProfile();
  if (profile && profile.force_password_change && !window.location.pathname.endsWith('cambiar-clave.html')) {
    window.location.href = 'cambiar-clave.html';
    return null;
  }
  return { session, profile };
}

// Llamar al principio de cada página exclusiva de administradores.
async function requireAdmin() {
  const ctx = await requireAuth();
  if (!ctx) return null;
  if (!ctx.profile || ctx.profile.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return null;
  }
  return ctx;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}
