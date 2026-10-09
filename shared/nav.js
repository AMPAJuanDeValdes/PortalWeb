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
    ['admin-eventos', 'Eventos'], ['admin-libros', 'Banco de Libros'],
    ['admin-uniformes', 'Banco de Uniformes'], ['admin-mochila', 'Mochila Jugona Exploradora'], ['admin-encuestas', 'Encuestas'], ['admin-donaciones', 'Donaciones'] ] },
  { titulo: 'Comunicación', color: 'comunicacion', enlaces: [
    ['admin-email', 'Enviar email'], ['admin-documentos', 'Documentos'],
    ['admin-carrusel', 'Fotos y vídeos de portada'], ['admin-respuestas', 'Listados'] ] }
];

function renderNav(activePage, ctx) {
  const adulto = ctx?.adulto || ctx; // admite pasar solo el adulto por compatibilidad
  const esAdminPage = activePage === 'admin' || String(activePage).startsWith('admin-');

  const esc = (t) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const esAdmin = adulto && adulto.role === 'admin';
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    casa: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    salir: '<path d="M12 3v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>',
    junta: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    eventos: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    libros: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    uniformes: '<path d="M8 3L3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
    mochila: '<path d="M6 9a6 6 0 0 1 12 0v11H6z"/><path d="M9 5V3h6v2M9 14h6"/>',
    familia: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 22 19"/>'
  };
  // Secciones del portal (tarjetas «Todo lo del AMPA» al final de cada página)
  // [página, nombre, icono, color, nombre corto para el móvil]
  const SECCIONES = [['dashboard', 'Mi perfil', 'perfil', 'perfil', 'Perfil'], ['eventos', 'Eventos', 'eventos', 'eventos', 'Eventos'],
    ['prestamo', 'Banco de Libros', 'libros', 'libros', 'Libros'], ['uniformes', 'Banco de Uniformes', 'uniformes', 'uniformes', 'Uniformes'],
    ['mochila', 'Mochila Jugona Exploradora', 'mochila', 'mochila', 'Mochila'], ['mis-datos', 'Mis datos', 'familia', 'familia', 'Datos']];
  const boton = (href, ico, txt, extra = '') => `<a href="${href}" class="barra-btn" title="${txt}" ${extra}>${svg(ICO[ico])}<span class="vh">${txt}</span></a>`;

  const topbar = document.createElement('header');
  topbar.className = 'barra';
  topbar.innerHTML = `
    <a href="${esAdminPage ? 'admin.html' : 'dashboard.html'}" class="barra-logo" title="${esAdminPage ? 'Panel de la Junta' : 'Mi perfil'}">
      <img src="assets/logo-ampa-transparente.png" alt="AMPA Juan de Valdés">
      ${esAdminPage ? '<span class="barra-que">Panel de la Junta</span>' : ''}
    </a>
    <div class="barra-botones">
      ${boton('index.html', 'casa', 'Página principal')}
      ${esAdminPage ? boton('dashboard.html', 'perfil', 'Portal de socios') : (esAdmin ? boton('admin.html', 'junta', 'Panel de la Junta') : '')}
      <button type="button" class="barra-btn barra-salir" id="navSignOut" title="Cerrar sesión${adulto ? ' (' + esc(adulto.nombre) + ')' : ''}">${svg(ICO.salir)}<span class="vh">Cerrar sesión</span></button>
    </div>`;
  document.body.insertBefore(topbar, document.body.firstChild);

  // Al final de cada página del portal: «Todo lo del AMPA», para ir a cualquier sección
  if (!esAdminPage && activePage !== 'dashboard') {
    const DESC = {
      dashboard: 'Lo que tenéis pendiente, el calendario y las novedades.',
      eventos: 'Teatros o cuentacuentos, la chocolatada de Navidad y la barbacoa de fin de curso. Talleres de juegos de mesa, rol y ciencias.',
      prestamo: 'Préstamo de los libros de lectura del curso de cada alumno o alumna.',
      uniformes: 'Donación e intercambio de uniformes: recogida y reparto para darles una segunda vida.',
      mochila: 'Una mochila llena de juegos que va pasando por las casas de las familias.',
      'mis-datos': 'Adultos, alumnos y alumnas, forma de pago y domiciliación.'
    };
    const COLOR = { dashboard: 'blanco', eventos: 'c-eventos', prestamo: 'c-libros', uniformes: 'c-uniformes', mochila: 'c-mochila', 'mis-datos': 'blanco' };
    const sec = document.createElement('section');
    sec.className = 'todo-ampa';
    sec.setAttribute('aria-label', 'Todo lo del AMPA');
    sec.innerHTML = '<h2 class="bloque">Todo lo del AMPA</h2><div class="servicios">' +
      SECCIONES.filter(([id]) => id !== activePage).map(([id, txt, ico]) =>
        `<a class="servicio ${COLOR[id]}" href="${id}.html">${svg(ICO[ico])}<h3>${txt}</h3><p>${DESC[id]}</p></a>`).join('') + '</div>';
    (document.querySelector('.wrap') || document.body).appendChild(sec);
  }
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
