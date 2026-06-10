const CACHE_VERSION = '2026061011';
const CACHE_NAME = `worldcup-2026-${CACHE_VERSION}`;
const OFFLINE_URL = '/worldcup-2026/';
const PRECACHE_URLS = ['/worldcup-2026/','/worldcup-2026/manifest.json','/worldcup-2026/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((cacheNames) => Promise.all(cacheNames.map((cacheName) => {
    if (cacheName !== CACHE_NAME && cacheName.startsWith('worldcup-2026-')) return caches.delete(cacheName);
    return Promise.resolve();
  }))).then(() => self.clients.claim()));
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/worldcup-2026/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const isNav = event.request.mode === 'navigate';
  const isSame = requestUrl.origin === self.location.origin;
  if (isNav) {
    event.respondWith(fetch(event.request).then((r) => { const c = r.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, c)); return r; }).catch(() => caches.match(event.request).then((c) => c || caches.match(OFFLINE_URL))));
    return;
  }
  if (isSame) {
    event.respondWith(caches.match(event.request).then((cached) => { const nf = fetch(event.request).then((r) => { const c = r.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, c)); return r; }).catch(() => cached); return cached || nf; }));
  }
});
