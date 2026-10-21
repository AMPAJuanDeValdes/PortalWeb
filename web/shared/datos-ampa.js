// Datos fijos del AMPA que se muestran en varias páginas públicas
// (Hazte socio, Reactivar cuenta, renovación de cuota).
// Cámbialos SOLO aquí y se actualizan en todas.

var AMPA_IBAN = 'ES41 0049 4078 5026 1410 8578';
var AMPA_TITULAR_CUENTA = 'APA del Colegio Evangélico Juan de Valdés';
var AMPA_CUOTA_ANUAL = '25 €';
// Contacto (pie de las circulares)
var AMPA_EMAIL = 'ampa_j_valdes@fapaginerdelosrios.org';
var AMPA_INSTAGRAM = 'https://www.instagram.com/ampacolegiojuandevaldes/';
var AMPA_WHATSAPP = 'https://whatsapp.com/channel/0029Vb5wJn6G8l57tBQ4Oe3K';

// Año escolar: del 1 de agosto al 31 de julio. Ej.: 9/10/2026 -> '2026-2027'.
// Año de la cuota que se paga ahora: la del curso que termina ese año
// (en octubre de 2026 se paga la 2026-2027 → 2027)
function anioCuota(fecha) {
  const d = fecha || new Date();
  return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear();
}
function anioEscolar(fecha) {
  const d = fecha || new Date();
  const inicio = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return inicio + '-' + (inicio + 1);
}

// Bloque HTML con los datos de pago, listo para insertar en una página.
function htmlDatosTransferencia(concepto) {
  return (
    '<div class="datos-pago">' +
      '<div><span>Cuota anual</span><b>' + AMPA_CUOTA_ANUAL + ' por familia</b></div>' +
      '<div><span>IBAN</span><b class="iban">' + AMPA_IBAN + '</b></div>' +
      '<div><span>Titular</span><b>' + AMPA_TITULAR_CUENTA + '</b></div>' +
      '<div><span>Concepto</span><b class="concepto-pago">' + (concepto || 'Cuota AMPA ' + anioEscolar() + ' + nombre y apellidos') + '</b></div>' +
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

// ---------- Validaciones de datos de adultos y alumnos ----------
// Móvil: 9 cifras (se aceptan espacios, guiones y el prefijo +34)
function movilValido(v) {
  const d = String(v || '').replace(/[\s.\-()]/g, '').replace(/^(\+34|0034)/, '');
  return /^\d{9}$/.test(d);
}
// DNI: 8 números y una letra. NIE: X, Y o Z, 7 números y una letra.
// La letra es la de control oficial: el número (en el NIE, cambiando
// X=0, Y=1, Z=2) dividido entre 23; el resto indica la letra en
// «TRWAGMYFPDXBNJZSQVHLCKE». Un pasaporte no se comprueba.
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
function dniValido(v, esPasaporte) {
  const d = String(v || '').replace(/[\s.\-]/g, '').toUpperCase();
  if (esPasaporte) return d.length > 0;
  let numero;
  if (/^\d{8}[A-Z]$/.test(d)) numero = d.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/.test(d)) numero = 'XYZ'.indexOf(d[0]) + d.slice(1, 8);
  else return false;
  return LETRAS_DNI[parseInt(numero, 10) % 23] === d[8];
}
// Fecha de nacimiento de un alumno/a: desde el año 2000 y no en el futuro
const NACIMIENTO_MIN = '2000-01-01';
function nacimientoValido(f) {
  const hoy = new Date().toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f || '') && f >= NACIMIENTO_MIN && f <= hoy;
}
const MSG_MOVIL = 'El móvil tiene que tener 9 cifras.';
const MSG_DNI = 'Revisa el DNI/NIE: el DNI son 8 números y una letra (12345678Z) y el NIE empieza por X, Y o Z, 7 números y una letra (X1234567L). La letra tiene que ser la correcta.';
const MSG_NACIMIENTO = 'Revisa la fecha de nacimiento: tiene que ser del año 2000 en adelante.';

// Edad exacta a día de hoy, en texto: «8 años y 3 meses» (para que quien
// escribe la fecha de nacimiento vea si se ha equivocado)
function edadExacta(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return '';
  const n = new Date(f + 'T12:00:00'), h = new Date();
  let meses = (h.getFullYear() - n.getFullYear()) * 12 + (h.getMonth() - n.getMonth());
  if (h.getDate() < n.getDate()) meses--;
  if (meses < 0) return '';
  const a = Math.floor(meses / 12), m = meses % 12;
  const txtA = a === 1 ? '1 año' : a + ' años', txtM = m === 1 ? '1 mes' : m + ' meses';
  return a && m ? `${txtA} y ${txtM}` : a ? txtA : txtM;
}
// Pone debajo del campo de fecha una nota verde con la edad, al salir del campo
function notaEdad(input) {
  if (!input || input._notaEdad) return;
  input._notaEdad = true;
  const nota = document.createElement('p');
  nota.className = 'nota-edad'; nota.hidden = true; nota.setAttribute('aria-live', 'polite');
  input.insertAdjacentElement('afterend', nota);
  const pintar = () => {
    const e = edadExacta(input.value);
    nota.hidden = !e || !nacimientoValido(input.value);
    nota.textContent = e ? `Hoy tiene ${e}.` : '';
  };
  input.addEventListener('blur', pintar);
  input.addEventListener('change', pintar);
  if (input.value) pintar();
}

// Las funciones de Netlify (circulares) usan los mismos datos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AMPA_IBAN, AMPA_TITULAR_CUENTA, AMPA_CUOTA_ANUAL, AMPA_EMAIL, AMPA_INSTAGRAM, AMPA_WHATSAPP };
}
