// Dado un array de socio_id, devuelve un mapa:
// { [socioId]: { numero_socio, nombre (adultos concatenados), estado } }
async function getResumenSocios(socioIds) {
  const idsUnicos = Array.from(new Set((socioIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return {};

  const { data: socios } = await sb.from('socios').select('id, numero_socio_completo, estado').in('id', idsUnicos);
  const { data: adultos } = await sb.from('adultos').select('socio_id, nombre, apellidos').in('socio_id', idsUnicos);

  const nombrePorSocio = {};
  (adultos || []).forEach(a => {
    const n = a.nombre + ' ' + a.apellidos;
    nombrePorSocio[a.socio_id] = nombrePorSocio[a.socio_id] ? nombrePorSocio[a.socio_id] + ' / ' + n : n;
  });

  const resumen = {};
  (socios || []).forEach(s => {
    resumen[s.id] = {
      numero_socio: s.numero_socio_completo,
      nombre: nombrePorSocio[s.id] || '',
      estado: s.estado
    };
  });
  return resumen;
}
