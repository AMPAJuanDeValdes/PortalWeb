// Inserta la barra de navegación al principio de <body>.
// activePage: string que identifica el enlace activo (ver data-page en cada <a>).
function renderNav(activePage, profile) {
  const isAdmin = profile && profile.role === 'admin';

  const links = [
    { page: 'dashboard', href: 'dashboard.html', label: 'Inicio' },
    { page: 'mis-datos', href: 'mis-datos.html', label: 'Mis datos' },
    { page: 'prestamo', href: 'prestamo.html', label: 'Préstamo de libros' },
    { page: 'eventos', href: 'eventos.html', label: 'Eventos' },
    { page: 'formularios', href: 'formularios.html', label: 'Formularios' }
  ];
  const adminLinks = [
    { page: 'admin-importar', href: 'admin-importar.html', label: 'Alta de socios' },
    { page: 'admin-eventos', href: 'admin-eventos.html', label: 'Eventos (admin)' },
    { page: 'admin-formularios', href: 'admin-formularios.html', label: 'Formularios (admin)' },
    { page: 'admin-respuestas', href: 'admin-respuestas.html', label: 'Respuestas' }
  ];

  const linkHtml = (l) =>
    `<a href="${l.href}" class="${activePage === l.page ? 'active' : ''}">${l.label}</a>`;

  const nav = document.createElement('div');
  nav.className = 'topnav';
  nav.innerHTML = `
    <div class="topnav-inner">
      <div class="topnav-brand">
        <img class="logo-ampa" src="assets/logo-ampa.png" alt="AMPA Colegio Juan de Valdés">
        <img class="logo-colegio" src="assets/logo-colegio.png" alt="Colegio Juan de Valdés">
      </div>
      <div class="rainbow-rule"></div>
      <div class="topnav-links">
        ${links.map(linkHtml).join('')}
        ${isAdmin ? adminLinks.map(linkHtml).join('') : ''}
        <span class="spacer"></span>
        <span class="user-tag">${profile ? profile.nombre_mostrar : ''}</span>
        <button class="linklike" id="navSignOut">Cerrar sesión</button>
      </div>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
  document.getElementById('navSignOut').addEventListener('click', signOut);
}
