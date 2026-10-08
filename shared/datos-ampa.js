// Datos fijos del AMPA que se muestran en varias páginas públicas
// (Hazte socio, Reactivar cuenta, renovación de cuota).
// Cámbialos SOLO aquí y se actualizan en todas.

var AMPA_IBAN = 'ES41 0049 4078 5026 1410 8578';
var AMPA_TITULAR_CUENTA = 'AMPA Colegio Juan de Valdés';
var AMPA_CUOTA_ANUAL = '25 €';

// Bloque HTML con los datos de pago, listo para insertar en una página.
function htmlDatosTransferencia(concepto) {
  return (
    '<div class="datos-pago">' +
      '<div><span>Cuota anual</span><b>' + AMPA_CUOTA_ANUAL + ' por familia</b></div>' +
      '<div><span>IBAN</span><b class="iban">' + AMPA_IBAN + '</b></div>' +
      '<div><span>Titular</span><b>' + AMPA_TITULAR_CUENTA + '</b></div>' +
      '<div><span>Concepto</span><b>' + (concepto || 'Cuota AMPA + nombre y apellidos') + '</b></div>' +
    '</div>'
  );
}

// Marca en rojo los campos que faltan. Recibe una lista de elementos
// <input>/<select>/<textarea>; devuelve true si todos tienen valor.
// Al corregir un campo, se le quita la marca sola.
function marcarCamposVacios(elementos) {
  let primero = null;
  elementos.forEach(el => {
    if (!el) return;
    const vacio = el.type === 'file' ? !(el.files && el.files.length) : !String(el.value || '').trim();
    el.classList.toggle('campo-error', vacio);
    if (vacio && !primero) primero = el;
    if (!el._limpiaError) {
      el._limpiaError = true;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'file' || el.type === 'date' ? 'change' : 'input',
        () => el.classList.remove('campo-error'));
    }
  });
  if (primero) {
    primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { try { primero.focus({ preventScroll: true }); } catch (e) {} }, 300);
  }
  return !primero;
}
