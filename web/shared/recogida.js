// Talleres (juegos de mesa, talleres y el Curso de Warhammer): al apuntar a
// un alumno/a, la familia socia dice si lo recoge una persona diferente (y
// entonces su nombre, apellidos y móvil: pasa a ser el adulto responsable en
// los listados). Los no socios no: ya escriben a mano el adulto responsable.
// En Warhammer se puede marcar además que el alumno/a sale solo/a. Si el
// evento lo pide, también se pueden dejar instrucciones especiales (sale
// antes, llega tarde...).
// La base de datos comprueba lo mismo (trigger eventos_validar_recogida).

const PLANTILLAS_TALLER = ['juegos', 'taller', 'warhammer'];
const PIDE_RECOGIDA = (ev) => !!ev && PLANTILLAS_TALLER.includes(ev.plantilla);
const PERMITE_SALIR_SOLO = (ev) => !!ev && ev.plantilla === 'warhammer';
const PIDE_INSTRUCCIONES = (ev) => !!ev && !!ev.pide_instrucciones;
const PIDE_DATOS_TALLER = (ev) => PIDE_RECOGIDA(ev) || PIDE_INSTRUCCIONES(ev);

function _movilOk(v) {
  if (typeof movilValido === 'function') return movilValido(v);
  return /^\d{9}$/.test(String(v || '').replace(/[\s.\-()]/g, '').replace(/^(\+34|0034)/, ''));
}

// Campos del formulario. id: prefijo único para este formulario.
// publico: formulario de no socios (sin la pregunta de quién lo recoge).
function htmlRecogida(ev, id, publico = false) {
  let html = '';
  if (PIDE_INSTRUCCIONES(ev)) {
    html += `<div class="field"><label for="${id}ins">Instrucciones especiales</label>
      <input type="text" id="${id}ins" placeholder="Ej.: sale antes, llega tarde..."></div>`;
  }
  if (PIDE_RECOGIDA(ev)) {
    html += '<div class="recogida">';
    if (PERMITE_SALIR_SOLO(ev)) {
      html += `<label class="check"><input type="checkbox" id="${id}solo"> Autorizo a que salga solo/a al terminar</label>`;
    }
    if (!publico) html += `<div id="${id}pregunta"><span style="font-weight:700;">¿Recoge al alumno/a una persona diferente? *</span>
      <div class="radios" style="margin-top:6px;"><label><input type="radio" name="${id}rec" value="no"> No</label><label><input type="radio" name="${id}rec" value="si"> Sí</label></div>
      <div id="${id}datos" hidden style="margin-top:8px;">
        <div class="dos"><div class="field"><label for="${id}rnm">Nombre *</label><input type="text" id="${id}rnm"></div>
        <div class="field"><label for="${id}rap">Apellidos *</label><input type="text" id="${id}rap"></div></div>
        <div class="field"><label for="${id}rmv">Móvil *</label><input type="tel" id="${id}rmv" inputmode="tel"></div>
      </div></div>`;
    html += '</div>';
  }
  return html;
}

// Enlaza los campos (llamar después de meter el html en root)
function activarRecogida(root, id) {
  const q = (s) => root.querySelector('#' + id + s);
  const solo = q('solo'), pregunta = q('pregunta'), datos = q('datos');
  if (solo && pregunta) solo.addEventListener('change', () => { pregunta.hidden = solo.checked; });
  root.querySelectorAll(`input[name="${id}rec"]`).forEach(r => r.addEventListener('change', () => {
    if (datos) datos.hidden = !(r.checked && r.value === 'si');
  }));
  ['rnm', 'rap', 'rmv'].forEach(s => { const el = q(s); if (el) el.addEventListener('input', () => el.classList.remove('campo-error')); });
}

// Devuelve { datos } con las columnas a guardar, o { error }
function leerRecogida(ev, root, id, publico = false) {
  const q = (s) => root.querySelector('#' + id + s);
  const datos = {};
  if (PIDE_INSTRUCCIONES(ev) && q('ins')) datos.instrucciones = q('ins').value.trim() || null;
  if (!PIDE_RECOGIDA(ev)) return { datos };
  if (PERMITE_SALIR_SOLO(ev)) {
    datos.sale_solo = !!(q('solo') && q('solo').checked);
    if (datos.sale_solo) return { datos };
  }
  if (publico) return { datos };
  const sel = root.querySelector(`input[name="${id}rec"]:checked`);
  if (!sel) return { error: PERMITE_SALIR_SOLO(ev)
    ? 'Indica si recoge al alumno/a una persona diferente, o marca que puede salir solo/a.'
    : 'Indica si recoge al alumno/a una persona diferente.' };
  datos.recoge_otra = sel.value === 'si';
  if (datos.recoge_otra) {
    datos.recoge_nombre = q('rnm').value.trim();
    datos.recoge_apellidos = q('rap').value.trim();
    datos.recoge_movil = q('rmv').value.trim();
    const faltan = [];
    if (!datos.recoge_nombre) { faltan.push('el nombre'); q('rnm').classList.add('campo-error'); }
    if (!datos.recoge_apellidos) { faltan.push('los apellidos'); q('rap').classList.add('campo-error'); }
    if (!datos.recoge_movil) { faltan.push('el móvil'); q('rmv').classList.add('campo-error'); }
    if (faltan.length) return { error: 'Falta ' + faltan.join(', ').replace(/, ([^,]*)$/, ' y $1') + ' de la persona que recoge al alumno/a.' };
    if (!_movilOk(datos.recoge_movil)) { q('rmv').classList.add('campo-error'); return { error: 'El móvil de la persona que recoge al alumno/a no es válido (9 cifras).' }; }
  }
  return { datos };
}

// Persona que recoge al alumno/a (si no es la familia)
function nombreRecoge(i) {
  return i.recoge_otra ? [i.recoge_nombre, i.recoge_apellidos].filter(Boolean).join(' ') : '';
}
// Notas para los listados: sale solo/a e instrucciones especiales
function notasRecogida(i) {
  return [i.sale_solo ? 'Sale solo/a' : '', i.instrucciones || ''].filter(Boolean).join('. ');
}
// Texto para la propia familia
function textoRecogida(i) {
  return [i.recoge_otra ? `Lo recoge ${nombreRecoge(i)}${i.recoge_movil ? ' (' + i.recoge_movil + ')' : ''}` : '', notasRecogida(i)].filter(Boolean).join('. ');
}
