// Genera, una sola vez, las claves de los avisos en el móvil (notificaciones
// push). Copia las dos líneas en Netlify → Site configuration → Environment
// variables y vuelve a publicar (Deploys → Trigger deploy).
// La clave privada no se guarda en ningún archivo ni se sube a GitHub.
const { generarClavesVapid } = require('../netlify/functions/_lib/webpush');
const k = generarClavesVapid();
console.log('\nAñade estas dos variables de entorno en Netlify:\n');
console.log('  VAPID_PUBLIC_KEY  = ' + k.publicKey);
console.log('  VAPID_PRIVATE_KEY = ' + k.privateKey);
console.log('\nGenéralas solo una vez: si las cambias, las familias tienen que volver a activar los avisos.\n');
