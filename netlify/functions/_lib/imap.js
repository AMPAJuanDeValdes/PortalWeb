// Guardar un email en la carpeta de Borradores del buzón del AMPA (IMAP),
// para que la Junta lo abra en su correo, lo revise y lo envíe desde allí.
// Cliente IMAP mínimo (sin librerías): LOGIN, LIST, APPEND y LOGOUT.
//
// Variables de entorno (las mismas del correo, más dos opcionales):
//   SMTP_USER, SMTP_PASSWORD  → usuario y contraseña del buzón
//   IMAP_HOST (opcional)      → si no está, el de SMTP_HOST cambiando «smtp.» por «imap.»
//   IMAP_PORT (opcional)      → 993
//   IMAP_BORRADORES (opcional) → nombre de la carpeta si no se encuentra sola

const tls = require('tls');

function configImap() {
  const host = process.env.IMAP_HOST || String(process.env.SMTP_HOST || '').replace(/^smtp\./i, 'imap.');
  return { host, port: parseInt(process.env.IMAP_PORT || '993', 10), user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
}

const comillas = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Conexión con órdenes numeradas: orden('LOGIN ...') → { ok, lineas }
function conectar({ host, port }, tiempo = 15000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    let buffer = '', esperando = null, n = 0, saludo = true;
    const fallo = (e) => { if (esperando) { const w = esperando; esperando = null; w.reject(e); } else reject(e); };
    socket.setTimeout(tiempo, () => { fallo(new Error('El servidor de correo no responde (IMAP).')); socket.destroy(); });
    socket.on('error', fallo);
    socket.on('data', (d) => {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (saludo) {
          saludo = false;
          if (/^\* (OK|PREAUTH)/i.test(linea)) resolve(api);
          else reject(new Error('El servidor de correo no acepta la conexión: ' + linea));
          continue;
        }
        if (!esperando) continue;
        if (linea.startsWith('+') && esperando.alContinuar) { const c = esperando.alContinuar; esperando.alContinuar = null; c(); continue; }
        esperando.lineas.push(linea);
        const m = linea.match(/^(A\d+) (OK|NO|BAD)\b(.*)$/i);
        if (m && m[1] === esperando.tag) { const w = esperando; esperando = null; w.resolve({ ok: m[2].toUpperCase() === 'OK', texto: m[3].trim(), lineas: w.lineas }); }
      }
    });
    const api = {
      orden(texto, literal) {
        return new Promise((res, rej) => {
          const tag = 'A' + (++n);
          esperando = { tag, lineas: [], resolve: res, reject: rej };
          if (literal) {
            // APPEND: el mensaje va como literal {bytes} cuando el servidor dice «+»
            esperando.alContinuar = () => socket.write(Buffer.concat([literal, Buffer.from('\r\n')]));
            socket.write(`${tag} ${texto} {${literal.length}}\r\n`);
          } else socket.write(`${tag} ${texto}\r\n`);
        });
      },
      cerrar() { try { socket.end(); } catch (e) { /* ya cerrado */ } }
    };
  });
}

// Busca la carpeta de borradores: la marcada como \Drafts o una con nombre conocido
function carpetaBorradores(lineasList) {
  const carpetas = lineasList.map(l => {
    const m = l.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i);
    if (!m) return null;
    return { flags: m[1], nombre: m[2].replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1') };
  }).filter(Boolean);
  const marcada = carpetas.find(c => /\\Drafts/i.test(c.flags));
  if (marcada) return marcada.nombre;
  const conocidas = ['Drafts', 'Borradores', 'INBOX.Drafts', 'INBOX.Borradores', 'INBOX/Drafts', 'INBOX/Borradores'];
  for (const n of conocidas) { const c = carpetas.find(x => x.nombre.toLowerCase() === n.toLowerCase()); if (c) return c.nombre; }
  return null;
}

// IMAP exige que todas las líneas del mensaje acaben en CRLF (RFC 3501/5322):
// los saltos «\n» o «\r» sueltos hacen que el servidor rechace el APPEND
// («Message contains bare newlines»). Se trabaja en latin1 para no tocar los bytes.
function finesDeLineaCRLF(mensaje) {
  const s = Buffer.isBuffer(mensaje) ? mensaje.toString('latin1') : String(mensaje);
  return Buffer.from(s.replace(/\r\n|\r|\n/g, '\r\n'), 'latin1');
}

// Guarda el mensaje (RFC 822, Buffer) en Borradores. Devuelve el nombre de la carpeta.
async function guardarBorrador(mensaje) {
  mensaje = finesDeLineaCRLF(mensaje);
  const cfg = configImap();
  if (!cfg.host || !cfg.user || !cfg.pass) throw new Error('Faltan los datos del buzón (SMTP_HOST, SMTP_USER y SMTP_PASSWORD) en Netlify.');
  const c = await conectar(cfg);
  try {
    const login = await c.orden(`LOGIN ${comillas(cfg.user)} ${comillas(cfg.pass)}`);
    if (!login.ok) throw new Error('El buzón del AMPA no acepta el usuario o la contraseña (IMAP).');
    const list = await c.orden('LIST "" "*"');
    const carpeta = process.env.IMAP_BORRADORES || carpetaBorradores(list.lineas);
    if (!carpeta) throw new Error('No encuentro la carpeta de Borradores del buzón. Pon su nombre en IMAP_BORRADORES (Netlify).');
    const r = await c.orden(`APPEND ${comillas(carpeta)} (\\Draft \\Seen)`, mensaje);
    if (!r.ok) throw new Error('El buzón no ha aceptado el borrador: ' + r.texto);
    await c.orden('LOGOUT').catch(() => {});
    return carpeta;
  } finally {
    c.cerrar();
  }
}

module.exports = { guardarBorrador, finesDeLineaCRLF, carpetaBorradores, configImap };
