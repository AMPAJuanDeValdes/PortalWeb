// Dado un array de socio_id, devuelve un mapa:
// { [socioId]: { numero_socio, nombre (adultos concatenados), estado } }
async function getResumenSocios(socioIds) {
  const idsUnicos = Array.from(new Set((socioIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return {};

  // En trozos: con cientos de ids la dirección de la consulta sería demasiado larga
  const socios = [], adultos = [];
  for (let i = 0; i < idsUnicos.length; i += 150) {
    const trozo = idsUnicos.slice(i, i + 150);
    const [{ data: s }, { data: a }] = await Promise.all([
      sb.from('socios').select('id, numero_socio_completo, estado').in('id', trozo),
      sb.from('adultos').select('socio_id, nombre, apellidos').in('socio_id', trozo)
    ]);
    socios.push(...(s || [])); adultos.push(...(a || []));
  }

  const nombrePorSocio = {};
  (adultos || []).forEach(a => {
    const n = a.nombre + ' ' + a.apellidos;
    nombrePorSocio[a.socio_id] = nombrePorSocio[a.socio_id] ? nombrePorSocio[a.socio_id] + ' / ' + n : n;
  });

  const resumen = {};
  (socios || []).forEach(s => {
    resumen[s.id] = {
      numero_socio: numeroSocioBonito(s.numero_socio_completo),
      nombre: nombrePorSocio[s.id] || '',
      estado: s.estado
    };
  });
  return resumen;
}

// Supabase devuelve como mucho 1000 filas por consulta: esto las trae todas, de 1000 en 1000.
// crear: función que devuelve la consulta (con su .order), p. ej. () => sb.from('x').select('*').order('id')
async function todasLasFilas(crear) {
  const N = 1000, filas = [];
  for (let desde = 0; ; desde += N) {
    const { data, error } = await crear().range(desde, desde + N - 1);
    if (error) { console.error(error); break; }
    filas.push(...(data || []));
    if (!data || data.length < N) break;
  }
  return filas;
}
