// Service worker de la web del AMPA: solo para los avisos (notificaciones
// push). No guarda páginas en caché: la web se carga siempre de internet.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'AMPA Juan de Valdés', {
    body: m.body || '',
    icon: 'assets/icono-192.png',
    badge: 'assets/icono-monocromo-96.png',
    tag: m.tag || undefined,
    data: { url: m.url || '/dashboard.html' },
    lang: 'es'
  }));
});

// Al tocar el aviso: abre (o trae al frente) la web en la página del aviso
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || '/dashboard.html', self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin === self.location.origin && 'focus' in v) {
        await v.focus();
        if ('navigate' in v) return v.navigate(destino);
        return;
      }
    }
    return self.clients.openWindow(destino);
  })());
});
