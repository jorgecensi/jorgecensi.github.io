const CACHE_VERSION = '2607121244';
const CACHE_NAME = `elastomania-${CACHE_VERSION}`;
const OFFLINE_URL = '/elastomania/';
const PRECACHE_URLS = [
  '/elastomania/',
  '/elastomania/matter.min.js',
  '/elastomania/manifest.json',
  '/img/elastomania-icon-192.png',
  '/img/elastomania-icon-512.png',
  '/img/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME && name.startsWith('elastomania-')) {
            return caches.delete(name);
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
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNav = event.request.mode === 'navigate';
  const isSameOrigin = url.origin === self.location.origin;

  if (isNav) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
