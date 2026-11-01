// Nombres de personas estandarizados: lo mismo que hace la base de datos al
// guardar (normalizar_nombre, migracion-nombres-normalizados.sql), para que
// los emails que se mandan en el momento del alta usen ya el nombre corregido.
//   «mARIA  jose  GARCIA-lopez» → «Maria Jose Garcia-Lopez»
//   «JOSE DE LA FUENTE» → «Jose de la Fuente»
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'i']);

function normalizarNombre(texto) {
  if (texto == null) return texto;
  const limpio = String(texto).replace(/\s+/g, ' ').trim();
  if (!limpio) return limpio;
  return limpio.split(' ').map((palabra, k) => {
    const min = palabra.toLocaleLowerCase('es');
    if (k > 0 && PARTICULAS.has(min)) return min;
    // Mayúscula al empezar y después de cualquier signo (guion, apóstrofo, punto...)
    return min.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (m, antes, letra) => antes + letra.toLocaleUpperCase('es'));
  }).join(' ');
}

module.exports = { normalizarNombre };
