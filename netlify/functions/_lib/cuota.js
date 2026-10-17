// Año de la cuota que se paga ahora. El curso va de agosto a julio (el 31 de
// julio se desactivan las cuentas) y la cuota se nombra por el año en que
// termina: quien paga en octubre de 2026 paga la cuota 2026-2027 → 2027.
function anioCuotaActual(fecha = new Date()) {
  return fecha.getMonth() >= 7 ? fecha.getFullYear() + 1 : fecha.getFullYear();
}

module.exports = { anioCuotaActual };
