// Envuelve el contenido de <body> en un layout de menú lateral vertical.
// activePage: identifica el enlace activo (data-page en cada <a>).
// ctx: { adulto, socio } devuelto por requireAuth()/requireAdmin().
function renderNav(activePage, ctx) {
  const adulto = ctx?.adulto || ctx; // admite pasar solo el adulto por compatibilidad
  const isAdmin = adulto && adulto.role === 'admin';

  const links = [
    { page: 'publico', href: 'index.html', label: 'Web pública' },
    { page: 'dashboard', href: 'dashboard.html', label: 'Inicio' },
    { page: 'mis-datos', href: 'mis-datos.html', label: 'Mis datos' },
    { page: 'prestamo', href: 'prestamo.html', label: 'Préstamo de libros' },
    { page: 'eventos', href: 'eventos.html', label: 'Eventos' }
  ];
  const adminLinks = [
    { page: 'admin-importar', href: 'admin-importar.html', label: 'Alta de socios' },
    { page: 'admin-comprobantes', href: 'admin-comprobantes.html', label: 'Comprobantes de pago' },
    { page: 'admin-eventos', href: 'admin-eventos.html', label: 'Eventos (admin)' },
    { page: 'admin-libros', href: 'admin-libros.html', label: 'Catálogo de libros' },
    { page: 'admin-documentos', href: 'admin-documentos.html', label: 'Documentos (admin)' },
    { page: 'admin-email', href: 'admin-email.html', label: 'Enviar email' },
    { page: 'admin-respuestas', href: 'admin-respuestas.html', label: 'Respuestas' }
  ];

  const linkHtml = (l) =>
    `<a href="${l.href}" class="${activePage === l.page ? 'active' : ''}">${l.label}</a>`;

  // Mover todo el contenido actual de <body> dentro de .app-content
  const existingChildren = Array.from(document.body.childNodes);
  const appContent = document.createElement('div');
  appContent.className = 'app-content';
  existingChildren.forEach(node => appContent.appendChild(node));

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <button class="sidenav-toggle" id="sidenavToggle">☰ Menú</button>
    <nav class="sidenav" id="sidenav">
      <div class="sidenav-brand">
        <img class="logo-ampa" src="assets/logo-ampa.png" alt="AMPA">
        <img class="logo-colegio" src="assets/logo-colegio.png" alt="Colegio Juan de Valdés">
        <div class="rainbow-rule"></div>
      </div>
      <div class="sidenav-links">
        ${links.map(linkHtml).join('')}
        ${isAdmin ? '<div class="group-label">Administración</div>' + adminLinks.map(linkHtml).join('') : ''}
      </div>
      <div class="sidenav-footer">
        <div class="user-tag">${adulto ? adulto.nombre + ' ' + adulto.apellidos : ''}</div>
        <button class="linklike" id="navSignOut">Cerrar sesión</button>
      </div>
    </nav>
  `;
  shell.appendChild(appContent);

  document.body.innerHTML = '';
  document.body.appendChild(shell);

  document.getElementById('navSignOut').addEventListener('click', signOut);
  document.getElementById('sidenavToggle').addEventListener('click', () => {
    document.getElementById('sidenav').classList.toggle('open');
  });
}
