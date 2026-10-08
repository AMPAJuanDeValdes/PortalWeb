// Barra superior (todas las páginas con sesión) y, en las páginas de
// administración, un menú lateral con las áreas de gestión de la Junta.
// activePage: identifica la página actual ('dashboard', 'admin', 'admin-socios'...).
// ctx: { adulto, socio } devuelto por requireAuth()/requireAdmin().

// Áreas de la Junta. Cada una con su color (los mismos del logo que usa
// el resto del portal), para reconocerlas de un vistazo.
const AREAS_JUNTA = [
  { titulo: 'Socios y cuotas', color: 'socios', enlaces: [
    ['admin-socios', 'Socios'], ['admin-importar', 'Alta de socios'],
    ['admin-sepa', 'Domiciliación SEPA'], ['admin-comprobantes', 'Comprobantes'] ] },
  { titulo: 'Actividades', color: 'eventos', enlaces: [
    ['admin-eventos', 'Eventos'], ['admin-libros', 'Préstamo de libros'],
    ['admin-uniformes', 'Uniformes'], ['admin-encuestas', 'Encuestas'] ] },
  { titulo: 'Comunicación', color: 'comunicacion', enlaces: [
    ['admin-email', 'Enviar email'], ['admin-documentos', 'Documentos'],
    ['admin-carrusel', 'Fotos y vídeos de portada'], ['admin-respuestas', 'Listados'] ] }
];

function renderNav(activePage, ctx) {
  const adulto = ctx?.adulto || ctx; // admite pasar solo el adulto por compatibilidad
  const esAdminPage = activePage === 'admin' || String(activePage).startsWith('admin-');

  const topbar = document.createElement('div');
  topbar.className = 'topbar-simple';
  const esc = (t) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  topbar.innerHTML = `
    <div class="topbar-in">
      <a href="${esAdminPage ? 'admin.html' : 'dashboard.html'}" class="topbar-brand"><img src="assets/logo-ampa.png" alt="AMPA"><span>${esAdminPage ? 'Panel de la Junta' : 'Portal de socios'}</span></a>
      <div class="topbar-right">
        ${esAdminPage ? '<a href="dashboard.html" class="topbar-inicio">Portal de socios</a>' : (activePage !== 'dashboard' ? '<a href="dashboard.html" class="topbar-inicio">Inicio</a>' : '')}
        <span class="topbar-user">${adulto ? esc(adulto.nombre + ' ' + adulto.apellidos) : ''}</span>
        <button class="linklike" id="navSignOut">Cerrar sesión</button>
      </div>
    </div>
  `;
  document.body.insertBefore(topbar, document.body.firstChild);
  document.getElementById('navSignOut').addEventListener('click', signOut);

  if (esAdminPage) montarMenuJunta(activePage);
}

function montarMenuJunta(activePage) {
  const contenido = document.querySelector('.wrap');
  if (!contenido) return;
  const shell = document.createElement('div');
  shell.className = 'admin-shell';
  const menu = document.createElement('nav');
  menu.className = 'admin-menu';
  menu.setAttribute('aria-label', 'Gestión de la Junta');
  menu.innerHTML =
    `<a href="admin.html" class="admin-menu-inicio${activePage === 'admin' ? ' activo' : ''}"${activePage === 'admin' ? ' aria-current="page"' : ''}>Resumen y pendientes</a>` +
    AREAS_JUNTA.map(a => `
      <div class="admin-menu-grupo area-${a.color}">
        <p class="admin-menu-titulo">${a.titulo}</p>
        ${a.enlaces.map(([id, nombre]) => `<a href="${id}.html"${id === activePage ? ' class="activo" aria-current="page"' : ''}>${nombre}</a>`).join('')}
      </div>`).join('');
  contenido.parentNode.insertBefore(shell, contenido);
  shell.appendChild(menu);
  shell.appendChild(contenido);
  // En el móvil el menú es una fila que se desliza: dejar a la vista la sección actual
  const activo = menu.querySelector('.activo');
  if (activo && menu.scrollWidth > menu.clientWidth) menu.scrollLeft = activo.offsetLeft - 12;
  // La miga "Administración" ya la da el menú
  const miga = contenido.querySelector('.eyebrow');
  if (miga && /Administración/.test(miga.textContent)) miga.remove();
}
