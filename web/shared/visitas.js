// Estadísticas de visitas (propias, sin cookies): al abrir cada página se
// apunta la visita con netlify/functions/visita.js. Si hay sesión de socio
// se manda su sesión para saber que es socio (no quién es).
// En local (servidor-local) y en las pruebas automáticas no se apunta nada.
(function () {
  if (window.__visitaApuntada) return;
  window.__visitaApuntada = true;
  if (location.protocol !== 'https:' || /^(localhost|127\.|\[?::1)/.test(location.hostname)) return;
  // Navegadores manejados por un programa (las pruebas automáticas con
  // Playwright, robots): no cuentan
  if (navigator.webdriver) return;
  async function apuntar() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof getSession === 'function') {
        const s = await getSession();
        if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
      }
    } catch (e) { /* sin sesión */ }
    try {
      fetch('/.netlify/functions/visita', { method: 'POST', headers, body: JSON.stringify({ pagina: location.pathname }), keepalive: true }).catch(() => {});
    } catch (e) { /* nunca rompe la página */ }
  }
  if (document.readyState === 'complete') setTimeout(apuntar, 300);
  else window.addEventListener('load', () => setTimeout(apuntar, 300), { once: true });
})();
