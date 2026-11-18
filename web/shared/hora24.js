// Horas siempre en formato de 24 horas, en toda la web.
// Los campos de hora del navegador (<input type="time"> y "datetime-local")
// salen con AM/PM si el ordenador o el móvil está en inglés u otro idioma.
// Este archivo los cambia, sin tocar nada más, por unos desplegables de
// hora (00–23) y minutos (y la fecha, en los de fecha y hora). El campo
// original se queda escondido y sigue teniendo el mismo valor de siempre
// («HH:MM» o «AAAA-MM-DDTHH:MM»): el resto del código no cambia.
// Funciona también con los campos que se crean después (MutationObserver).
// Lo carga shared/supabaseClient.js en todas las páginas.
(function () {
  if (window.hora24Mejorar) return;
  const pad = (n) => String(n).padStart(2, '0');
  const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const SELECTOR = 'input[type="time"], input[type="datetime-local"]';

  function desplegable(etiqueta, valores) {
    const s = document.createElement('select');
    s.setAttribute('aria-label', etiqueta);
    s.innerHTML = '<option value="">--</option>' + valores.map(v => `<option value="${v}">${v}</option>`).join('');
    return s;
  }
  // Si el valor no está en la lista (p. ej. 17:32), se añade en su sitio
  function elegir(sel, v) {
    if (v && !Array.from(sel.options).some(o => o.value === v)) {
      const o = new Option(v, v);
      const antes = Array.from(sel.options).find(x => x.value && x.value > v);
      sel.add(o, antes || null);
    }
    sel.value = v || '';
  }

  function mejorar(input) {
    if (input.dataset.hora24) return;
    input.dataset.hora24 = '1';
    const conFecha = input.type === 'datetime-local';
    const nombre = (input.labels && input.labels[0] ? input.labels[0].textContent : input.getAttribute('aria-label') || '').trim();

    const caja = document.createElement('span');
    caja.className = 'hora24';
    let fecha = null;
    if (conFecha) {
      fecha = document.createElement('input');
      fecha.type = 'date';
      fecha.setAttribute('aria-label', (nombre ? nombre + ': ' : '') + 'día');
      if (input.min) fecha.min = input.min.slice(0, 10);
      if (input.max) fecha.max = input.max.slice(0, 10);
      caja.appendChild(fecha);
    }
    const h = desplegable((nombre ? nombre + ': ' : '') + 'hora', Array.from({ length: 24 }, (_, i) => pad(i)));
    const m = desplegable((nombre ? nombre + ': ' : '') + 'minutos', Array.from({ length: 12 }, (_, i) => pad(i * 5)));
    const dos = document.createElement('span');
    dos.className = 'hora24-sep'; dos.textContent = ':'; dos.setAttribute('aria-hidden', 'true');
    const reloj = document.createElement('span');   // hora y minutos siempre juntos
    reloj.className = 'hora24-reloj';
    reloj.append(h, dos, m);
    caja.append(reloj);
    const controles = [fecha, h, m].filter(Boolean);
    // Lo obligatorio pasa a los desplegables (un campo escondido no se puede marcar)
    if (input.required) { controles.forEach(c => { c.required = true; }); input.required = false; }

    const pintar = (v) => {
      const t = conFecha ? String(v || '').split('T') : ['', String(v || '')];
      if (fecha) fecha.value = t[0] || '';
      const [hh, mm] = (t[1] || '').split(':');
      elegir(h, hh || ''); elegir(m, mm ? mm.slice(0, 2) : '');
    };
    const avisar = () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const cambiar = (e) => {
      // Al elegir la hora, los minutos se ponen en 00 si estaban vacíos
      if (e && e.target === h && h.value && !m.value) m.value = '00';
      const completo = h.value && m.value && (!fecha || fecha.value);
      const v = completo ? (fecha ? fecha.value + 'T' : '') + h.value + ':' + m.value : '';
      if (v !== nativo.get.call(input)) { nativo.set.call(input, v); avisar(); }
    };
    controles.forEach(c => c.addEventListener('change', cambiar));

    // Lo que el código ponga en el campo original se ve en los desplegables
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return nativo.get.call(input); },
      set(v) { nativo.set.call(input, v); pintar(nativo.get.call(input)); }
    });
    input.focus = () => controles[0].focus();
    // Desactivado / activado igual que el campo original
    const copiarEstado = () => controles.forEach(c => { c.disabled = input.disabled; });
    new MutationObserver(copiarEstado).observe(input, { attributes: true, attributeFilter: ['disabled'] });
    copiarEstado();

    input.style.display = 'none';
    input.after(caja);
    pintar(nativo.get.call(input));
  }

  function recorrer(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    if (raiz.matches(SELECTOR)) mejorar(raiz);
    raiz.querySelectorAll(SELECTOR).forEach(mejorar);
  }
  window.hora24Mejorar = recorrer;
  const empezar = () => {
    recorrer(document.body);
    new MutationObserver(cambios => cambios.forEach(c => c.addedNodes.forEach(recorrer)))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) empezar(); else document.addEventListener('DOMContentLoaded', empezar);
})();
