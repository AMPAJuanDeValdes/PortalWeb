// El adulto principal de una familia es el primero que se dio de alta.
// Tiene que existir siempre mientras exista la cuenta del socio: no se
// puede quitar (ni la familia ni la Junta); para cerrar la cuenta, baja.
async function esAdultoPrincipal(sb, adulto) {
  const { data } = await sb.from('adultos').select('id').eq('socio_id', adulto.socio_id)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
  return !!(data && data[0] && data[0].id === adulto.id);
}

module.exports = { esAdultoPrincipal };
