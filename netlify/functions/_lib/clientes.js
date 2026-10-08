// Crea el cliente de Supabase "como el usuario" (Anon/Publishable Key +
// el token de sesión del usuario), necesario para llamar a funciones SQL
// que comprueban is_admin() / mi_socio_id() vía auth.uid().
//
// La clave pública se toma de la variable de entorno SUPABASE_ANON_KEY
// (o SUPABASE_PUBLISHABLE_KEY). Si no está configurada en Netlify, se usa
// la que manda el propio navegador en la cabecera "x-supabase-anon-key"
// (es la misma clave pública de shared/config.js, no es un secreto: con
// ella solo se tienen los permisos del usuario que ya ha iniciado sesión).
// Antes, sin la variable de entorno, todas las funciones de la Mochila
// fallaban siempre.

const { createClient } = require('@supabase/supabase-js');

function claveAnon(event) {
  const h = (event && event.headers) || {};
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY ||
    h['x-supabase-anon-key'] || h['X-Supabase-Anon-Key'] || null;
}

function clienteUsuario(event, accessToken) {
  const key = claveAnon(event);
  if (!key) {
    const err = new Error('Falta configurar SUPABASE_ANON_KEY en las variables de entorno de Netlify.');
    err.statusCode = 500;
    throw err;
  }
  return createClient(process.env.SUPABASE_URL, key, {
    global: { headers: { Authorization: 'Bearer ' + accessToken } }
  });
}

module.exports = { clienteUsuario };
