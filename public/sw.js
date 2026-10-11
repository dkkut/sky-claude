/* Sky: приём пушей при закрытой вкладке. Только показ уведомления и переход по нажатию. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Sky', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    // Если приложение открыто и видимо — уведомление показывает оно само.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'Sky', {
      body: d.body || '', icon: '/logo.png', badge: '/logo.png',
      tag: d.tag || undefined, renotify: Boolean(d.tag), data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
