// Barra superior simple: un enlace de vuelta a "Inicio" (oculto si ya
// estás en el propio Inicio) + cerrar sesión. Sustituye al antiguo menú
// lateral, que ha quedado retirado del todo — toda la navegación real
// vive en los tiles de dashboard.html (incluida la Administración, ver
// esa página).
// activePage: identifica la página actual (para ocultar el botón Inicio
// cuando activePage === 'dashboard').
// ctx: { adulto, socio } devuelto por requireAuth()/requireAdmin().
function renderNav(activePage, ctx) {
  const adulto = ctx?.adulto || ctx; // admite pasar solo el adulto por compatibilidad

  const topbar = document.createElement('div');
  topbar.className = 'topbar-simple';
  const esc = (t) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  topbar.innerHTML = `
    <div class="topbar-in">
      <a href="dashboard.html" class="topbar-brand"><img src="assets/logo-ampa.png" alt="AMPA"><span>Portal de socios</span></a>
      <div class="topbar-right">
        ${activePage !== 'dashboard' ? '<a href="dashboard.html" class="topbar-inicio">Inicio</a>' : ''}
        <span class="topbar-user">${adulto ? esc(adulto.nombre + ' ' + adulto.apellidos) : ''}</span>
        <button class="linklike" id="navSignOut">Cerrar sesión</button>
      </div>
    </div>
  `;
  document.body.insertBefore(topbar, document.body.firstChild);

  document.getElementById('navSignOut').addEventListener('click', signOut);
}
