// Crea un archivo de Excel (.xlsx) en el navegador, sin librerías externas.
// Una hoja con filas de celdas de texto y unos pocos estilos fijos.
//
//   const blob = crearXlsx({ hoja: 'Inscritos', anchos: [8, 30], filas: [
//     [{ v: 'Título', e: 'titulo' }],
//     [{ v: 'Nivel', e: 'cabecera' }, { v: 'Alumno/a', e: 'cabecera' }],
//     [{ v: 'Primaria' }, { v: 'Ana Pérez', e: 'amarillo' }]
//   ], unir: ['A1:G1'] });
//
// Una fila también puede ser { celdas: [...], alto: 6 } (alto en puntos).
// letra: tamaño de letra base. margen: margen de impresión en pulgadas.
// Estilos: normal, titulo, cabecera, naranja, amarillo, seccion, nota, gris.
// { v, e, ajustar: true }: el texto pasa a varias líneas dentro de la celda
// (solo normal, naranja y amarillo; la altura de la fila la pone quien llama).

const XLSX_ESTILOS = { normal: 0, titulo: 1, cabecera: 2, naranja: 3, amarillo: 4, seccion: 5, nota: 6, gris: 7,
  normal_ajustar: 8, naranja_ajustar: 9, amarillo_ajustar: 10 };

function crearXlsx({ hoja = 'Hoja1', filas = [], anchos = [], unir = [], letra = 11, margen = 0.5 }) {
  const xml = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  const filasXml = filas.map((f, r) => {
    const fila = Array.isArray(f) ? f : (f.celdas || []);
    const alto = !Array.isArray(f) && f.alto ? ` ht="${f.alto}" customHeight="1"` : '';
    return `<row r="${r + 1}"${alto}>` + fila.map((c, k) => {
    if (c == null) return '';
    const e = c.e || 'normal';
    const s = (c.ajustar && XLSX_ESTILOS[e + '_ajustar']) || XLSX_ESTILOS[e] || 0;
    const v = c.v == null ? '' : String(c.v);
    return v === '' ? `<c r="${col(k)}${r + 1}" s="${s}"/>`
      : `<c r="${col(k)}${r + 1}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join('') + '</row>';
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
${anchos.length ? '<cols>' + anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : ''}
<sheetData>${filasXml}</sheetData>
${unir.length ? `<mergeCells count="${unir.length}">` + unir.map(u => `<mergeCell ref="${u}"/>`).join('') + '</mergeCells>' : ''}
<pageMargins left="${margen}" right="${margen}" top="${margen}" bottom="${margen}" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="${letra}"/><name val="Arial"/></font><font><b/><sz val="${letra + 2}"/><name val="Arial"/></font><font><b/><sz val="${letra}"/><name val="Arial"/></font><font><b/><sz val="${letra * 2}"/><name val="Arial"/></font><font><i/><sz val="${letra - 1}"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF9CB9C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment shrinkToFit="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const archivos = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(hoja.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet]
  ];
  return new Blob([zipSinComprimir(archivos)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ZIP sin compresión (método «stored»): suficiente para un .xlsx pequeño
function zipSinComprimir(archivos) {
  const enc = new TextEncoder();
  const tabla = zipSinComprimir.tabla || (zipSinComprimir.tabla = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  }));
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = tabla[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const partes = [], central = [];
  let offset = 0;
  for (const [nombre, contenido] of archivos) {
    const n = enc.encode(nombre), d = enc.encode(contenido), crc = crc32(d);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true); local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, d);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, d.length, true); cen.setUint32(24, d.length, true);
    cen.setUint16(28, n.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)]);
}
