// Envío de notificaciones push (Web Push) sin librerías externas: solo el
// módulo crypto de Node.
//  · Cifrado del mensaje: RFC 8291 (aes128gcm).
//  · Identificación del servidor ante Google/Apple/Mozilla: VAPID (RFC 8292).
// Claves en las variables de entorno de Netlify (se generan una vez con
// herramientas/generar-claves-avisos.bat):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y, opcional, VAPID_SUBJECT
//   (mailto: de contacto; si no, se usa SMTP_USER).

const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Par de claves P-256 en el formato de Web Push (públicas sin comprimir, 65 bytes)
function generarClavesVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwkPub = publicKey.export({ format: 'jwk' });
  const jwkPriv = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), deB64u(jwkPub.x), deB64u(jwkPub.y)]);
  return { publicKey: b64u(pub), privateKey: jwkPriv.d };
}

function clavePrivada(pubB64u, privB64u) {
  const pub = deB64u(pubB64u);
  return crypto.createPrivateKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', d: privB64u, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65))
  } });
}

// Cabecera Authorization de VAPID para el servidor de push del endpoint
function cabeceraVapid(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const firma = crypto.sign('sha256', Buffer.from(cab + '.' + cuerpo), { key: clavePrivada(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${publicKey}`;
}

// Cifra el mensaje para una suscripción (p256dh y auth del navegador).
// `pruebas` permite fijar la sal y las claves efímeras (vectores del RFC).
function cifrar(texto, p256dh, auth, pruebas = {}) {
  const uaPublic = deB64u(p256dh);
  const authSecret = deB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (pruebas.asPrivate) ecdh.setPrivateKey(deB64u(pruebas.asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secreto = ecdh.computeSecret(uaPublic);
  const salt = pruebas.salt ? deB64u(pruebas.salt) : crypto.randomBytes(16);

  const prkKey = hmac(authSecret, secreto);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const datos = Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])]);   // 0x02 = último registro
  const cifrado = Buffer.concat([cipher.update(datos), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, cifrado]);
}

function clavesEntorno() {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT || (process.env.SMTP_USER ? 'mailto:' + process.env.SMTP_USER : 'mailto:ampa@example.com');
  return { publicKey, privateKey, subject };
}

// Envía una notificación. Devuelve { ok, status, caducada } (caducada: el
// navegador ya no tiene esa suscripción y hay que borrarla).
async function enviarPush(suscripcion, mensaje, claves = clavesEntorno()) {
  if (!claves) throw new Error('Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en las variables de entorno de Netlify.');
  const cuerpo = cifrar(JSON.stringify(mensaje), suscripcion.p256dh, suscripcion.auth);
  const r = await fetch(suscripcion.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(3 * 24 * 3600), Urgency: 'normal',
      Authorization: cabeceraVapid(suscripcion.endpoint, claves)
    },
    body: cuerpo
  });
  return { ok: r.ok, status: r.status, caducada: r.status === 404 || r.status === 410 };
}

module.exports = { generarClavesVapid, cabeceraVapid, cifrar, enviarPush, clavesEntorno, b64u, deB64u };
