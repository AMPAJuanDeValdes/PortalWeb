// Convierte un array de objetos en un CSV y dispara su descarga.
// Las claves que empiezan por «_» no salen en el CSV (sirven para ordenar).
//
// Listados de personas: descargarCSV(filas, nombre, { orden: true }) pregunta
// antes en qué orden sacarlo, usando en cada fila:
//   _numero    → número de socio («2027.0300.0042»; sin número, al final)
//   _apellidos → apellidos para el orden alfabético: los del primer adulto
//                de la familia o, en una lista de alumnos/as, los del alumno/a
//   _nombre    → (opcional) para desempatar
function descargarCSV(filas, nombreArchivo, opciones) {
  if (!filas || filas.length === 0) return;
  if (opciones && opciones.orden) {
    elegirOrdenCSV().then(orden => { if (orden) descargarCSV(ordenarFilasCSV(filas, orden), nombreArchivo); });
    return;
  }
  const columnas = Object.keys(filas[0]).filter(c => !c.startsWith('_'));
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [
    columnas.join(','),
    ...filas.map(f => columnas.map(c => escape(f[c])).join(','))
  ];
  const blob = new Blob(['\uFEFF' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const _cmpES = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base', numeric: true });
function ordenarFilasCSV(filas, orden) {
  const alfa = (a, b) => _cmpES(a._apellidos, b._apellidos) || _cmpES(a._nombre, b._nombre);
  // El número de socio son las 4 últimas cifras (0042): el año de delante cambia con la cuota
  const num = (f) => String(f._numero || '').replace(/\D/g, '').slice(-4);
  return [...filas].sort(orden === 'numero'
    ? (a, b) => (!num(a)) - (!num(b)) || _cmpES(num(a), num(b)) || alfa(a, b)
    : alfa);
}

// Ventana para elegir el orden (recuerda la última elección en este navegador)
function elegirOrdenCSV() {
  return new Promise(resolve => {
    let ultimo = 'numero';
    try { ultimo = localStorage.getItem('ampa_orden_csv') || 'numero'; } catch (e) { /* sin almacenamiento */ }
    const d = document.createElement('dialog');
    d.className = 'dialogo-orden';
    d.innerHTML = `<form method="dialog" style="margin:0; min-width:min(360px, 80vw);">
        <p style="font-family:var(--font-title); font-weight:700; font-size:20px; margin:0 0 12px;">¿En qué orden lo saco?</p>
        <label class="check" style="display:flex; gap:8px; align-items:center; margin:0 0 8px;"><input type="radio" name="orden" value="numero" ${ultimo === 'numero' ? 'checked' : ''}> Por número de socio</label>
        <label class="check" style="display:flex; gap:8px; align-items:center; margin:0 0 16px;"><input type="radio" name="orden" value="apellidos" ${ultimo === 'apellidos' ? 'checked' : ''}> Alfabético, por apellidos</label>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary" value="ok">Descargar</button>
          <button class="btn btn-outline" value="cancelar" formnovalidate>Cancelar</button>
        </div></form>`;
    d.style.cssText = 'border:1px solid var(--line, #DDE3EA); border-radius:18px; padding:22px 24px; max-width:92vw;';
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const orden = d.returnValue === 'ok' ? d.querySelector('input[name=orden]:checked').value : null;
      if (orden) { try { localStorage.setItem('ampa_orden_csv', orden); } catch (e) { /* sin almacenamiento */ } }
      d.remove();
      resolve(orden);
    });
    d.showModal();
  });
}

// Parseo simple de CSV (admite comillas, campos con comas dentro de "").
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = '', dentroComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') { dentroComillas = false; }
      else { campo += c; }
    } else {
      if (c === '"') dentroComillas = true;
      else if (c === ',' || c === ';') { fila.push(campo); campo = ''; }
      else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
      else if (c === '\r') { /* ignorar */ }
      else campo += c;
    }
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(v => v.trim() !== ''));
}

// Convierte filas de parsearCSV (con cabecera) en array de objetos.
function csvAObjetos(filas) {
  const cabecera = filas[0].map(h => h.trim().toLowerCase());
  return filas.slice(1).map(fila => {
    const obj = {};
    cabecera.forEach((h, i) => { obj[h] = (fila[i] || '').trim(); });
    return obj;
  });
}
