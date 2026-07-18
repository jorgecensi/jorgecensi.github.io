const CACHE_VERSION = '2607182239';
const CACHE_NAME = `f1-championship-${CACHE_VERSION}`;
const OFFLINE_URL = '/f1-championship/';
const PRECACHE_URLS = [
  '/f1-championship/',
  '/f1-championship/manifest.json',
  '/f1-championship/icons/icon-192.png',
  '/f1-championship/icons/icon-512.png',
  '/f1-championship/icons/apple-touch-icon.png',
  ...Array.from({ length: 20 }, (_, i) => `/f1-championship/cars/car-${String(i + 1).padStart(2, '0')}.png`),
  ...['au', 'jp', 'it', 'mc', 'gb', 'us', 'mx', 'ca',
      'bh', 'sa', 'cn', 'es', 'at', 'be', 'nl', 'br'].map(c => `/f1-championship/landmarks/${c}.png`),
  ...['tree', 'pine', 'hedge', 'bush', 'flowers', 'rock'].map(s => `/f1-championship/scenery/${s}.png`),
  ...['tire-barrier', 'skid', 'oil', 'cone', 'pit', 'wing', 'barrier'].map(s => `/f1-championship/racing/${s}.png`)
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('f1-championship-')) {
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
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isNavigationRequest = event.request.mode === 'navigate';
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
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
            if (networkResponse.ok) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);
        return cachedResponse || networkFetch;
      })
    );
  }
});
