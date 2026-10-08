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
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

async function enviarEmail({ to, bcc, replyTo, subject, text, html }) {
  const transporter = getTransporter();
  const from = `"${process.env.SMTP_FROM_NAME || 'AMPA'}" <${process.env.SMTP_USER}>`;
  return transporter.sendMail({ from, to: to || process.env.SMTP_USER, bcc, replyTo, subject, text, html });
}

function plantillaCredenciales({ nombre, email, password, urlPortal }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: 'Tu acceso al portal del AMPA',
    text:
      `Hola ${nombre},\n\n` +
      `Ya tienes acceso al portal del AMPA.\n\n` +
      `Email: ${email}\n` +
      `Contraseña provisional: ${password}\n\n` +
      `Entra en ${url}/login.html y cambia la contraseña en tu primer acceso.\n\n` +
      `AMPA Colegio Juan de Valdés`
  };
}

// Aviso de que es tu turno en la Mochila Jugona Exploradora: se dispara
// cada vez que alguien pasa a ocupar la posición 1 de la cola (por
// entrega, por renuncia de quien iba delante, o por apuntarse a una
// cola vacía). Tiene 24 horas para responder antes de que el admin
// pueda pasar el turno a la siguiente familia.
function plantillaMochilaTurno({ nombre, urlPortal }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: '¡Te toca la Mochila Jugona Exploradora!',
    text:
      `Hola ${nombre},\n\n` +
      `Ya eres la siguiente familia en la lista de la Mochila Jugona Exploradora. ` +
      `Tienes 24 horas para confirmarnos si la quieres recibir este viernes.\n\n` +
      `Si no te viene bien esta semana, entra en ${url}/login.html y pulsa ` +
      `"Prefiero esperar una semana más" para pasar tu turno a la siguiente familia.\n\n` +
      `AMPA Colegio Juan de Valdés`
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

module.exports = { enviarEmail, plantillaCredenciales, plantillaMochilaTurno, plantillaComentario };
