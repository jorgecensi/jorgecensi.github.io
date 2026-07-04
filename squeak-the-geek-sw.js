const CACHE_VERSION = '2607040432';
const CACHE_NAME = `squeak-the-geek-${CACHE_VERSION}`;
const OFFLINE_URL = '/squeak-the-geek/';
const PRECACHE_URLS = [
  '/squeak-the-geek/',
  '/squeak-the-geek-manifest.json',
  '/img/squeak-the-geek-icon-192.png',
  '/img/squeak-the-geek-icon-512.png',
  '/img/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('squeak-the-geek-')) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isNavigationRequest = event.request.mode === 'navigate';
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
  }
});
