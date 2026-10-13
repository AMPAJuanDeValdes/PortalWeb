// Convierte un array de objetos en un CSV y dispara su descarga.
function descargarCSV(filas, nombreArchivo) {
  if (!filas || filas.length === 0) return;
  const columnas = Object.keys(filas[0]);
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
