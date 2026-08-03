// Carrusel simple de fotos, sin librerías externas.
// Uso: renderCarrusel(contenedorDOM, ['url1','url2',...])
function renderCarrusel(contenedor, urls) {
  if (!urls || urls.length === 0) {
    contenedor.innerHTML = '<p class="empty-hint">Sin fotos todavía.</p>';
    return;
  }
  let idx = 0;
  contenedor.innerHTML = `
    <div class="carrusel-viewport">
      <img class="carrusel-img" src="${urls[0]}" alt="">
      ${urls.length > 1 ? `
        <button type="button" class="carrusel-btn carrusel-prev" aria-label="Anterior">‹</button>
        <button type="button" class="carrusel-btn carrusel-next" aria-label="Siguiente">›</button>
      ` : ''}
    </div>
    ${urls.length > 1 ? `<div class="carrusel-dots">${urls.map((_, i) => `<span class="carrusel-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
  `;

  const img = contenedor.querySelector('.carrusel-img');
  const dots = contenedor.querySelectorAll('.carrusel-dot');

  function mostrar(nuevoIdx) {
    idx = (nuevoIdx + urls.length) % urls.length;
    img.src = urls[idx];
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  const prevBtn = contenedor.querySelector('.carrusel-prev');
  const nextBtn = contenedor.querySelector('.carrusel-next');
  if (prevBtn) prevBtn.addEventListener('click', () => mostrar(idx - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => mostrar(idx + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => mostrar(i)));
}
