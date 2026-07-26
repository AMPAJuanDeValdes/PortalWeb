// Dado un array de profile_id, devuelve un mapa:
// { [profileId]: { numero_socio, nombre, email, role } }
// nombre = nombre + apellidos del progenitor "principal"; si no existe, cae al email.
async function getResumenSocios(profileIds) {
  const idsUnicos = Array.from(new Set((profileIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return {};

  const { data: profs } = await sb
    .from('profiles')
    .select('id, numero_socio_completo, email, role')
    .in('id', idsUnicos);

  const { data: progs } = await sb
    .from('progenitores')
    .select('profile_id, nombre, apellidos')
    .in('profile_id', idsUnicos)
    .eq('tipo', 'principal');

  const nombrePorId = {};
  (progs || []).forEach(p => { nombrePorId[p.profile_id] = `${p.nombre} ${p.apellidos}`; });

  const resumen = {};
  (profs || []).forEach(p => {
    resumen[p.id] = {
      numero_socio: p.numero_socio_completo,
      nombre: nombrePorId[p.id] || p.email,
      email: p.email,
      role: p.role
    };
  });
  return resumen;
}
