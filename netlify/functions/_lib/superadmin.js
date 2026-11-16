// Superadmin: la cuenta principal del AMPA (adulto Admin del socio 0000).
// Lo mismo que es_admin_principal() en la base de datos: también vale un
// adulto de prueba (email «ampa-prueba-») apuntado en superadmins_prueba,
// que solo puede escribir el servidor. Hacer el sorteo, los repartos,
// gestionar cuentas e importar socios solo lo puede hacer el superadmin;
// el resto de la Junta (Admin) no.
async function esSuperadmin(sb, userId) {
  const { data } = await sb.from('adultos').select('role, email, socios(numero_secuencial)').eq('id', userId).maybeSingle();
  if (!data || data.role !== 'admin') return false;
  if (data.socios?.numero_secuencial === '0000') return true;
  if (!/ampa-prueba-/i.test(data.email || '')) return false;
  const { data: prueba } = await sb.from('superadmins_prueba').select('adulto_id').eq('adulto_id', userId).maybeSingle();
  return !!prueba;
}
const SOLO_SUPERADMIN = 'Solo la cuenta principal del AMPA (socio 0000) puede hacer esto.';
module.exports = { esSuperadmin, SOLO_SUPERADMIN };
