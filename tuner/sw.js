const CACHE_VERSION = 'dev';
const CACHE_NAME = `tuner-${CACHE_VERSION}`;
const OFFLINE_URL = '/tuner/';
const PRECACHE_URLS = [
    '/tuner/',
    '/tuner/manifest.json',
    '/img/tuner-icon-192.png',
    '/img/tuner-icon-512.png',
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
                    if (cacheName !== CACHE_NAME && cacheName.startsWith('tuner-')) {
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

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return networkResponse;
                })
                .catch(() =>
                    caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
                )
        );
        return;
    }

    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const networkFetch = fetch(event.request)
                    .then((networkResponse) => {
                        if (networkResponse.ok) {
                            const clone = networkResponse.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        }
                        return networkResponse;
                    })
                    .catch(() => cachedResponse);
                return cachedResponse || networkFetch;
            })
        );
    }
});
