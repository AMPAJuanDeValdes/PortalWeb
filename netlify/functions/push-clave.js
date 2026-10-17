// Clave pública de los avisos (VAPID): el navegador la necesita para activar
// los avisos en el dispositivo. Es pública; la privada nunca sale de Netlify.
exports.handler = async () => {
  const clave = process.env.VAPID_PUBLIC_KEY;
  if (!clave) return { statusCode: 503, body: JSON.stringify({ error: 'Los avisos todavía no están configurados.' }) };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body: JSON.stringify({ clave }) };
};
