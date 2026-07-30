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

async function enviarEmail({ to, bcc, subject, text, html }) {
  const transporter = getTransporter();
  const from = `"${process.env.SMTP_FROM_NAME || 'AMPA'}" <${process.env.SMTP_USER}>`;
  return transporter.sendMail({ from, to: to || process.env.SMTP_USER, bcc, subject, text, html });
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

module.exports = { enviarEmail, plantillaCredenciales };
