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

// Aviso de que le toca la Mochila Jugona Exploradora a una familia (la Junta le da el
// turno, o le llega porque otra familia lo pasa, se desapunta o no
// contesta). Tiene 24 horas para aceptarla en la web.
function plantillaMochilaTurno({ nombre, urlPortal }) {
  const url = urlPortal || (process.env.SITE_URL || '');
  return {
    subject: 'Os toca la Mochila Jugona Exploradora: tenéis 24 horas para aceptarla',
    text:
      `Hola ${nombre},\n\n` +
      `¡Os toca la Mochila Jugona Exploradora!\n\n` +
      `Para quedárosla tenéis que entrar en la web del AMPA y pulsar "La queremos" ` +
      `en las próximas 24 horas:\n${url}/mochila.html\n\n` +
      `Si esta semana no os viene bien, en la misma página podéis pulsar ` +
      `"Esperar una semana más" y el turno pasará a la siguiente familia.\n\n` +
      `Si en 24 horas no la aceptáis, saldréis de la lista y el turno pasará ` +
      `a la siguiente familia.\n\n` +
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
      (numeroSocio ? `Vuestro número de socio es: ${numeroSocio}\n\n` : '') +
      `Ya podéis entrar en el portal con vuestro email y contraseña: ${url}/login.html\n` +
      `Desde allí podéis apuntaros a eventos, pedir libros en préstamo, uniformes y mucho más.\n\n` +
      `Si no recordáis la contraseña, usad "¿Has olvidado tu contraseña?" en la pantalla de acceso.\n\n` +
      `AMPA Colegio Juan de Valdés`
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
      `Si tienes cualquier duda, responde a este correo.\n\n` +
      `AMPA Colegio Juan de Valdés`
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
    `Si no lo has pedido tú, ignora este correo: tu contraseña actual sigue funcionando.\n\n` +
    `AMPA Colegio Juan de Valdés`;
  const html = `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1A1A18;">
  <h2 style="color: #00335E; margin: 0 0 4px; font-size: 20px;">AMPA Colegio Juan de Valdés</h2>
  <p style="color: #6B675F; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 24px;">Recuperación de contraseña</p>
  <p style="font-size: 14.5px; line-height: 1.55;">Hola,</p>
  <p style="font-size: 14.5px; line-height: 1.55;">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en el portal del AMPA. Si has sido tú, pulsa el botón para elegir una contraseña nueva:</p>
  <p style="text-align: center; margin: 32px 0;">
    <a href="${enlace}" style="background-color: #004B93; color: #ffffff; padding: 12px 26px; text-decoration: none; border-radius: 2px; font-weight: bold; font-size: 14px; display: inline-block;">Restablecer mi contraseña</a>
  </p>
  <p style="font-size: 13px; color: #6B675F; line-height: 1.55;">El enlace solo funciona una vez y caduca pasado un tiempo. Si no lo has pedido tú, ignora este correo: tu contraseña actual sigue funcionando.</p>
  <hr style="border: none; border-top: 1px solid #E4E1D8; margin: 28px 0 16px;">
  <p style="font-size: 12px; color: #6B675F; margin: 0;">AMPA Colegio Juan de Valdés</p>
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
      `¡Gracias!\n\nAMPA Colegio Juan de Valdés`
  };
}

module.exports = {
  enviarEmail, plantillaCredenciales, plantillaMochilaTurno, plantillaComentario,
  plantillaBienvenida, plantillaRechazo, plantillaRecuperarPassword, plantillaRecordatorioDevolucion
};
