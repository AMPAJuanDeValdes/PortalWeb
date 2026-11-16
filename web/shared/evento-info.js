// «Más información» de un evento (tabla evento_info): bloques con título,
// texto, una imagen y un enlace, aparte de la descripción. Se ven en
// Eventos (socios) y en la página de no socios; los pone la Junta en
// Panel → Eventos → Más información.
(function () {
  const escInfo = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlSegura = (u) => /^https?:\/\//i.test(String(u || '')) ? u : '';

  function htmlInfoEvento(bloques) {
    if (!bloques || !bloques.length) return '';
    return `<details class="ev-masinfo">
      <summary>Más información</summary>
      <div class="ev-masinfo-cuerpo">${bloques.map(b => {
        const img = urlSegura(b.imagen_url), enlace = urlSegura(b.enlace_url);
        return `<section class="ev-bloque">
          ${img ? `<img src="${escInfo(img)}" alt="${escInfo(b.titulo || '')}" loading="lazy">` : ''}
          ${b.titulo ? `<h3>${escInfo(b.titulo)}</h3>` : ''}
          ${b.texto ? `<p>${escInfo(b.texto)}</p>` : ''}
          ${enlace ? `<p class="ev-bloque-enlace"><a href="${escInfo(enlace)}" target="_blank" rel="noopener">${escInfo(b.enlace_texto || enlace)}</a></p>` : ''}
        </section>`;
      }).join('')}</div>
    </details>`;
  }

  // Rellena el hueco (o lo quita si el evento no tiene información)
  async function pintarInfoEvento(hueco, eventoId) {
    if (!hueco) return;
    const { data } = await sb.from('evento_info').select('*').eq('evento_id', eventoId).order('orden').order('created_at');
    if (data && data.length) hueco.outerHTML = htmlInfoEvento(data); else hueco.remove();
  }

  window.htmlInfoEvento = htmlInfoEvento;
  window.pintarInfoEvento = pintarInfoEvento;
})();
