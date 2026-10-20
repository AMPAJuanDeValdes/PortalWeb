// Utilidad compartida para enviar emails vía SMTP (serviciodecorreo.es
// u otro hosting de correo estándar). NO es una función Netlify por sí
// misma, es un módulo que importan otras funciones.
//
// Variables de entorno necesarias en Netlify:
//   SMTP_HOST      (ej. smtp.serviciodecorreo.es)
//   SMTP_PORT      (ej. 465)
//   SMTP_USER      (buzón completo, ej. ampa_j_valdes@fapaginerdelosrios.org)
//   SMTP_PASSWORD  (contraseña del buzón)
//   SMTP_FROM_NAME (ej. "AMPA Colegio Juan de Valdés")

const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    // Si el servidor de correo no responde, que falle en un tiempo razonable
    // (por defecto nodemailer espera minutos y la pantalla se queda en
    // «Enviando...»). Quien llama decide qué hacer si no se pudo enviar.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

// ---------- Firma del AMPA (igual que en los emails que manda la Junta) ----------
//   Un saludo,
//   Junta Directiva
//   AMPA Juan de Valdés
//   [logo]
// Va en todos los emails a familias. Los avisos internos que llegan al
// propio buzón del AMPA (comentarios, donaciones) van sin firma.
const fs = require('fs');
const path = require('path');
const AZUL_FIRMA = '#499AD8';
const FIRMA_TEXTO = '\n\nUn saludo,\n\nJunta Directiva\nAMPA Juan de Valdés';
const LOGO_CID = 'logo-ampa@ampajuandevaldes';

// El logo va dentro del email (adjunto en línea): se ve aunque el programa
// de correo bloquee las imágenes de internet. Si no se encuentra el archivo,
// se usa el de la web.
let logoCache;
function logoFirma() {
  if (logoCache !== undefined) return logoCache;
  const candidatos = [
    path.join(__dirname, '..', '..', '..', 'web', 'assets', 'logo-ampa-email.jpg'),
    path.join(process.cwd(), 'web', 'assets', 'logo-ampa-email.jpg'),
    path.join(process.env.LAMBDA_TASK_ROOT || '', 'web', 'assets', 'logo-ampa-email.jpg')
  ];
  logoCache = null;
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) { logoCache = c; break; } } catch (e) { /* siguiente */ }
  }
  return logoCache;
}

const escHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Texto plano -> HTML sencillo (párrafos, saltos de línea y enlaces que se pueden pulsar)
function textoAHtml(texto) {
  return String(texto || '').trim().split(/\n{2,}/).map(par =>
    '<p style="margin:0 0 14px;">' + escHtml(par)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#004B93;">$1</a>')
      .replace(/\n/g, '<br>') + '</p>').join('\n');
}
function firmaHtml(srcLogo) {
  return `
<div style="margin-top:22px; font-family:Verdana, Geneva, sans-serif; font-size:10pt; color:${AZUL_FIRMA};">
  <p style="margin:0 0 14px;">Un saludo,</p>
  <p style="margin:0 0 12px; font-weight:bold;">Junta Directiva<br>AMPA Juan de Valdés</p>
  <img src="${srcLogo}" alt="AMPA Juan de Valdés" width="160" style="display:block; width:160px; height:auto; border:0;">
</div>`;
}

async function enviarEmail({ to, bcc, replyTo, subject, text, html, sinFirma }) {
  const transporter = getTransporter();
  const from = `"${process.env.SMTP_FROM_NAME || 'AMPA'}" <${process.env.SMTP_USER}>`;
  const destino = to || process.env.SMTP_USER;
  // Aviso interno: va solo al buzón del AMPA (sin copias ocultas a familias)
  const interno = !bcc && String(destino).trim().toLowerCase() === String(process.env.SMTP_USER || '').trim().toLowerCase();
  if (sinFirma || interno) {
    return transporter.sendMail({ from, to: destino, bcc, replyTo, subject, text, html });
  }
  return transporter.sendMail({ from, to: destino, bcc, replyTo, ...conFirma({ subject, text, html }) });
}

// Asunto, texto y HTML con la firma del AMPA y su logo (Verdana 10 pt)
function conFirma({ subject, text, html }) {
  const logo = logoFirma();
  const srcLogo = logo ? 'cid:' + LOGO_CID : (process.env.SITE_URL || '').replace(/\/$/, '') + '/assets/logo-ampa-email.jpg';
  const cuerpoHtml = html || `<div style="font-family:Verdana, Geneva, sans-serif; font-size:10pt; line-height:1.5; color:#1A1A18; max-width:600px;">\n${textoAHtml(text)}\n</div>`;
  return {
    subject,
    text: String(text || '').trimEnd() + FIRMA_TEXTO,
    html: cuerpoHtml + firmaHtml(srcLogo),
    attachments: logo ? [{ filename: 'logo-ampa.jpg', path: logo, cid: LOGO_CID }] : []
  };
}

// El email completo (RFC 822) con la firma, sin enviarlo: para dejarlo en
// Borradores del buzón (ver _lib/imap.js). Sin destinatarios: se ponen al enviarlo.
function componerBorrador({ subject, text, html }) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const from = `"${process.env.SMTP_FROM_NAME || 'AMPA'}" <${process.env.SMTP_USER}>`;
  const correo = new MailComposer({ from, ...conFirma({ subject, text, html }) });
  return new Promise((resolve, reject) => correo.compile().build((err, msg) => err ? reject(err) : resolve(msg)));
}

function plantillaCredenciales({ nombre, email, password, urlPortal, inactiva }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: 'Tu acceso al portal del AMPA',
    text:
      `Hola ${nombre},\n\n` +
      `Ya tienes acceso al portal del AMPA.\n\n` +
      `Email: ${email}\n` +
      `Contraseña provisional: ${password}\n\n` +
      (inactiva
        ? `Vuestra cuenta está inactiva hasta que paguéis la cuota de este curso. Para activarla, entrad en ${url}/reactivar-cuenta.html con vuestro email y DNI/NIE y subid el justificante del pago. Cuando la Junta lo revise, os llegará un email y podréis entrar en ${url}/login.html con esta contraseña (os pedirá cambiarla).\n\n`
        : `Entra en ${url}/login.html y cambia la contraseña en tu primer acceso.\n\n`)
  };
}

// Aviso de que le toca la Mochila Jugona Exploradora a una familia (la Junta le da el
// turno, o le llega porque otra familia lo pasa, se desapunta o no
// contesta). Tiene 24 horas para aceptarla en la web.
function plantillaMochilaTurno({ nombre, urlPortal, entrega, devolucion }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  // entrega / devolucion: 'YYYY-MM-DD' (las pone la Junta al asignar)
  const dia = (f) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).replace(',', '');
  const fechas = entrega
    ? `La recogeréis el ${dia(entrega)}, de 17:30 a 18:00, y la devolveréis el ${devolucion ? dia(devolucion) : 'viernes siguiente'}, de 16:00 a 16:30.\n\n`
    : `Se recoge el viernes de 17:30 a 18:00 y se devuelve el viernes siguiente de 16:00 a 16:30.\n\n`;
  return {
    subject: 'Os toca la Mochila Jugona Exploradora: tenéis 24 horas para aceptarla',
    text:
      `Hola ${nombre},\n\n` +
      `¡Os toca la Mochila Jugona Exploradora!\n\n` +
      `Para quedárosla tenéis que entrar en la web del AMPA y pulsar "La queremos" ` +
      `en las próximas 24 horas:\n${url}/mochila.html\n\n` +
      fechas +
      `Al recogerla hay que firmar la carta de compromiso de buen uso. Cuando aceptéis la mochila podréis firmarla en esa misma página de la web, o a mano ese día.\n\n` +
      `Si esta semana no os viene bien, en la misma página podéis pulsar ` +
      `"Esperar una semana más" y el turno pasará a la siguiente familia.\n\n` +
      `Si en 24 horas no la aceptáis, saldréis de la lista y el turno pasará ` +
      `a la siguiente familia.\n\n`
  };
}

// Comentario directo por email (público o de un socio). Va al buzón del
// AMPA con Reply-To puesto al remitente real (los dos adultos si el
// socio tiene dos), para que "Responder" desde la cuenta del AMPA le
// conteste directamente a la familia.
function plantillaComentario({ origen, nombre, mensaje }) {
  const quien = origen === 'socio' ? `${nombre} (socio)` : `${nombre || 'Alguien'} (formulario público)`;
  return {
    subject: `Comentario recibido — ${quien}`,
    text:
      `Nuevo comentario recibido a través de la web.\n\n` +
      `De: ${quien}\n\n` +
      `Mensaje:\n${mensaje}\n\n` +
      `(Responde a este email para contestar directamente.)`
  };
}

// items: [{ texto, cantidad }] ya validados; otros: texto libre (puede rechazarse)
function plantillaDonacion({ items, otros, nombre, email, telefono, esSocio, urlAdmin }) {
  const lista = items.map(i => `  - ${i.texto} · ${i.cantidad} ${Number(i.cantidad) === 1 ? "unidad" : "unidades"}`).join('\n');
  return {
    subject: otros ? 'Donación anunciada (con «otra cosa» por revisar)' : 'Donación anunciada para la caja',
    text:
      `Han anunciado una donación desde la web.\n\n` +
      (lista ? `Para la caja de donaciones:\n${lista}\n\n` : '') +
      (otros ? `Otra cosa (hay que decirle si se acepta o no):\n${otros}\n\n` : '') +
      `De: ${nombre}${esSocio ? ' (familia socia)' : ''}\n` +
      `Email: ${email}\n` +
      (telefono ? `Teléfono: ${telefono}\n` : '') +
      `\nResponde a este email para contestar directamente.\n` +
      (urlAdmin ? `Todas las donaciones: ${urlAdmin}\n` : '')
  };
}

// «Quiero comprar Lotería» (loteria.html)
function plantillaLoteria({ campana, nombre, apellidos, email, movil, mensaje, esSocio, urlAdmin }) {
  return {
    subject: `Lotería: mensaje de ${nombre} ${apellidos}`,
    text:
      `Han escrito desde «Quiero comprar Lotería» (${campana}).\n\n` +
      `${mensaje}\n\n` +
      `De: ${nombre} ${apellidos}${esSocio ? ' (familia socia)' : ''}\n` +
      `Email: ${email}\n` +
      `Móvil: ${movil}\n` +
      `\nResponde a este email para contestar directamente.\n` +
      (urlAdmin ? `Todos los mensajes: ${urlAdmin}\n` : '')
  };
}

// Número de socio tal como se muestra en todas partes: 2027.0300.0042
function numeroSocioBonito(n) {
  n = String(n || '');
  return /^\d{12}$/.test(n) ? n.slice(0, 4) + '.' + n.slice(4, 8) + '.' + n.slice(8) : n;
}

// Cuenta activada por el admin: alta nueva (desde "Hazte socio") o
// reactivación de una cuenta que estaba de baja / pendiente de pago.
function plantillaBienvenida({ nombre, numeroSocio, reactivacion, urlPortal }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: reactivacion
      ? 'Tu cuenta del AMPA vuelve a estar activa'
      : '¡Bienvenida/o al AMPA Colegio Juan de Valdés!',
    text:
      `Hola ${nombre || ''},\n\n` +
      (reactivacion
        ? `Hemos revisado tu pago y tu cuenta del AMPA vuelve a estar activa.\n\n`
        : `Hemos revisado tu solicitud y tu pago: ya formáis parte del AMPA del Colegio Juan de Valdés. ¡Gracias por uniros!\n\n`) +
      (numeroSocio ? `Vuestro número de socio es: ${numeroSocioBonito(numeroSocio)}\n\n` : '') +
      `Ya podéis entrar en el portal con vuestro email y contraseña: ${url}/login.html\n` +
      `Desde allí podéis apuntaros a eventos, pedir libros en préstamo, uniformes y mucho más.\n\n` +
      `Si no recordáis la contraseña, usad "¿Has olvidado tu contraseña?" en la pantalla de acceso.\n\n`
  };
}

// Solicitud de alta o reactivación rechazada por el admin, con el motivo.
function plantillaRechazo({ nombre, motivo, urlPortal }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: 'Sobre tu solicitud en el AMPA Colegio Juan de Valdés',
    text:
      `Hola ${nombre || ''},\n\n` +
      `Hemos revisado tu solicitud y, por ahora, no hemos podido activar tu cuenta del AMPA.\n\n` +
      `Motivo:\n${motivo}\n\n` +
      `Cuando lo hayas solucionado, puedes volver a enviarnos el comprobante desde ` +
      `${url}/reactivar-cuenta.html (no hace falta rellenar de nuevo todos los datos).\n\n` +
      `Si tienes cualquier duda, responde a este correo.\n\n`
  };
}

// Recuperar contraseña: lo envía nuestra propia función (no Supabase),
// así solo se manda a cuentas activas y con nuestro buzón y nuestra marca.
function plantillaRecuperarPassword({ enlace }) {
  const text =
    `Hola,\n\n` +
    `Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en el portal del AMPA.\n` +
    `Si has sido tú, abre este enlace para elegir una contraseña nueva (solo funciona una vez):\n\n` +
    `${enlace}\n\n` +
    `Si no lo has pedido tú, ignora este correo: tu contraseña actual sigue funcionando.`;
  const html = `
<div style="font-family: Verdana, Geneva, sans-serif; font-size: 10pt; max-width: 480px; margin: 0 auto; padding: 24px; color: #1A1A18;">
  <h2 style="color: #00335E; margin: 0 0 4px; font-size: 20px;">AMPA Colegio Juan de Valdés</h2>
  <p style="color: #6B675F; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 24px;">Recuperación de contraseña</p>
  <p style="font-size: 10pt; line-height: 1.5;">Hola,</p>
  <p style="font-size: 10pt; line-height: 1.5;">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en el portal del AMPA. Si has sido tú, pulsa el botón para elegir una contraseña nueva:</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${enlace}" style="background-color: #004B93; color: #ffffff; padding: 12px 26px; text-decoration: none; border-radius: 2px; font-weight: bold; font-size: 14px; display: inline-block;">Restablecer mi contraseña</a>
  </p>
  <p style="font-size: 13px; color: #6B675F; line-height: 1.55;">El enlace solo funciona una vez y caduca pasado un tiempo. Si no lo has pedido tú, ignora este correo: tu contraseña actual sigue funcionando.</p>
</div>`;
  return { subject: 'Restablece tu contraseña — AMPA Colegio Juan de Valdés', text, html };
}

// Recordatorio de devolución de libros del préstamo
function plantillaRecordatorioDevolucion({ nombre, libros }) {
  return {
    subject: 'Recordatorio: devolución de libros del préstamo del AMPA',
    text:
      `Hola ${nombre || ''},\n\n` +
      `Os recordamos que tenéis en préstamo estos libros del AMPA:\n\n` +
      libros.map(l => `  · ${l.titulo} (ejemplar ${l.codigo}) — ${l.alumno}`).join('\n') + `\n\n` +
      `Por favor, devolvedlos al AMPA para que puedan prestarse a otras familias el curso que viene. ` +
      `Si alguno se ha perdido o estropeado, respondednos a este correo y lo vemos.\n\n` +
      `¡Gracias!`
  };
}

module.exports = {
  componerBorrador, conFirma, textoAHtml,
  plantillaLoteria,
  enviarEmail, numeroSocioBonito, plantillaCredenciales, plantillaMochilaTurno, plantillaComentario, plantillaDonacion,
  plantillaBienvenida, plantillaRechazo, plantillaRecuperarPassword, plantillaRecordatorioDevolucion
};
